// Arcadia Runner — fait tourner un cœur libretro en plein écran, sans interface d'émulateur.
// Échap / bouton Guide : pause + menu Arcadia. Back+Start maintenus 1,5 s : quitter (avec reprise auto).
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>
#include "app.h"
#include <thread>
#include <atomic>
#include <cstdarg>
#include <cstring>
#include <cmath>
#include <algorithm>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#include "stb_image.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

App g_app;
static std::vector<std::pair<std::string, std::string>> g_sessionOpts; // --opt clé=valeur : pour cette partie seulement
static bool isSessionOpt(const std::string& k) { for (auto& o : g_sessionOpts) if (o.first == k) return true; return false; }
static int pendingLoad = -1, pendingTries = 0;
static uint64_t frameCount = 0;
static std::string captureUiPath; static int captureAt = -1, menuAt = -1, quitAt = -1, resumeAt = -1;

// ───────────────────────────── Options par défaut (console) ─────────────────────────────
// Réglages qu'Arcadia applique la première fois (ta RTX encaisse largement).
static const char* kDefaultCoreOpts[][2] = {
  { "ppsspp_internal_resolution", "1920x1088" },
  { "ppsspp_language", "Automatic" },
  { "melonds_threaded_renderer", "enabled" },
  { "melonds_opengl_renderer", "enabled" },
  { "melonds_opengl_resolution", "4x native (1024x768)" },
  { "melonds_touch_mode", "Touch" },
  { "melonds_language", "French" },
  { "melonds_jit_enable", "enabled" },
  { "citra_resolution_factor", "4" },
  { "citra_language_value", "French" },
  { "citra_graphics_api", "OpenGL" },
  { "citra_texture_sampling", "Linear" },
};

// ───────────────────────────── Callbacks libretro ─────────────────────────────
static void RETRO_CALLCONV logCb(enum retro_log_level lvl, const char* fmt, ...) {
  if (lvl < RETRO_LOG_WARN) return;
  char buf[1024]; va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  size_t n = strlen(buf); while (n && (buf[n - 1] == '\n' || buf[n - 1] == '\r')) buf[--n] = 0;
  SDL_Log("[cœur] %s", buf);
}

static uintptr_t RETRO_CALLCONV hwGetFb() { return g_app.gameFbo; }
static retro_proc_address_t RETRO_CALLCONV hwGetProc(const char* sym) { return (retro_proc_address_t)SDL_GL_GetProcAddress(sym); }

static bool RETRO_CALLCONV rumbleCb(unsigned port, enum retro_rumble_effect effect, uint16_t strength) {
  if (port >= 4 || !g_app.pads[port] || !g_app.cfg.getb("vibration", true)) return false;
  static uint16_t strong[4], weak[4];
  (effect == RETRO_RUMBLE_STRONG ? strong : weak)[port] = strength;
  SDL_RumbleGamepad(g_app.pads[port], strong[port], weak[port], 5000);
  return true;
}

static void addOptionV2(const retro_core_option_v2_definition* d) {
  for (; d && d->key; d++) {
    CoreOption o; o.key = d->key; o.desc = d->desc ? d->desc : d->key; o.info = d->info ? d->info : "";
    for (int i = 0; i < RETRO_NUM_CORE_OPTION_VALUES_MAX && d->values[i].value; i++)
      o.values.push_back({ d->values[i].value, d->values[i].label ? d->values[i].label : d->values[i].value });
    o.def = d->default_value ? d->default_value : (o.values.empty() ? "" : o.values[0].first);
    o.value = o.def;
    g_core.options.push_back(o);
  }
}
static void addOptionV1(const retro_core_option_definition* d) {
  for (; d && d->key; d++) {
    CoreOption o; o.key = d->key; o.desc = d->desc ? d->desc : d->key; o.info = d->info ? d->info : "";
    for (int i = 0; i < RETRO_NUM_CORE_OPTION_VALUES_MAX && d->values[i].value; i++)
      o.values.push_back({ d->values[i].value, d->values[i].label ? d->values[i].label : d->values[i].value });
    o.def = d->default_value ? d->default_value : (o.values.empty() ? "" : o.values[0].first);
    o.value = o.def;
    g_core.options.push_back(o);
  }
}
static void addOptionV0(const retro_variable* v) {
  for (; v && v->key; v++) {
    CoreOption o; o.key = v->key; std::string s = v->value ? v->value : "";
    size_t semi = s.find(';'); o.desc = semi == std::string::npos ? o.key : s.substr(0, semi);
    std::string list = semi == std::string::npos ? s : s.substr(semi + 1);
    while (!list.empty() && list[0] == ' ') list.erase(0, 1);
    size_t i = 0;
    while (i <= list.size()) {
      size_t e = list.find('|', i); if (e == std::string::npos) e = list.size();
      std::string val = list.substr(i, e - i); if (!val.empty()) o.values.push_back({ val, val });
      i = e + 1;
    }
    o.def = o.values.empty() ? "" : o.values[0].first; o.value = o.def;
    g_core.options.push_back(o);
  }
}
// Applique les défauts Arcadia puis les choix enregistrés
static void applyOptionConfig() {
  for (auto& d : kDefaultCoreOpts) if (auto* o = g_core.findOption(d[0])) {
    for (auto& v : o->values) if (v.first == d[1]) { o->value = d[1]; break; }
  }
  for (auto& o : g_core.options) {
    std::string v = g_app.cfg.get("core:" + o.key);
    if (!v.empty()) for (auto& x : o.values) if (x.first == v) { o.value = v; break; }
  }
  for (auto& [k, v] : g_sessionOpts) if (auto* o = g_core.findOption(k)) {
    bool ok = false; for (auto& x : o->values) if (x.first == v) ok = true;
    if (ok) o->value = v; else SDL_Log("option %s : valeur %s refusée", k.c_str(), v.c_str());
  }
  g_core.optionsDirty = true;
}

// Messages des cœurs : en français quand on les connaît, masqués quand ils n'aident pas le joueur
static void coreToast(const char* msg, int ms) {
  std::string m = msg;
  if (m.find("No PlayStation BIOS") != std::string::npos || m.find("HLE BIOS") != std::string::npos) return; // BIOS intégré : ça marche sans
  if (m.find("Firmware not found") != std::string::npos) return;
  g_app.toast(m, ms);
}
static bool RETRO_CALLCONV envCb(unsigned cmd, void* data) {
  switch (cmd) {
  case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((retro_log_callback*)data)->log = logCb; return true;
  case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)data = true; return true;
  case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY: *(const char**)data = g_core.systemDir.c_str(); return true;
  case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char**)data = g_core.saveDir.c_str(); return true;
  case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY: *(const char**)data = g_core.systemDir.c_str(); return true;
  case RETRO_ENVIRONMENT_GET_USERNAME: { static std::string u = "Joueur"; *(const char**)data = u.c_str(); return true; }
  case RETRO_ENVIRONMENT_GET_LANGUAGE: *(unsigned*)data = RETRO_LANGUAGE_FRENCH; return true;
  case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
    auto f = *(retro_pixel_format*)data;
    if (f > RETRO_PIXEL_FORMAT_RGB565) return false;
    g_core.pixfmt = f; return true;
  }
  case RETRO_ENVIRONMENT_GET_PREFERRED_HW_RENDER: *(unsigned*)data = RETRO_HW_CONTEXT_OPENGL_CORE; return true;
  case RETRO_ENVIRONMENT_SET_HW_RENDER: {
    auto* h = (retro_hw_render_callback*)data;
    if (h->context_type != RETRO_HW_CONTEXT_OPENGL && h->context_type != RETRO_HW_CONTEXT_OPENGL_CORE) return false;
    h->get_current_framebuffer = hwGetFb; h->get_proc_address = hwGetProc;
    g_core.hw = *h; g_core.hwRender = true;
    return true;
  }
  case RETRO_ENVIRONMENT_SET_HW_SHARED_CONTEXT: return true;
  case RETRO_ENVIRONMENT_GET_RUMBLE_INTERFACE: ((retro_rumble_interface*)data)->set_rumble_state = rumbleCb; return true;
  case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
  case RETRO_ENVIRONMENT_GET_INPUT_DEVICE_CAPABILITIES: *(uint64_t*)data = (1 << RETRO_DEVICE_JOYPAD) | (1 << RETRO_DEVICE_ANALOG) | (1 << RETRO_DEVICE_POINTER) | (1 << RETRO_DEVICE_MOUSE); return true;
  case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned*)data = 2; return true;
  case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2: g_core.options.clear(); addOptionV2(((retro_core_options_v2*)data)->definitions); applyOptionConfig(); return true;
  case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2_INTL: g_core.options.clear(); addOptionV2(((retro_core_options_v2_intl*)data)->us->definitions); applyOptionConfig(); return true;
  case RETRO_ENVIRONMENT_SET_CORE_OPTIONS: g_core.options.clear(); addOptionV1((retro_core_option_definition*)data); applyOptionConfig(); return true;
  case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL: g_core.options.clear(); addOptionV1(((retro_core_options_intl*)data)->us); applyOptionConfig(); return true;
  case RETRO_ENVIRONMENT_SET_VARIABLES: g_core.options.clear(); addOptionV0((retro_variable*)data); applyOptionConfig(); return true;
  case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY: {
    auto* d = (retro_core_option_display*)data;
    if (d && d->key) if (auto* o = g_core.findOption(d->key)) o->visible = d->visible;
    return true;
  }
  case RETRO_ENVIRONMENT_GET_VARIABLE: {
    auto* v = (retro_variable*)data;
    if (auto* o = g_core.findOption(v->key)) { v->value = o->value.c_str(); return true; }
    v->value = nullptr; return false;
  }
  case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)data = g_core.optionsDirty; g_core.optionsDirty = false; return true;
  case RETRO_ENVIRONMENT_SET_MESSAGE: { auto* m = (retro_message*)data; if (m && m->msg) coreToast(m->msg, 2500); return true; }
  case RETRO_ENVIRONMENT_GET_MESSAGE_INTERFACE_VERSION: *(unsigned*)data = 1; return true;
  case RETRO_ENVIRONMENT_SET_MESSAGE_EXT: {
    auto* m = (retro_message_ext*)data;
    if (m && m->msg && m->target != RETRO_MESSAGE_TARGET_LOG && m->type != RETRO_MESSAGE_TYPE_STATUS) coreToast(m->msg, m->duration ? m->duration : 2500);
    return true;
  }
  case RETRO_ENVIRONMENT_SET_GEOMETRY: g_core.av.geometry = *(retro_game_geometry*)data; return true;
  case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: {
    g_core.av = *(retro_system_av_info*)data;
    extern void ensureGameFbo(); if (g_core.hwRender && g_app.gameFbo) ensureGameFbo();
    return true;
  }
  case RETRO_ENVIRONMENT_GET_AUDIO_VIDEO_ENABLE: *(int*)data = 3; return true;
  case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
  case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
  case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
  case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS:
  case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
  case RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO:
  case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
  case RETRO_ENVIRONMENT_SET_CONTENT_INFO_OVERRIDE:
    return true;
  case RETRO_ENVIRONMENT_GET_FASTFORWARDING: *(bool*)data = g_app.speedMode == 1; return true;
  case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME: return true;
  default: return false;
  }
}

// ───────────────────────────── Vidéo ─────────────────────────────
static void allocTex(GLuint& tex, int w, int h) {
  if (!tex) xglGenTextures(1, &tex);
  xglBindTexture(GL_TEXTURE_2D, tex);
  xglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  xglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  xglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  xglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  xglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  xglBindTexture(GL_TEXTURE_2D, 0);
}
static void attach(GLuint& fbo, GLuint tex) {
  if (!fbo) xglGenFramebuffers(1, &fbo);
  xglBindFramebuffer(GL_FRAMEBUFFER, fbo);
  xglFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
}

void ensureGameFbo() {
  int w = std::max<int>(g_core.av.geometry.max_width, g_core.av.geometry.base_width);
  int h = std::max<int>(g_core.av.geometry.max_height, g_core.av.geometry.base_height);
  w = std::clamp(w, 64, 8192); h = std::clamp(h, 64, 8192);
  if (g_app.gameFbo && w <= g_app.fboW && h <= g_app.fboH) return;
  w = std::max(w, g_app.fboW); h = std::max(h, g_app.fboH);
  allocTex(g_app.gameTex, w, h);
  attach(g_app.gameFbo, g_app.gameTex);
  if (g_core.hw.depth) {
    if (!g_app.gameDepth) xglGenRenderbuffers(1, &g_app.gameDepth);
    xglBindRenderbuffer(GL_RENDERBUFFER, g_app.gameDepth);
    xglRenderbufferStorage(GL_RENDERBUFFER, g_core.hw.stencil ? GL_DEPTH24_STENCIL8 : GL_DEPTH_COMPONENT24, w, h);
    xglFramebufferRenderbuffer(GL_FRAMEBUFFER, g_core.hw.stencil ? GL_DEPTH_STENCIL_ATTACHMENT : GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, g_app.gameDepth);
    xglBindRenderbuffer(GL_RENDERBUFFER, 0);
  }
  if (xglCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) SDL_Log("FBO du jeu incomplet");
  xglClearColor(0, 0, 0, 1); xglClear(GL_COLOR_BUFFER_BIT);
  xglBindFramebuffer(GL_FRAMEBUFFER, 0);
  g_app.fboW = w; g_app.fboH = h;
}

static void RETRO_CALLCONV videoCb(const void* data, unsigned w, unsigned h, size_t pitch) {
  if (!data) return; // image dupliquée : on garde la précédente
  if (data == RETRO_HW_FRAME_BUFFER_VALID) {
    g_app.frameIsHw = true; g_app.frameW = w; g_app.frameH = h; g_app.haveFrame = true; return;
  }
  if ((int)w != g_app.swW || (int)h != g_app.swH) {
    allocTex(g_app.swTex, w, h); attach(g_app.swFbo, g_app.swTex); xglBindFramebuffer(GL_FRAMEBUFFER, 0);
    g_app.swW = w; g_app.swH = h;
  }
  GLenum fmt = GL_BGRA, type = GL_UNSIGNED_INT_8_8_8_8_REV; int bpp = 4;
  if (g_core.pixfmt == RETRO_PIXEL_FORMAT_RGB565) { fmt = GL_RGB; type = GL_UNSIGNED_SHORT_5_6_5; bpp = 2; }
  else if (g_core.pixfmt == RETRO_PIXEL_FORMAT_0RGB1555) { fmt = GL_BGRA; type = GL_UNSIGNED_SHORT_1_5_5_5_REV; bpp = 2; }
  xglBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0);
  xglBindTexture(GL_TEXTURE_2D, g_app.swTex);
  xglPixelStorei(GL_UNPACK_ALIGNMENT, bpp == 4 ? 4 : 2);
  xglPixelStorei(GL_UNPACK_ROW_LENGTH, (GLint)(pitch / bpp));
  xglTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, fmt, type, data);
  xglPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  xglBindTexture(GL_TEXTURE_2D, 0);
  g_app.frameIsHw = false; g_app.frameW = w; g_app.frameH = h; g_app.haveFrame = true;
}

// Rectangle d'affichage selon le format choisi
static void destRect(int W, int H, int& x, int& y, int& w, int& h) {
  float ar = g_core.av.geometry.aspect_ratio > 0 ? g_core.av.geometry.aspect_ratio
           : (g_app.frameH ? (float)g_app.frameW / g_app.frameH : 4.f / 3.f);
  std::string mode = g_app.cfg.get("aspect", "fit");
  if (mode == "stretch") { x = 0; y = 0; w = W; h = H; return; }
  if (mode == "integer" && !g_app.frameIsHw && g_app.frameW && g_app.frameH) {
    int baseH = g_app.frameH, baseW = (int)std::lround(baseH * ar);
    int k = std::max(1, std::min(W / std::max(1, baseW), H / std::max(1, baseH)));
    w = baseW * k; h = baseH * k; x = (W - w) / 2; y = (H - h) / 2; return;
  }
  if ((float)W / H > ar) { h = H; w = (int)std::lround(H * ar); } else { w = W; h = (int)std::lround(W / ar); }
  x = (W - w) / 2; y = (H - h) / 2;
}

// Copie l'image du jeu vers le framebuffer cible (dst), dans le rectangle donné, à l'endroit
static void blitGame(GLuint dst, int x, int y, int w, int h, GLenum filter) {
  if (!g_app.haveFrame) return;
  GLuint src = g_app.frameIsHw ? g_app.gameFbo : g_app.swFbo;
  bool flip = g_app.frameIsHw ? !g_core.hw.bottom_left_origin : true;
  xglBindFramebuffer(GL_READ_FRAMEBUFFER, src);
  xglBindFramebuffer(GL_DRAW_FRAMEBUFFER, dst);
  int sy0 = flip ? g_app.frameH : 0, sy1 = flip ? 0 : g_app.frameH;
  xglBlitFramebuffer(0, sy0, g_app.frameW, sy1, x, y, x + w, y + h, GL_COLOR_BUFFER_BIT, filter);
}

void resetGlState() {
  xglBindFramebuffer(GL_FRAMEBUFFER, 0);
  xglBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0); xglBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
  xglDisable(GL_SCISSOR_TEST); xglDisable(GL_FRAMEBUFFER_SRGB);
  xglColorMask(1, 1, 1, 1); xglUseProgram(0);
  xglViewport(0, 0, g_app.winW, g_app.winH);
}

// Flou du jeu derrière le menu : pyramide de réductions/agrandissements bilinéaires
static void drawBlurredBackground() {
  int W = g_app.winW, H = g_app.winH;
  for (int i = 0; i < 5; i++) {
    int bw = std::max(8, W >> (i + 2)), bh = std::max(8, H >> (i + 2));
    if (bw != g_app.blurW[i] || bh != g_app.blurH[i]) { allocTex(g_app.blurTex[i], bw, bh); attach(g_app.blurFbo[i], g_app.blurTex[i]); g_app.blurW[i] = bw; g_app.blurH[i] = bh; }
  }
  xglBindFramebuffer(GL_FRAMEBUFFER, g_app.blurFbo[0]);
  xglClearColor(0, 0, 0, 1); xglClear(GL_COLOR_BUFFER_BIT);
  int x, y, w, h; destRect(g_app.blurW[0], g_app.blurH[0], x, y, w, h);
  // en fond, le jeu couvre tout l'écran (façon Steam) même s'il est en 4:3
  float s = std::max((float)g_app.blurW[0] / w, (float)g_app.blurH[0] / h);
  int cw = (int)(w * s), ch = (int)(h * s);
  blitGame(g_app.blurFbo[0], (g_app.blurW[0] - cw) / 2, (g_app.blurH[0] - ch) / 2, cw, ch, GL_LINEAR);
  for (int i = 1; i < 5; i++) {
    xglBindFramebuffer(GL_READ_FRAMEBUFFER, g_app.blurFbo[i - 1]); xglBindFramebuffer(GL_DRAW_FRAMEBUFFER, g_app.blurFbo[i]);
    xglBlitFramebuffer(0, 0, g_app.blurW[i - 1], g_app.blurH[i - 1], 0, 0, g_app.blurW[i], g_app.blurH[i], GL_COLOR_BUFFER_BIT, GL_LINEAR);
  }
  for (int i = 3; i >= 0; i--) {
    xglBindFramebuffer(GL_READ_FRAMEBUFFER, g_app.blurFbo[i + 1]); xglBindFramebuffer(GL_DRAW_FRAMEBUFFER, g_app.blurFbo[i]);
    xglBlitFramebuffer(0, 0, g_app.blurW[i + 1], g_app.blurH[i + 1], 0, 0, g_app.blurW[i], g_app.blurH[i], GL_COLOR_BUFFER_BIT, GL_LINEAR);
  }
  xglBindFramebuffer(GL_READ_FRAMEBUFFER, g_app.blurFbo[0]); xglBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
  xglBlitFramebuffer(0, 0, g_app.blurW[0], g_app.blurH[0], 0, 0, W, H, GL_COLOR_BUFFER_BIT, GL_LINEAR);
}

static void pngWriteCb(void* ctx, void* data, int size) { auto* v = (std::vector<uint8_t>*)ctx; v->insert(v->end(), (uint8_t*)data, (uint8_t*)data + size); }

// Lit l'image du jeu (à l'endroit) à la taille demandée ; maxW = 0 → taille native
static bool grabGame(std::vector<uint8_t>& png, int maxW) {
  if (!g_app.haveFrame) return false;
  int fw = g_app.frameW, fh = g_app.frameH;
  float ar = g_core.av.geometry.aspect_ratio > 0 ? g_core.av.geometry.aspect_ratio : (float)fw / fh;
  int w = maxW ? maxW : std::max(fw, (int)std::lround(fh * ar)), h = (int)std::lround(w / ar);
  if (w > 4096) { w = 4096; h = (int)std::lround(w / ar); }
  GLuint tex = 0, fbo = 0; allocTex(tex, w, h); attach(fbo, tex);
  blitGame(fbo, 0, 0, w, h, GL_LINEAR);
  std::vector<uint8_t> px((size_t)w * h * 4);
  xglBindFramebuffer(GL_READ_FRAMEBUFFER, fbo);
  xglBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
  xglPixelStorei(GL_PACK_ALIGNMENT, 4); xglPixelStorei(GL_PACK_ROW_LENGTH, 0);
  xglReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
  xglBindFramebuffer(GL_FRAMEBUFFER, 0);
  xglDeleteFramebuffers(1, &fbo); xglDeleteTextures(1, &tex);
  for (size_t i = 3; i < px.size(); i += 4) px[i] = 255;
  stbi_flip_vertically_on_write(1);
  png.clear();
  return stbi_write_png_to_func(pngWriteCb, &png, w, h, 4, px.data(), w * 4) != 0;
}

// Capture de l'écran complet (menu compris) — pour les tests automatiques
void captureScreen(const std::string& path) {
  std::vector<uint8_t> px((size_t)g_app.winW * g_app.winH * 4), png;
  xglBindFramebuffer(GL_READ_FRAMEBUFFER, 0);
  xglPixelStorei(GL_PACK_ALIGNMENT, 4);
  xglReadPixels(0, 0, g_app.winW, g_app.winH, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
  for (size_t i = 3; i < px.size(); i += 4) px[i] = 255;
  stbi_flip_vertically_on_write(1);
  stbi_write_png_to_func(pngWriteCb, &png, g_app.winW, g_app.winH, 4, px.data(), g_app.winW * 4);
  writeFile(path, png.data(), png.size());
}

// ───────────────────────────── Audio ─────────────────────────────
static size_t RETRO_CALLCONV audioBatchCb(const int16_t* d, size_t frames) {
  if (!g_app.audio || g_app.speedMode == 1) return frames; // en turbo, on coupe le son
  int queued = SDL_GetAudioStreamQueued(g_app.audio);
  int limit = (int)(g_core.av.timing.sample_rate * 4 * 0.15);
  if (queued < limit) SDL_PutAudioStreamData(g_app.audio, d, (int)(frames * 4));
  return frames;
}
static void RETRO_CALLCONV audioCb(int16_t l, int16_t r) { int16_t s[2] = { l, r }; audioBatchCb(s, 1); }

void App::setVolume(int v) {
  v = std::clamp(v, 0, 100); cfg.seti("volume", v);
  if (audio) SDL_SetAudioStreamGain(audio, cfg.getb("mute", false) ? 0.f : v / 100.f);
}

// ───────────────────────────── Entrées ─────────────────────────────
static void RETRO_CALLCONV inputPollCb() {
  if (g_app.ctlWatch.Changed()) ArcadiaControls::Load(g_app.ctlWatch.path, g_app.controls); // réglé depuis Arcadia ou un autre moteur
  for (int p = 0; p < 4; p++) {
    uint16_t m = 0; SDL_Gamepad* g = g_app.pads[p];
    namespace AC = ArcadiaControls;
    const bool custom = p == 0 && g_app.controls.loaded;
    if (custom && g_app.controls.device == AC::KEYBOARD) g = nullptr; // clavier seul
    if (g && !g_app.menuOpen) {
    if (custom) { // joueur 1 : touches réattribuées
      static const int kRetro[AC::HOME] = { RETRO_DEVICE_ID_JOYPAD_A, RETRO_DEVICE_ID_JOYPAD_B, RETRO_DEVICE_ID_JOYPAD_X, RETRO_DEVICE_ID_JOYPAD_Y,
        RETRO_DEVICE_ID_JOYPAD_L, RETRO_DEVICE_ID_JOYPAD_R, RETRO_DEVICE_ID_JOYPAD_L2, RETRO_DEVICE_ID_JOYPAD_R2, RETRO_DEVICE_ID_JOYPAD_START,
        RETRO_DEVICE_ID_JOYPAD_SELECT, RETRO_DEVICE_ID_JOYPAD_L3, RETRO_DEVICE_ID_JOYPAD_R3, RETRO_DEVICE_ID_JOYPAD_UP, RETRO_DEVICE_ID_JOYPAD_DOWN,
        RETRO_DEVICE_ID_JOYPAD_LEFT, RETRO_DEVICE_ID_JOYPAD_RIGHT };
      for (int a = 0; a < AC::HOME; a++) for (int c : g_app.controls.pad[a]) if (AC::PadDown(g, c)) m |= 1 << kRetro[a];
    } else {
      auto b = [&](SDL_GamepadButton sb, int id) { if (SDL_GetGamepadButton(g, sb)) m |= 1 << id; };
      b(SDL_GAMEPAD_BUTTON_SOUTH, RETRO_DEVICE_ID_JOYPAD_B); b(SDL_GAMEPAD_BUTTON_EAST, RETRO_DEVICE_ID_JOYPAD_A);
      b(SDL_GAMEPAD_BUTTON_WEST, RETRO_DEVICE_ID_JOYPAD_Y); b(SDL_GAMEPAD_BUTTON_NORTH, RETRO_DEVICE_ID_JOYPAD_X);
      b(SDL_GAMEPAD_BUTTON_BACK, RETRO_DEVICE_ID_JOYPAD_SELECT); b(SDL_GAMEPAD_BUTTON_START, RETRO_DEVICE_ID_JOYPAD_START);
      b(SDL_GAMEPAD_BUTTON_DPAD_UP, RETRO_DEVICE_ID_JOYPAD_UP); b(SDL_GAMEPAD_BUTTON_DPAD_DOWN, RETRO_DEVICE_ID_JOYPAD_DOWN);
      b(SDL_GAMEPAD_BUTTON_DPAD_LEFT, RETRO_DEVICE_ID_JOYPAD_LEFT); b(SDL_GAMEPAD_BUTTON_DPAD_RIGHT, RETRO_DEVICE_ID_JOYPAD_RIGHT);
      b(SDL_GAMEPAD_BUTTON_LEFT_SHOULDER, RETRO_DEVICE_ID_JOYPAD_L); b(SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER, RETRO_DEVICE_ID_JOYPAD_R);
      b(SDL_GAMEPAD_BUTTON_LEFT_STICK, RETRO_DEVICE_ID_JOYPAD_L3); b(SDL_GAMEPAD_BUTTON_RIGHT_STICK, RETRO_DEVICE_ID_JOYPAD_R3);
      if (SDL_GetGamepadAxis(g, SDL_GAMEPAD_AXIS_LEFT_TRIGGER) > 12000) m |= 1 << RETRO_DEVICE_ID_JOYPAD_L2;
      if (SDL_GetGamepadAxis(g, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER) > 12000) m |= 1 << RETRO_DEVICE_ID_JOYPAD_R2;
    }
      float dz = g_app.cfg.geti("deadzone", 15) / 100.f;
      for (int s = 0; s < 2; s++) {
        float x = SDL_GetGamepadAxis(g, s ? SDL_GAMEPAD_AXIS_RIGHTX : SDL_GAMEPAD_AXIS_LEFTX) / 32767.f;
        float y = SDL_GetGamepadAxis(g, s ? SDL_GAMEPAD_AXIS_RIGHTY : SDL_GAMEPAD_AXIS_LEFTY) / 32767.f;
        float mag = std::sqrt(x * x + y * y);
        if (mag < dz) { x = y = 0; } else { float k = std::min(1.f, (mag - dz) / (1 - dz)) / mag; x *= k; y *= k; }
        g_app.padAxis[p][s * 2] = (int16_t)std::clamp(x * 32767.f, -32767.f, 32767.f);
        g_app.padAxis[p][s * 2 + 1] = (int16_t)std::clamp(y * 32767.f, -32767.f, 32767.f);
      }
      g_app.padAxis[p][4] = SDL_GetGamepadAxis(g, SDL_GAMEPAD_AXIS_LEFT_TRIGGER);
      g_app.padAxis[p][5] = SDL_GetGamepadAxis(g, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER);
      if (custom && g_app.controls.device == AC::STICK) { // stick arcade : le levier (croix) pilote aussi le stick gauche
        int sx = (SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_DPAD_RIGHT) ? 1 : 0) - (SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_DPAD_LEFT) ? 1 : 0);
        int sy = (SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_DPAD_DOWN) ? 1 : 0) - (SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_DPAD_UP) ? 1 : 0);
        if (sx || sy) { g_app.padAxis[p][0] = (int16_t)(sx * 32767); g_app.padAxis[p][1] = (int16_t)(sy * 32767); }
      }
    } else { memset(g_app.padAxis[p], 0, sizeof g_app.padAxis[p]); }
    if (p == 0 && !g_app.menuOpen && custom) { // clavier réattribué → joueur 1
      if (g_app.controls.device == AC::BOTH || g_app.controls.device == AC::KEYBOARD) {
        int nk = 0; const bool* k = SDL_GetKeyboardState(&nk);
        static const int kRetro[AC::HOME] = { RETRO_DEVICE_ID_JOYPAD_A, RETRO_DEVICE_ID_JOYPAD_B, RETRO_DEVICE_ID_JOYPAD_X, RETRO_DEVICE_ID_JOYPAD_Y,
          RETRO_DEVICE_ID_JOYPAD_L, RETRO_DEVICE_ID_JOYPAD_R, RETRO_DEVICE_ID_JOYPAD_L2, RETRO_DEVICE_ID_JOYPAD_R2, RETRO_DEVICE_ID_JOYPAD_START,
          RETRO_DEVICE_ID_JOYPAD_SELECT, RETRO_DEVICE_ID_JOYPAD_L3, RETRO_DEVICE_ID_JOYPAD_R3, RETRO_DEVICE_ID_JOYPAD_UP, RETRO_DEVICE_ID_JOYPAD_DOWN,
          RETRO_DEVICE_ID_JOYPAD_LEFT, RETRO_DEVICE_ID_JOYPAD_RIGHT };
        for (int a = 0; a < AC::HOME; a++) for (int sc : g_app.controls.kb[a]) if (AC::KeyDown(k, nk, sc)) m |= 1 << kRetro[a];
        // sticks au clavier : la direction tenue l'emporte sur le stick de la manette
        for (int st = 0; st < 2; st++) {
          int base = st ? AC::RS_UP : AC::LS_UP; int kx = 0, ky = 0;
          for (int sc : g_app.controls.kb[base + 3]) if (AC::KeyDown(k, nk, sc)) kx++;
          for (int sc : g_app.controls.kb[base + 2]) if (AC::KeyDown(k, nk, sc)) kx--;
          for (int sc : g_app.controls.kb[base + 1]) if (AC::KeyDown(k, nk, sc)) ky++;
          for (int sc : g_app.controls.kb[base + 0]) if (AC::KeyDown(k, nk, sc)) ky--;
          if (kx || ky) { float n = std::sqrt((float)(kx * kx + ky * ky)); g_app.padAxis[0][st * 2] = (int16_t)(kx / n * 32767); g_app.padAxis[0][st * 2 + 1] = (int16_t)(ky / n * 32767); }
        }
      }
    } else if (p == 0 && !g_app.menuOpen) { // clavier → joueur 1
      const bool* k = SDL_GetKeyboardState(nullptr);
      auto kb = [&](SDL_Scancode sc, int id) { if (k[sc]) m |= 1 << id; };
      kb(SDL_SCANCODE_UP, RETRO_DEVICE_ID_JOYPAD_UP); kb(SDL_SCANCODE_DOWN, RETRO_DEVICE_ID_JOYPAD_DOWN);
      kb(SDL_SCANCODE_LEFT, RETRO_DEVICE_ID_JOYPAD_LEFT); kb(SDL_SCANCODE_RIGHT, RETRO_DEVICE_ID_JOYPAD_RIGHT);
      kb(SDL_SCANCODE_Z, RETRO_DEVICE_ID_JOYPAD_B); kb(SDL_SCANCODE_X, RETRO_DEVICE_ID_JOYPAD_A);
      kb(SDL_SCANCODE_A, RETRO_DEVICE_ID_JOYPAD_Y); kb(SDL_SCANCODE_S, RETRO_DEVICE_ID_JOYPAD_X);
      kb(SDL_SCANCODE_Q, RETRO_DEVICE_ID_JOYPAD_L); kb(SDL_SCANCODE_W, RETRO_DEVICE_ID_JOYPAD_R);
      kb(SDL_SCANCODE_RETURN, RETRO_DEVICE_ID_JOYPAD_START); kb(SDL_SCANCODE_RSHIFT, RETRO_DEVICE_ID_JOYPAD_SELECT);
      kb(SDL_SCANCODE_BACKSPACE, RETRO_DEVICE_ID_JOYPAD_SELECT);
    }
    g_app.padMask[p] = m;
  }
  // Pointeur : souris par défaut ; sur DS, le stick droit déplace un curseur virtuel (clic du stick = toucher)
  if (!g_app.menuOpen) {
    float mx, my; SDL_MouseButtonFlags mb = SDL_GetMouseState(&mx, &my);
    int ww, wh; SDL_GetWindowSize(g_app.window, &ww, &wh);
    float k = ww ? (float)g_app.winW / ww : 1.f;
    SDL_Gamepad* g = g_app.pads[0];
    bool ds = g_app.console == "DS" || g_app.console == "NDS";
    if (ds && g) {
      float rx = g_app.padAxis[0][2] / 32767.f, ry = g_app.padAxis[0][3] / 32767.f;
      if (rx != 0 || ry != 0) {
        if (!g_app.ptrVirtual) { g_app.ptrVirtual = true; g_app.ptrX = g_app.viewX + g_app.viewW * .5f; g_app.ptrY = g_app.viewY + g_app.viewH * .75f; }
        float sp = g_app.viewH * 0.018f;
        g_app.ptrX = std::clamp(g_app.ptrX + rx * sp, (float)g_app.viewX, (float)(g_app.viewX + g_app.viewW - 1));
        g_app.ptrY = std::clamp(g_app.ptrY + ry * sp, (float)g_app.viewY, (float)(g_app.viewY + g_app.viewH - 1));
      }
    }
    if (SDL_GetTicks() - g_app.lastMouseMove < 100 && g_app.lastMouseMove) g_app.ptrVirtual = false;
    if (g_app.ptrVirtual) g_app.ptrDown = g && SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_RIGHT_STICK);
    else { g_app.ptrX = mx * k; g_app.ptrY = my * k; g_app.ptrDown = (mb & SDL_BUTTON_LMASK) != 0; }
  } else g_app.ptrDown = false;
}

static int16_t RETRO_CALLCONV inputStateCb(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port >= 4) return 0;
  device &= RETRO_DEVICE_MASK;
  if (device == RETRO_DEVICE_JOYPAD) {
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return (int16_t)g_app.padMask[port];
    return id < 16 ? (g_app.padMask[port] >> id) & 1 : 0;
  }
  if (device == RETRO_DEVICE_POINTER && port == 0) {
    float nx = (g_app.ptrX - g_app.viewX) / g_app.viewW, ny = (g_app.ptrY - g_app.viewY) / g_app.viewH;
    bool inside = nx >= 0 && nx < 1 && ny >= 0 && ny < 1;
    if (id == RETRO_DEVICE_ID_POINTER_X) return inside ? (int16_t)std::lround(nx * 0xFFFE - 0x7FFF) : -0x8000;
    if (id == RETRO_DEVICE_ID_POINTER_Y) return inside ? (int16_t)std::lround(ny * 0xFFFE - 0x7FFF) : -0x8000;
    if (id == RETRO_DEVICE_ID_POINTER_PRESSED) return inside && g_app.ptrDown;
    return 0;
  }
  if (device == RETRO_DEVICE_MOUSE && port == 0) {
    if (id == RETRO_DEVICE_ID_MOUSE_X) { int16_t v = (int16_t)g_app.mouseDX; return v; }
    if (id == RETRO_DEVICE_ID_MOUSE_Y) { int16_t v = (int16_t)g_app.mouseDY; return v; }
    if (id == RETRO_DEVICE_ID_MOUSE_LEFT) return g_app.ptrDown;
    if (id == RETRO_DEVICE_ID_MOUSE_RIGHT) return (SDL_GetMouseState(nullptr, nullptr) & SDL_BUTTON_RMASK) != 0;
    return 0;
  }
  if (device == RETRO_DEVICE_ANALOG) {
    if (index == RETRO_DEVICE_INDEX_ANALOG_BUTTON) {
      if (id == RETRO_DEVICE_ID_JOYPAD_L2) return g_app.padAxis[port][4];
      if (id == RETRO_DEVICE_ID_JOYPAD_R2) return g_app.padAxis[port][5];
      return id < 16 && ((g_app.padMask[port] >> id) & 1) ? 0x7fff : 0;
    }
    if (index <= RETRO_DEVICE_INDEX_ANALOG_RIGHT && id <= 1) return g_app.padAxis[port][index * 2 + id];
  }
  return 0;
}

static std::string g_padFirst;
static void openPads();
void reopenPads() { openPads(); }
static void openPads() {
  int n = 0; SDL_JoystickID* ids = SDL_GetGamepads(&n);
  // la manette choisie dans Arcadia passe devant les autres (joueur 1)
  if (!g_padFirst.empty()) for (int i = 1; i < n; i++) {
    char gb[64]; SDL_GUIDToString(SDL_GetJoystickGUIDForID(ids[i]), gb, sizeof gb);
    if (g_padFirst == gb) { std::swap(ids[0], ids[i]); break; }
  }
  for (int p = 0; p < 4; p++) if (g_app.pads[p] && !SDL_GamepadConnected(g_app.pads[p])) { SDL_CloseGamepad(g_app.pads[p]); g_app.pads[p] = nullptr; }
  for (int i = 0; i < n; i++) {
    bool have = false; for (auto* g : g_app.pads) if (g && SDL_GetGamepadID(g) == ids[i]) have = true;
    if (have) continue;
    for (int p = 0; p < 4; p++) if (!g_app.pads[p]) { g_app.pads[p] = SDL_OpenGamepad(ids[i]); break; }
  }
  SDL_free(ids);
}

// ───────────────────────────── Réglages ─────────────────────────────
void App::loadConfig() {
  cfgConsolePath = joinPath(configDir, safeName(console.empty() ? "defaut" : console) + ".ini");
  cfgGamePath = joinPath(joinPath(configDir, "jeux"), safeName(gameKey) + ".ini");
  cfg = Config(); cfg.load(cfgConsolePath);
  Config g; perGame = g.load(cfgGamePath) && g.getb("pergame", false);
  if (perGame) cfg = g;
  // consoles rétro : pixels nets par défaut (le lissage floute le pixel art)
  static const char* kPixel[] = { "NES", "SNES", "GB", "GBC", "GBA", "MEGADRIVE" };
  if (!cfg.kv.count("filter")) for (auto* c : kPixel) if (console == c) cfg.set("filter", "nearest");
}
void App::saveConfig() {
  for (auto& o : g_core.options) {
    if (isSessionOpt(o.key)) continue; // réglages de session (multijoueur) : jamais enregistrés
    if (o.value == o.def && cfg.get("core:" + o.key).empty()) continue;
    cfg.set("core:" + o.key, o.value);
  }
  cfg.setb("pergame", perGame);
  if (perGame) { SDL_CreateDirectory(joinPath(configDir, "jeux").c_str()); cfg.save(cfgGamePath); }
  else { SDL_CreateDirectory(configDir.c_str()); cfg.save(cfgConsolePath); SDL_RemovePath(cfgGamePath.c_str()); }
}
void App::applyConfig() { setVolume(cfg.geti("volume", 100)); }

// ───────────────────────────── Actions ─────────────────────────────
void App::openMenu() {
  if (menuOpen) return;
  menuOpen = true; paused = true; refreshSlots();
  SDL_ShowCursor(); emit("{\"event\":\"pause\"}");
  if (audio) SDL_PauseAudioStreamDevice(audio);
}
void App::closeMenu() {
  if (!menuOpen) return;
  menuOpen = false; paused = false; saveConfig();
  SDL_HideCursor(); emit("{\"event\":\"resume\"}");
  if (audio) { SDL_ClearAudioStream(audio); SDL_ResumeAudioStreamDevice(audio); }
}

static std::string slotBase(int slot) { return joinPath(g_app.statesDir, slot == 0 ? std::string("reprise") : "emplacement-" + std::to_string(slot)); }

bool App::saveSlot(int slot, bool silent) {
  std::vector<uint8_t> st, png;
  if (!g_core.saveState(st)) { if (!silent) toast("Ce jeu refuse la sauvegarde rapide pour l'instant"); return false; }
  SDL_CreateDirectory(statesDir.c_str());
  bool ok = writeFile(slotBase(slot) + ".state", st.data(), st.size());
  if (ok && grabGame(png, 480)) writeFile(slotBase(slot) + ".png", png.data(), png.size());
  if (!silent) toast(ok ? (slot ? "Sauvegardé dans l'emplacement " + std::to_string(slot) : "Partie sauvegardée") : "Échec de la sauvegarde");
  emit(std::string("{\"event\":\"state\",\"slot\":") + std::to_string(slot) + ",\"ok\":" + (ok ? "true" : "false") + "}");
  return ok;
}
bool App::loadSlot(int slot) {
  std::vector<uint8_t> st;
  if (!readFile(slotBase(slot) + ".state", st)) { toast("Emplacement vide"); return false; }
  bool ok = g_core.loadState(st);
  toast(ok ? (slot ? "Emplacement " + std::to_string(slot) + " chargé" : "Reprise de ta partie") : "Impossible de charger cette sauvegarde");
  return ok;
}
void App::refreshSlots() {
  for (int i = 0; i < 7; i++) {
    SlotInfo& s = slots[i];
    if (s.thumb) { xglDeleteTextures(1, &s.thumb); s.thumb = 0; }
    SDL_PathInfo pi; s.exists = SDL_GetPathInfo((slotBase(i) + ".state").c_str(), &pi) && pi.type == SDL_PATHTYPE_FILE;
    s.date.clear(); s.mtime = 0;
    if (!s.exists) continue;
    s.mtime = pi.modify_time;
    SDL_DateTime dt;
    if (SDL_TimeToDateTime(pi.modify_time, &dt, true)) {
      char b[64]; SDL_snprintf(b, sizeof b, "%02d/%02d/%04d · %02d:%02d", dt.day, dt.month, dt.year, dt.hour, dt.minute); s.date = b;
    }
    std::vector<uint8_t> png;
    if (readFile(slotBase(i) + ".png", png)) {
      int w, h, c; uint8_t* px = stbi_load_from_memory(png.data(), (int)png.size(), &w, &h, &c, 4);
      if (px) { allocTex(s.thumb, w, h); xglBindTexture(GL_TEXTURE_2D, s.thumb); xglTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, px); xglBindTexture(GL_TEXTURE_2D, 0); s.tw = w; s.th = h; stbi_image_free(px); }
    }
  }
}
int App::saveNow() {
  refreshSlots();
  int slot = 0;
  for (int i = 1; i <= 6; i++) if (!slots[i].exists) { slot = i; break; }
  if (!slot) { slot = 1; for (int i = 2; i <= 6; i++) if (slots[i].mtime < slots[slot].mtime) slot = i; }
  if (!saveSlot(slot, true)) { toast("Ce jeu refuse la sauvegarde rapide pour l'instant"); return 0; }
  refreshSlots();
  toast("Sauvegardé dans l'emplacement " + std::to_string(slot), 3000);
  return slot;
}
void App::openFolder(const std::string& dir) {
  SDL_CreateDirectory(dir.c_str());
  std::string u = dir; for (auto& c : u) if (c == '\\') c = '/';
  if (SDL_OpenURL(("file:///" + u).c_str())) {
    if (SDL_GetWindowFlags(window) & SDL_WINDOW_FULLSCREEN) SDL_MinimizeWindow(window); // l'Explorateur passe devant
  } else toast("Impossible d'ouvrir le dossier");
}
void App::screenshot() {
  std::vector<uint8_t> png;
  if (!grabGame(png, 0)) return;
  SDL_CreateDirectory(shotsDir.c_str());
  SDL_Time t; SDL_GetCurrentTime(&t); SDL_DateTime dt; SDL_TimeToDateTime(t, &dt, true);
  char b[96]; SDL_snprintf(b, sizeof b, " %04d-%02d-%02d %02d-%02d-%02d.png", dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
  std::string p = joinPath(shotsDir, safeName(title) + b);
  if (writeFile(p, png.data(), png.size())) { toast("Capture enregistrée"); emit("{\"event\":\"screenshot\",\"path\":\"" + jsonEsc(p) + "\"}"); }
}
void App::setSpeed(int mode) {
  speedMode = mode; speed = mode == 1 ? 2.0 : mode == 2 ? 0.5 : 1.0;
  toast(mode == 1 ? "Turbo ×2" : mode == 2 ? "Ralenti ×0,5" : "Vitesse normale", 1400);
}
// Calibrage depuis le menu : une fenêtre « Appuie sur A » s'ouvre, le jeu reste en pause ; la nouvelle
// correspondance est appliquée tout de suite et transmise à Arcadia (tous les jeux en profitent).
static std::atomic<int> g_calibDone{ 0 }; static std::string g_calibOut;
void App::calibrate() {
  const char* base = SDL_GetBasePath();
  static std::string exe; exe = std::string(base ? base : "") + "arcadia-runner" + (SDL_GetPlatform() == std::string("Windows") ? ".exe" : "");
  static std::vector<std::string> args; args = { exe, "--calibrate", "--layout", padLayout };
  if (!padDb.empty()) { args.push_back("--pad-db"); args.push_back(padDb); }
  calibState = 1; toast("Calibrage : suis les indications de la fenêtre", 3000);
  std::thread([] {
    std::vector<const char*> av; for (auto& a : args) av.push_back(a.c_str()); av.push_back(nullptr);
    SDL_Process* pr = SDL_CreateProcess(av.data(), true);
    std::string out;
    if (pr) { size_t n = 0; int code = 0; void* d = SDL_ReadProcess(pr, &n, &code); if (d) { out.assign((char*)d, n); SDL_free(d); } SDL_DestroyProcess(pr); }
    g_calibOut = out; g_calibDone = 1;
  }).detach();
}
static void pollCalibration() {
  if (!g_calibDone.exchange(0)) return;
  g_app.calibState = 0;
  size_t i = g_calibOut.find("{\"event\":\"pad\"");
  if (i == std::string::npos) { g_app.toast("Calibrage annulé", 2000); return; }
  std::string line = g_calibOut.substr(i, g_calibOut.find('\n', i) - i);
  size_t m = line.find("\"mapping\":\""); std::string map;
  if (m != std::string::npos) { size_t a = m + 11, b = line.find('"', a); while (b != std::string::npos && line[b - 1] == '\\') b = line.find('"', b + 1); map = line.substr(a, b - a); }
  if (!map.empty()) SDL_AddGamepadMapping(map.c_str());
  for (auto*& p : g_app.pads) if (p) { SDL_CloseGamepad(p); p = nullptr; }
  extern void reopenPads(); reopenPads();
  emit(line); // Arcadia l'enregistre pour tous les jeux et tous les moteurs
  g_app.toast("Manette prête", 2200);
}
void App::restart() { g_core.reset(); toast("Jeu redémarré"); }
void App::quit() { wantQuit = true; }

// ───────────────────────────── Raccourcis ─────────────────────────────
static void guideCombo(SDL_GamepadButton b) {
  g_app.guideUsed = true;
  switch (b) {
  case SDL_GAMEPAD_BUTTON_DPAD_UP: g_app.setVolume(g_app.cfg.geti("volume", 100) + 10); g_app.toast("Volume " + std::to_string(g_app.cfg.geti("volume", 100)) + " %", 1200); break;
  case SDL_GAMEPAD_BUTTON_DPAD_DOWN: g_app.setVolume(g_app.cfg.geti("volume", 100) - 10); g_app.toast("Volume " + std::to_string(g_app.cfg.geti("volume", 100)) + " %", 1200); break;
  case SDL_GAMEPAD_BUTTON_DPAD_RIGHT: g_app.cfg.setb("mute", !g_app.cfg.getb("mute", false)); g_app.applyConfig(); g_app.toast(g_app.cfg.getb("mute", false) ? "Son coupé" : "Son rétabli", 1200); break;
  case SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER: g_app.setSpeed(g_app.speedMode == 1 ? 0 : 1); break;
  case SDL_GAMEPAD_BUTTON_LEFT_SHOULDER: { bool lin = g_app.cfg.get("filter", "linear") == "linear"; g_app.cfg.set("filter", lin ? "nearest" : "linear"); g_app.toast(lin ? "Filtre : net" : "Filtre : lisse", 1200); break; }
  case SDL_GAMEPAD_BUTTON_NORTH: g_app.screenshot(); break;
  case SDL_GAMEPAD_BUTTON_WEST: g_app.saveNow(); break;
  case SDL_GAMEPAD_BUTTON_BACK: g_app.setSpeed(g_app.speedMode == 2 ? 0 : 2); break;
  default: g_app.guideUsed = false; break;
  }
}

// Menu « Contrôles » : la prochaine touche ou le prochain bouton est attribué à l'action choisie
static bool captureEvent(const SDL_Event& e) {
  if (g_app.capAction < 0) return false;
  if (SDL_GetTicks() - g_app.capT0 < 250) return e.type == SDL_EVENT_KEY_DOWN || e.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN; // le clic qui a lancé la capture
  int code = -1; bool kb = false;
  if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
    if (e.key.scancode == SDL_SCANCODE_ESCAPE) { g_app.capAction = -1; g_app.toast("Réattribution annulée", 1200); return true; }
    if (!g_app.capKeyboard) return true;
    code = e.key.scancode; kb = true;
  } else if (e.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN && e.gbutton.button != SDL_GAMEPAD_BUTTON_GUIDE) {
    if (g_app.capKeyboard) return true;
    code = e.gbutton.button;
  } else if (e.type == SDL_EVENT_GAMEPAD_AXIS_MOTION && !g_app.capKeyboard && e.gaxis.value > 20000 &&
             (e.gaxis.axis == SDL_GAMEPAD_AXIS_LEFT_TRIGGER || e.gaxis.axis == SDL_GAMEPAD_AXIS_RIGHT_TRIGGER)) {
    code = e.gaxis.axis == SDL_GAMEPAD_AXIS_LEFT_TRIGGER ? ArcadiaControls::PAD_LT : ArcadiaControls::PAD_RT;
  } else return e.type == SDL_EVENT_KEY_DOWN || e.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN || e.type == SDL_EVENT_GAMEPAD_AXIS_MOTION;
  ArcadiaControls::Assign(g_app.controls, kb, g_app.capAction, code);
  g_app.controls.loaded = true;
  if (!g_app.ctlWatch.path.empty()) { ArcadiaControls::Save(g_app.ctlWatch.path, g_app.controls); g_app.ctlWatch.Touch(); }
  g_app.toast(std::string(ArcadiaControls::kActionNames[g_app.capAction]) + " \xE2\x86\x92 " + (kb ? ArcadiaControls::KeyLabel(code) : ArcadiaControls::PadLabel(code)), 1500);
  g_app.capAction = -1;
  return true;
}

static void handleEvent(SDL_Event& e) {
  switch (e.type) {
  case SDL_EVENT_QUIT: g_app.quit(); break;
  case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED: SDL_GetWindowSizeInPixels(g_app.window, &g_app.winW, &g_app.winH); break;
  case SDL_EVENT_WINDOW_FOCUS_LOST:
    if (g_app.cfg.getb("pausefocus", true) && !g_app.resumePrompt && !g_app.autotest) g_app.openMenu();
    break;
  case SDL_EVENT_GAMEPAD_ADDED: case SDL_EVENT_GAMEPAD_REMOVED: openPads(); break;
  case SDL_EVENT_MOUSE_MOTION:
    g_app.mouseDX += e.motion.xrel; g_app.mouseDY += e.motion.yrel; g_app.lastMouseMove = SDL_GetTicks();
    if (!g_app.menuOpen && !g_app.resumePrompt) SDL_ShowCursor();
    break;
  case SDL_EVENT_KEY_DOWN:
    if (e.key.repeat) break;
    if (e.key.key == SDLK_ESCAPE && !g_app.resumePrompt) { if (!g_app.menuOpen) g_app.openMenu(); else if (!uiWantsInput()) g_app.closeMenu(); }
    else if (e.key.key == SDLK_F11) { bool fs = SDL_GetWindowFlags(g_app.window) & SDL_WINDOW_FULLSCREEN; SDL_SetWindowFullscreen(g_app.window, !fs); }
    else if (e.key.key == SDLK_F12) g_app.screenshot();
    else if (!g_app.menuOpen && e.key.key == SDLK_F5) g_app.saveNow();
    else if (!g_app.menuOpen && e.key.key == SDLK_F8) g_app.loadSlot(1);
    else if (!g_app.menuOpen && e.key.key == SDLK_TAB) g_app.setSpeed(g_app.speedMode == 1 ? 0 : 1);
    break;
  case SDL_EVENT_GAMEPAD_BUTTON_DOWN: {
    auto b = (SDL_GamepadButton)e.gbutton.button;
    if (b == SDL_GAMEPAD_BUTTON_GUIDE) { g_app.guideHeld = true; g_app.guideUsed = false; break; }
    if (g_app.guideHeld && !g_app.menuOpen) { guideCombo(b); break; }
    SDL_Gamepad* g = SDL_GetGamepadFromID(e.gbutton.which);
    if (g && SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_BACK) && SDL_GetGamepadButton(g, SDL_GAMEPAD_BUTTON_START)) g_app.comboT0 = SDL_GetTicks();
    break;
  }
  case SDL_EVENT_GAMEPAD_BUTTON_UP: {
    auto b = (SDL_GamepadButton)e.gbutton.button;
    if (b == SDL_GAMEPAD_BUTTON_GUIDE) {
      if (!g_app.guideUsed && !g_app.resumePrompt) { if (g_app.menuOpen) g_app.closeMenu(); else g_app.openMenu(); }
      g_app.guideHeld = false;
    }
    if ((b == SDL_GAMEPAD_BUTTON_BACK || b == SDL_GAMEPAD_BUTTON_START) && g_app.comboT0) {
      uint64_t held = SDL_GetTicks() - g_app.comboT0; g_app.comboT0 = 0;
      if (held < 1500 && !g_app.menuOpen && !g_app.resumePrompt) g_app.openMenu(); // Back+Start bref = menu
    }
    break;
  }
  }
}

// ───────────────────────────── Programme ─────────────────────────────
static std::string argOf(int argc, char** argv, const char* name, const std::string& def = "") {
  for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], name)) return argv[i + 1];
  return def;
}
static bool hasArg(int argc, char** argv, const char* name) { for (int i = 1; i < argc; i++) if (!strcmp(argv[i], name)) return true; return false; }

static int fail(const std::string& msg) {
  emit("{\"event\":\"error\",\"message\":\"" + jsonEsc(msg) + "\"}");
  SDL_Log("%s", msg.c_str());
  if (!g_app.autotest) SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Arcadia", msg.c_str(), g_app.window);
  return 1;
}

int main(int argc, char** argv) {
  if (hasArg(argc, argv, "--calibrate")) return runCalibration(argc, argv);
  const char* base = SDL_GetBasePath(); std::string exeDir = base ? base : "./";
  g_app.corePath = argOf(argc, argv, "--core"); g_app.gamePath = argOf(argc, argv, "--game");
  g_app.title = argOf(argc, argv, "--title", "Jeu"); g_app.console = argOf(argc, argv, "--console", "");
  g_app.gameKey = argOf(argc, argv, "--key", g_app.title);
  std::string data = argOf(argc, argv, "--data", joinPath(exeDir, "data"));
  g_app.systemDir = argOf(argc, argv, "--system", joinPath(data, "system"));
  g_app.savesDir = argOf(argc, argv, "--saves", joinPath(data, "saves"));
  g_app.statesDir = argOf(argc, argv, "--states", joinPath(joinPath(data, "states"), safeName(g_app.gameKey)));
  g_app.shotsDir = argOf(argc, argv, "--shots", joinPath(data, "captures"));
  g_app.configDir = argOf(argc, argv, "--config", joinPath(data, "config"));
  g_app.windowed = hasArg(argc, argv, "--windowed");
  captureUiPath = argOf(argc, argv, "--capture"); captureAt = SDL_atoi(argOf(argc, argv, "--capture-at", "-1").c_str());
  menuAt = SDL_atoi(argOf(argc, argv, "--menu-at", "-1").c_str()); quitAt = SDL_atoi(argOf(argc, argv, "--quit-at", "-1").c_str());
  resumeAt = SDL_atoi(argOf(argc, argv, "--resume-at", "-1").c_str());
  g_app.autotest = quitAt > 0;
  for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], "--opt")) {
    std::string kv = argv[i + 1]; size_t eq = kv.find('=');
    if (eq != std::string::npos) g_sessionOpts.push_back({ kv.substr(0, eq), kv.substr(eq + 1) });
  }
  std::string notice = argOf(argc, argv, "--notice");
  { extern int g_debugSection; g_debugSection = SDL_atoi(argOf(argc, argv, "--section", "-1").c_str()); }
  if (g_app.corePath.empty()) return fail("Aucun cœur indiqué (--core).");

  for (auto* d : { &g_app.systemDir, &g_app.savesDir, &g_app.configDir }) SDL_CreateDirectory(d->c_str());
  g_core.systemDir = g_app.systemDir; g_core.saveDir = g_app.savesDir;
  g_app.loadConfig();

  SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
  if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_GAMEPAD)) return fail(std::string("SDL : ") + SDL_GetError());
  // manettes calibrées dans Arcadia + manette préférée en joueur 1
  { std::string db = argOf(argc, argv, "--pad-db"); g_app.padDb = db; if (!db.empty()) SDL_AddGamepadMappingsFromFile(db.c_str()); }
  g_app.padLayout = argOf(argc, argv, "--pad-layout", "xbox");
  if (hasArg(argc, argv, "--no-hint")) g_app.hintOff = true; // aide des contrôles désactivée dans Arcadia
  g_padFirst = argOf(argc, argv, "--pad-first");
  g_app.ctlWatch.path = argOf(argc, argv, "--controls");
  if (!g_app.ctlWatch.path.empty()) { ArcadiaControls::Load(g_app.ctlWatch.path, g_app.controls); g_app.ctlWatch.Touch(); }

  std::string err;
  if (!g_core.open(g_app.corePath, err)) return fail(err);
  g_core.set_environment(envCb);
  g_core.init();  // avant les callbacks : certains cœurs (Mesen) en ont besoin
  g_core.set_video_refresh(videoCb); g_core.set_audio_sample(audioCb); g_core.set_audio_sample_batch(audioBatchCb);
  g_core.set_input_poll(inputPollCb); g_core.set_input_state(inputStateCb);

  // Fenêtre + contexte OpenGL (compatibilité : accepte les cœurs « core » comme « compat »)
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_COMPATIBILITY);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1); SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24); SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);
  SDL_WindowFlags wf = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY | (g_app.windowed ? 0 : SDL_WINDOW_FULLSCREEN);
  std::string wtitle = g_app.title + " — Arcadia";
  int ww = SDL_atoi(argOf(argc, argv, "--width", "1600").c_str()), wh = SDL_atoi(argOf(argc, argv, "--height", "900").c_str());
  g_app.window = SDL_CreateWindow(wtitle.c_str(), ww, wh, wf);
  if (!g_app.window) return fail(std::string("Fenêtre : ") + SDL_GetError());
  g_app.gl = SDL_GL_CreateContext(g_app.window);
  if (!g_app.gl) return fail(std::string("OpenGL : ") + SDL_GetError());
  SDL_GL_MakeCurrent(g_app.window, g_app.gl);
  if (!glLoad()) return fail("OpenGL 3.3 est requis.");
  SDL_GetWindowSizeInPixels(g_app.window, &g_app.winW, &g_app.winH);
  if (!g_app.windowed) SDL_HideCursor();

  // Chargement du jeu
  retro_game_info gi{}; gi.path = g_app.gamePath.empty() ? nullptr : g_app.gamePath.c_str();
  if (!g_app.gamePath.empty() && !g_core.info.need_fullpath) {
    if (!readFile(g_app.gamePath, g_core.romData)) return fail("Impossible de lire le jeu : " + g_app.gamePath);
    gi.data = g_core.romData.data(); gi.size = g_core.romData.size();
  }
  if (!g_core.load_game(g_app.gamePath.empty() ? nullptr : &gi)) return fail("Le cœur n'a pas réussi à charger ce jeu.");
  g_core.gameLoaded = true;
  // Patchs d'Arcadia (60 images/s…) : une ligne = un code (lignes « a+b+c » du format libretro), activé au démarrage
  {
    std::string cf = argOf(argc, argv, "--cheats");
    size_t sz = 0; char* txt = cf.empty() ? nullptr : (char*)SDL_LoadFile(cf.c_str(), &sz);
    if (txt && g_core.cheat_set) {
      if (g_core.cheat_reset) g_core.cheat_reset();
      unsigned idx = 0; std::string line;
      for (size_t i = 0; i <= sz; i++) {
        char c = i < sz ? txt[i] : '\n';
        if (c == '\r') continue;
        if (c != '\n') { line += c; continue; }
        if (!line.empty() && line[0] != '#') { g_core.cheat_set(idx++, true, line.c_str()); }
        line.clear();
      }
      emit(std::string("{\"event\":\"cheats\",\"count\":") + std::to_string(idx) + "}");
    }
    if (txt) SDL_free(txt);
  }
  g_core.get_system_av_info(&g_core.av);
  if (g_core.hwRender) { ensureGameFbo(); if (g_core.hw.context_reset) g_core.hw.context_reset(); }
  g_core.set_controller_port_device(0, RETRO_DEVICE_JOYPAD);

  // Audio
  SDL_AudioSpec spec{ SDL_AUDIO_S16, 2, (int)std::lround(g_core.av.timing.sample_rate > 0 ? g_core.av.timing.sample_rate : 44100) };
  g_app.audio = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, nullptr, nullptr);
  if (g_app.audio) SDL_ResumeAudioStreamDevice(g_app.audio);
  g_app.applyConfig();
  openPads();
  uiInit();

  // Reprise automatique proposée si une partie a été laissée en cours
  g_app.refreshSlots();
  if (g_app.slots[0].exists) { g_app.resumePrompt = true; g_app.paused = true; SDL_ShowCursor(); }

  if (SDL_getenv("ARCADIA_DUMP_OPTS")) for (auto& o : g_core.options) { std::string v; for (auto& x : o.values) v += x.first + " | "; SDL_Log("OPT %s = %s  [%s]", o.key.c_str(), o.value.c_str(), v.c_str()); }
  emit(std::string("{\"event\":\"ready\",\"core\":\"") + jsonEsc(g_core.info.library_name ? g_core.info.library_name : "") +
       "\",\"hw\":" + (g_core.hwRender ? "true" : "false") + ",\"fps\":" + std::to_string(g_core.av.timing.fps) + "}");

  if (!notice.empty()) g_app.toast(notice, 7000);
  g_app.startTicks = SDL_GetTicksNS();
  uint64_t next = SDL_GetTicksNS(); g_app.fpsT0 = SDL_GetTicks();
  while (g_app.running) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) { extern bool uiProcessEvent(const SDL_Event&); if (captureEvent(e)) continue; uiProcessEvent(e); handleEvent(e); }
    // Back+Start maintenus 1,5 s : quitter
    if (g_app.comboT0 && SDL_GetTicks() - g_app.comboT0 > 1500) { g_app.comboT0 = 0; g_app.quit(); }
    if (g_app.wantQuit) break;
    pollCalibration();

    double fps = g_core.av.timing.fps > 1 ? g_core.av.timing.fps : 60.0;
    uint64_t frameNs = (uint64_t)(1e9 / (fps * g_app.speed));
    uint64_t now = SDL_GetTicksNS();
    if (!g_app.paused) {
      int ran = 0;
      while (now >= next && ran < 3) {
        g_core.run(); frameCount++; ran++; next += frameNs;
        g_app.mouseDX = g_app.mouseDY = 0;
        if (pendingLoad >= 0) {
          if (g_app.loadSlot(pendingLoad) || ++pendingTries > 90) pendingLoad = -1;
        }
        g_app.fpsFrames++;
      }
      if (now > next + frameNs * 4) next = now; // on a pris du retard : on repart
      g_app.playedNs += ran * frameNs;
    } else next = now;
    if (!g_app.menuOpen && !g_app.resumePrompt && !g_app.windowed && SDL_CursorVisible() && SDL_GetTicks() - g_app.lastMouseMove > 2000) SDL_HideCursor();
    if (SDL_GetTicks() - g_app.fpsT0 >= 500) {
      g_app.fps = g_app.fpsFrames * 1000.f / (SDL_GetTicks() - g_app.fpsT0); g_app.fpsFrames = 0; g_app.fpsT0 = SDL_GetTicks();
      static const char* stats = SDL_getenv("ARCADIA_STATS"); // compteur d'images/s d'Arcadia (par-dessus le jeu)
      if (stats && *stats) if (SDL_IOStream* f = SDL_IOFromFile(stats, "wb")) { SDL_IOprintf(f, "{\"fps\":%.1f,\"speed\":%.0f,\"t\":%llu}", g_app.fps, g_app.speed * 100.0, (unsigned long long)SDL_GetTicks()); SDL_CloseIO(f); }
    }

    // Dessin
    resetGlState();
    xglClearColor(0, 0, 0, 1); xglClear(GL_COLOR_BUFFER_BIT);
    if (g_app.menuOpen || g_app.resumePrompt) drawBlurredBackground();
    else { int x, y, w, h; destRect(g_app.winW, g_app.winH, x, y, w, h); g_app.viewX = x; g_app.viewY = g_app.winH - y - h; g_app.viewW = w; g_app.viewH = h; blitGame(0, x, y, w, h, g_app.cfg.get("filter", "linear") == "nearest" ? GL_NEAREST : GL_LINEAR); }
    resetGlState();
    uiFrame();

    // Pilotage automatique (tests)
    if (menuAt >= 0 && (int)frameCount >= menuAt) { menuAt = -1; g_app.openMenu(); }
    if (resumeAt >= 0 && g_app.resumePrompt && SDL_GetTicksNS() - g_app.startTicks > (uint64_t)resumeAt * 1000000ULL) { resumeAt = -1; extern void uiChooseResume(bool); uiChooseResume(true); }
    static int uiFrames = 0; if (g_app.menuOpen || g_app.resumePrompt) uiFrames++;
    if (captureAt >= 0 && !captureUiPath.empty() && (((g_app.menuOpen || g_app.resumePrompt) && uiFrames >= captureAt) || (int)frameCount >= quitAt - 1)) { captureScreen(captureUiPath); captureAt = -1; }
    if (quitAt > 0 && ((int)frameCount >= quitAt || (g_app.paused && uiFrames > captureAt + 30 && captureAt < 0))) g_app.quit();

    SDL_GL_SwapWindow(g_app.window);
    // Attente jusqu'à la prochaine image
    if (!g_app.paused) { uint64_t t = SDL_GetTicksNS(); if (next > t + 1000000) SDL_DelayPrecise(next - t - 500000); }
    else SDL_Delay(8);
  }

  // Sortie propre : reprise auto + sauvegardes du jeu
  if (!g_app.resumePrompt && frameCount > 30) g_app.saveSlot(0, true);
  g_app.saveConfig();
  int seconds = (int)(g_app.playedNs / 1000000000ULL);
  uiShutdown();
  if (g_core.hwRender && g_core.hw.context_destroy) g_core.hw.context_destroy();
  g_core.close();
  if (g_app.audio) SDL_DestroyAudioStream(g_app.audio);
  emit("{\"event\":\"exit\",\"seconds\":" + std::to_string(seconds) + "}");
  SDL_GL_DestroyContext(g_app.gl); SDL_DestroyWindow(g_app.window); SDL_Quit();
  return 0;
}

// Choix de l'écran « Reprendre ta partie ? »
void uiChooseResume(bool resume) {
  g_app.resumePrompt = false; g_app.paused = false; SDL_HideCursor();
  if (resume) { pendingLoad = 0; pendingTries = 0; }
}
