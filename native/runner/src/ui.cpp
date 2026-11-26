// Menu en jeu Arcadia (Dear ImGui) — DA : sombre, arrondi, verre dépoli, léger halo blanc.
#include "app.h"
#include "imgui.h"
#include "imgui_internal.h"
#include "imgui_impl_sdl3.h"
#include "imgui_impl_opengl3.h"
#include <cmath>
#include <algorithm>
#include <vector>
#include <string>
#include "tr_en.h"

static ImFont* fReg = nullptr; static ImFont* fBold = nullptr;
static int section = 0;        // section affichée à droite
static bool focusFirst = false;  // focus sur « Reprendre » à l'ouverture
static int confirm = 0;          // 1 = quitter, 2 = redémarrer, 3 = action d'emplacement
static int slotSel = -1;
static float S = 1.f;            // échelle (1080p = 1)
static float openT = 0;          // animation d'apparition 0→1
static bool mouseActive = false; // la souris ne surligne qu'après avoir bougé
int g_debugSection = -1;
// Donne le focus manette au dernier élément créé
static void focusPrev() { ImGuiWindow* w = ImGui::GetCurrentWindow(); ImGui::FocusWindow(w); ImGui::SetFocusID(ImGui::GetItemID(), w); ImGui::SetNavCursorVisible(true); }
static bool HOV() { return mouseActive && ImGui::IsItemHovered(); }

enum { SEC_RESUME, SEC_SAVES, SEC_IMAGE, SEC_SOUND, SEC_PAD, SEC_ADV, SEC_CHEAT, SEC_RESTART, SEC_QUIT, SEC_COUNT };
static const char* kSecLabel[SEC_COUNT] = { "Reprendre", "Sauvegardes", "Vidéo", "Son", "Contrôles", "Avancé", "Rembobinage", "Redémarrer", "Quitter le jeu" };
static const char* kSecIcon[SEC_COUNT]  = { "\xE2\x96\xB6", "\xE2\x97\x86", "\xE2\x97\x90", "\xE2\x99\xAA", "\xE2\x9C\xA6", "\xE2\x89\xA1", "\xE2\x98\x85", "\xE2\x86\xBB", "\xE2\x9C\x95" };

static ImU32 W(float a) { return IM_COL32(255, 255, 255, (int)(255 * std::clamp(a, 0.f, 1.f))); }
static ImU32 K(float a) { return IM_COL32(4, 17, 15, (int)(255 * std::clamp(a, 0.f, 1.f))); }
// Couleur des boutons d'Arcadia (thème Néon : menthe par défaut, ou celle choisie dans Arcadia via ARCADIA_ACCENT=#rrggbb)
static int accentRGB[3] = { 57, 229, 200 };
static void loadAccent() {
  const char* a = SDL_getenv("ARCADIA_ACCENT");
  unsigned v = 0;
  if (a && a[0] == '#' && SDL_strlen(a) == 7 && SDL_sscanf(a + 1, "%x", &v) == 1) { accentRGB[0] = (v >> 16) & 255; accentRGB[1] = (v >> 8) & 255; accentRGB[2] = v & 255; }
}
static ImU32 A(float a) { return IM_COL32(accentRGB[0], accentRGB[1], accentRGB[2], (int)(255 * std::clamp(a, 0.f, 1.f))); }

// Halo doux autour d'un rectangle arrondi (empilement de contours transparents)
static void glow(ImDrawList* dl, ImVec2 a, ImVec2 b, float r, float strength = 1.f) {
  r = std::min(r, 3.f * S); // angles nets
  for (int i = 1; i <= 10; i++) {
    float e = i * 2.2f * S;
    dl->AddRect(ImVec2(a.x - e, a.y - e), ImVec2(b.x + e, b.y + e), A(0.05f * strength * (1.f - i / 11.f)), r, 0, 2.4f * S);
  }
}
// Panneau « verre » : fond sombre translucide + liseré + reflet
static void glass(ImDrawList* dl, ImVec2 a, ImVec2 b, float r, float alpha = 0.72f) {
  r = std::min(r, 3.f * S);
  dl->AddRectFilled(ImVec2(a.x, a.y + 10 * S), ImVec2(b.x, b.y + 18 * S), IM_COL32(0, 0, 0, 70), r);
  dl->AddRectFilled(a, b, K(alpha), r);
  dl->AddRectFilledMultiColor(a, ImVec2(b.x, a.y + std::min(90.f * S, (b.y - a.y) * .5f)), W(.035f), W(.035f), W(0), W(0));
  dl->AddRect(a, b, W(0.09f), r, 0, 1.2f * S);
}

static void text(ImDrawList* dl, ImFont* f, float size, ImVec2 p, ImU32 col, const char* s, float wrap = 0) {
  dl->AddText(f, size * S, p, col, TR(s), nullptr, wrap);
}
static ImVec2 textSize(ImFont* f, float size, const char* s) { return f->CalcTextSizeA(size * S, FLT_MAX, 0, TR(s)); }

// Pilule de navigation (liste de gauche). Renvoie true si validée.
static bool pill(const char* id, const char* icon, const char* label, bool current, bool enabled, float w, float h) {
  ImGui::PushID(id);
  ImVec2 p = ImGui::GetCursorScreenPos();
  ImGui::BeginDisabled(!enabled);
  bool pressed = ImGui::InvisibleButton("##p", ImVec2(w, h));
  ImGui::EndDisabled();
  bool hot = enabled && (ImGui::IsItemFocused() || HOV());
  ImDrawList* dl = ImGui::GetWindowDrawList();
  ImVec2 q(p.x + w, p.y + h); float r = 2.f * S;
  if (hot) { glow(dl, p, q, r, 1.2f); dl->AddRectFilled(p, q, A(1), r); }
  else if (current) dl->AddRectFilled(p, q, W(.10f), r);
  else dl->AddRectFilled(p, q, W(.035f), r);
  ImU32 tc = hot ? K(1) : enabled ? W(current ? 1 : .82f) : W(.28f);
  text(dl, fBold, 22, ImVec2(p.x + 26 * S, p.y + (h - 22 * S) * .5f - 1 * S), hot ? K(.75f) : W(enabled ? .55f : .2f), icon);
  text(dl, hot || current ? fBold : fReg, 24, ImVec2(p.x + 64 * S, p.y + (h - 26 * S) * .5f), tc, label);
  if (!enabled) { const char* soon = "bientôt"; ImVec2 ts = textSize(fReg, 16, soon); text(dl, fReg, 16, ImVec2(q.x - ts.x - 24 * S, p.y + (h - 17 * S) * .5f), W(.3f), soon); }
  ImGui::PopID();
  return pressed && enabled;
}

// Ligne de réglage (carte pleine largeur). A / clic : action. Renvoie true si validée.
static bool row(const char* id, const char* label, const char* value, const char* hint = nullptr) {
  ImGui::PushID(id);
  float w = ImGui::GetContentRegionAvail().x, h = 74 * S;
  ImVec2 p = ImGui::GetCursorScreenPos();
  bool pressed = ImGui::InvisibleButton("##r", ImVec2(w, h));
  bool hot = ImGui::IsItemFocused() || HOV();
  ImDrawList* dl = ImGui::GetWindowDrawList(); ImVec2 q(p.x + w, p.y + h); float r = 2.f * S;
  if (hot) { glow(dl, p, q, r, .8f); dl->AddRectFilled(p, q, A(.10f), r); dl->AddRect(p, q, A(.9f), r, 0, 1.5f * S); }
  else dl->AddRectFilled(p, q, W(.045f), r);
  text(dl, fReg, 22, ImVec2(p.x + 26 * S, p.y + (hint ? 13 : 23) * S), W(.92f), label);
  if (hint) text(dl, fReg, 16, ImVec2(p.x + 26 * S, p.y + 43 * S), W(.45f), hint);
  if (value) {
    ImVec2 ts = textSize(fBold, 21, value);
    ImVec2 a(q.x - ts.x - 54 * S, p.y + 19 * S), b(q.x - 18 * S, q.y - 19 * S);
    dl->AddRectFilled(a, b, hot ? A(1) : W(.08f), 2.f * S);
    text(dl, fBold, 21, ImVec2(a.x + 18 * S, p.y + (h - 22 * S) * .5f), hot ? K(1) : W(.9f), value);
  }
  ImGui::Dummy(ImVec2(0, 10 * S));
  ImGui::PopID();
  return pressed;
}

static bool toggleRow(const char* id, const char* label, bool& v, const char* hint = nullptr) {
  if (row(id, label, v ? "Activé" : "Désactivé", hint)) { v = !v; return true; }
  return false;
}

// Curseur arrondi (gauche/droite une fois activé avec A)
static bool sliderRow(const char* id, const char* label, int& v, int lo, int hi, const char* fmt) {
  ImGui::PushID(id);
  float w = ImGui::GetContentRegionAvail().x, h = 74 * S;
  ImVec2 p = ImGui::GetCursorScreenPos(); ImDrawList* dl = ImGui::GetWindowDrawList();
  ImGui::SetNextItemWidth(w);
  ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(0, (h - 22 * S) * .5f));
  ImGui::PushStyleColor(ImGuiCol_FrameBg, 0); ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, 0); ImGui::PushStyleColor(ImGuiCol_FrameBgActive, 0);
  ImGui::PushStyleColor(ImGuiCol_SliderGrab, 0); ImGui::PushStyleColor(ImGuiCol_SliderGrabActive, 0); ImGui::PushStyleColor(ImGuiCol_Text, 0);
  // dessin du fond avant le widget (le widget est transparent)
  bool hotPrev = ImGui::GetID("##s") == ImGui::GetFocusID();
  ImVec2 q(p.x + w, p.y + h); float r = 20 * S;
  dl->AddRectFilled(p, q, W(hotPrev ? .12f : .045f), r);
  bool ch = ImGui::SliderInt("##s", &v, lo, hi, "");
  ImGui::PopStyleColor(6); ImGui::PopStyleVar();
  bool hot = ImGui::IsItemFocused() || HOV(), active = ImGui::IsItemActive();
  if (hot || active) { glow(dl, p, q, r, .8f); dl->AddRect(p, q, W(active ? .9f : .55f), r, 0, 1.5f * S); }
  text(dl, fReg, 22, ImVec2(p.x + 26 * S, p.y + 23 * S), W(.92f), label);
  float x0 = p.x + w * .45f, x1 = q.x - 120 * S, cy = p.y + h * .5f, t = (float)(v - lo) / (hi - lo);
  dl->AddRectFilled(ImVec2(x0, cy - 3 * S), ImVec2(x1, cy + 3 * S), W(.14f), 3 * S);
  dl->AddRectFilled(ImVec2(x0, cy - 3 * S), ImVec2(x0 + (x1 - x0) * t, cy + 3 * S), W(.9f), 3 * S);
  ImVec2 k(x0 + (x1 - x0) * t, cy);
  if (hot || active) for (int i = 1; i <= 6; i++) dl->AddCircle(k, (11 + i * 2.f) * S, W(.05f * (1 - i / 7.f)), 0, 2 * S);
  dl->AddCircleFilled(k, 11 * S, W(1));
  char buf[32]; SDL_snprintf(buf, sizeof buf, fmt, v);
  text(dl, fBold, 21, ImVec2(q.x - 92 * S, p.y + 25 * S), W(.9f), buf);
  ImGui::Dummy(ImVec2(0, 10 * S));
  ImGui::PopID();
  return ch;
}

static void heading(const char* t, const char* sub = nullptr) {
  ImDrawList* dl = ImGui::GetWindowDrawList(); ImVec2 p = ImGui::GetCursorScreenPos();
  text(dl, fBold, 34, p, W(1), t);
  float h = 50 * S;
  if (sub) { text(dl, fReg, 18, ImVec2(p.x, p.y + 46 * S), W(.5f), sub); h += 30 * S; }
  ImGui::Dummy(ImVec2(0, h));
}

// ───────────────────────── Sections ─────────────────────────
static void cycleOption(CoreOption& o) {
  size_t i = 0; for (; i < o.values.size(); i++) if (o.values[i].first == o.value) break;
  o.value = o.values[(i + 1) % o.values.size()].first; g_core.optionsDirty = true;
}
static const char* optLabel(CoreOption& o) { for (auto& v : o.values) if (v.first == o.value) return v.second.c_str(); return o.value.c_str(); }

static void secSaves() {
  heading("Sauvegardes", "Instantané complet de ta partie, à n'importe quel moment — en plus des sauvegardes du jeu.");
  {
    float aw = ImGui::GetContentRegionAvail().x, bw = (aw - 16 * S) * .5f;
    if (pill("savenow", "\xE2\x86\x93", "Sauvegarder maintenant", false, true, bw, 60 * S)) g_app.saveNow();
    ImGui::SameLine(0, 16 * S);
    if (pill("openfolder", "\xE2\x96\xA4", "Ouvrir le dossier", false, true, bw, 60 * S)) g_app.openFolder(g_app.statesDir);
    ImGui::Dummy(ImVec2(0, 10 * S));
    ImDrawList* dl = ImGui::GetWindowDrawList(); ImVec2 p = ImGui::GetCursorScreenPos();
    std::string a = "Sauvegardes rapides : " + g_app.statesDir, b = "Sauvegardes du jeu : " + g_app.savesDir;
    text(dl, fReg, 15, p, W(.45f), a.c_str(), aw); text(dl, fReg, 15, ImVec2(p.x, p.y + 22 * S), W(.45f), b.c_str(), aw);
    ImGui::Dummy(ImVec2(0, 56 * S));
  }
  float avail = ImGui::GetContentRegionAvail().x, gap = 18 * S;
  int cols = 4; float cw = (avail - gap * (cols - 1)) / cols, ch = cw * 9 / 16 + 70 * S;
  for (int i = 0; i < 7; i++) {
    SlotInfo& s = g_app.slots[i];
    if (i % cols) ImGui::SameLine(0, gap);
    ImGui::PushID(i);
    ImVec2 p = ImGui::GetCursorScreenPos();
    if (ImGui::InvisibleButton("##slot", ImVec2(cw, ch))) {
      if (i == 0 && !s.exists) {}
      else if (!s.exists) { g_app.saveSlot(i); g_app.refreshSlots(); }
      else { slotSel = i; confirm = 3; }
    }
    bool hot = ImGui::IsItemFocused() || HOV();
    ImDrawList* dl = ImGui::GetWindowDrawList(); ImVec2 q(p.x + cw, p.y + ch); float r = 22 * S;
    if (hot) glow(dl, p, q, r, 1.1f);
    dl->AddRectFilled(p, q, hot ? W(.13f) : W(.05f), r);
    ImVec2 ia(p.x + 10 * S, p.y + 10 * S), ib(q.x - 10 * S, p.y + 10 * S + (cw - 20 * S) * 9 / 16);
    if (s.thumb) dl->AddImageRounded((ImTextureID)(intptr_t)s.thumb, ia, ib, ImVec2(0, 0), ImVec2(1, 1), W(1), 15 * S);
    else {
      dl->AddRectFilled(ia, ib, W(.04f), 15 * S);
      const char* e = i == 0 ? "Aucune reprise" : "+ Sauvegarder ici"; ImVec2 ts = textSize(fReg, 18, e);
      text(dl, fReg, 18, ImVec2((ia.x + ib.x - ts.x) * .5f, (ia.y + ib.y - ts.y) * .5f), W(.45f), e);
    }
    if (hot) dl->AddRect(ia, ib, W(.8f), 15 * S, 0, 2 * S);
    std::string name = i == 0 ? "Reprise auto" : "Emplacement " + std::to_string(i);
    text(dl, fBold, 20, ImVec2(p.x + 16 * S, ib.y + 10 * S), W(.95f), name.c_str());
    text(dl, fReg, 16, ImVec2(p.x + 16 * S, ib.y + 36 * S), W(.5f), s.exists ? s.date.c_str() : "Vide");
    ImGui::PopID();
    if (i % cols == cols - 1) ImGui::Dummy(ImVec2(0, gap - ImGui::GetStyle().ItemSpacing.y));
  }
  ImGui::Dummy(ImVec2(0, 26 * S));
  ImDrawList* dl = ImGui::GetWindowDrawList(); ImVec2 p = ImGui::GetCursorScreenPos();
  text(dl, fReg, 17, p, W(.42f), "Astuce : Guide + X (ou F5) sauvegarde sans ouvrir le menu.");
}

static void secImage() {
  heading("Vidéo", g_app.perGame ? "Réglages propres à ce jeu" : "Réglages communs à tous les jeux de cette console");
  bool pg = g_app.perGame;
  if (toggleRow("pg", "Réglages pour ce jeu uniquement", pg, "Sinon, ils s'appliquent à toute la console")) g_app.perGame = pg;
  // options du moteur mises en avant (résolution interne, écrans DS…)
  for (auto& o : g_core.options) {
    std::string k = o.key; std::transform(k.begin(), k.end(), k.begin(), ::tolower);
    if (!o.visible || o.values.size() < 2) continue;
    if (k.find("resolution") != std::string::npos || k.find("upscal") != std::string::npos) {
      if (row(o.key.c_str(), "Résolution interne", optLabel(o), "Plus haut = plus net, plus exigeant")) cycleOption(o);
    } else if (k == "melonds_screen_layout" || k == "citra_layout_option") {
      if (row(o.key.c_str(), "Disposition des deux écrans", optLabel(o))) cycleOption(o);
    }
  }
  std::string f = g_app.cfg.get("filter", "linear");
  if (row("filter", "Filtre de l'image", f == "nearest" ? "Net (pixels)" : "Lisse")) g_app.cfg.set("filter", f == "nearest" ? "linear" : "nearest");
  std::string a = g_app.cfg.get("aspect", "fit");
  const char* al = a == "stretch" ? "Plein écran étiré" : a == "integer" ? "Échelle entière" : "Format d'origine";
  if (row("aspect", "Format", al)) g_app.cfg.set("aspect", a == "fit" ? "stretch" : a == "stretch" ? "integer" : "fit");
  bool perf = g_app.cfg.getb("perf", false);
  if (toggleRow("perf", "Afficher les performances", perf, "Images par seconde en haut à gauche")) g_app.cfg.setb("perf", perf);
}

static void secSound() {
  heading("Son");
  int v = g_app.cfg.geti("volume", 100);
  if (sliderRow("vol", "Volume", v, 0, 100, "%d %%")) g_app.setVolume(v);
  bool m = g_app.cfg.getb("mute", false);
  if (toggleRow("mute", "Couper le son", m)) { g_app.cfg.setb("mute", m); g_app.applyConfig(); }
  bool pf = g_app.cfg.getb("pausefocus", true);
  if (toggleRow("pf", "Pause quand Arcadia passe en arrière-plan", pf)) g_app.cfg.setb("pausefocus", pf);
}

// Nom d'une action selon la famille de la console (Switch : A B X Y ; PlayStation : Rond Croix…)
static const char* actionLabel(int a) {
  namespace AC = ArcadiaControls;
  const std::string& c = g_app.console;
  bool sony = c.rfind("PS", 0) == 0;
  static const char* nin[] = { "A", "B", "X", "Y", "L", "R", "ZL", "ZR", "Start (+)", "Select (\xE2\x88\x92)" };
  static const char* ps[] = { "Rond", "Croix", "Triangle", "Carré", "L1", "R1", "L2", "R2", "Start", "Select" };
  static const char* rest[] = { "Clic stick gauche", "Clic stick droit", "Croix \xE2\x86\x91", "Croix \xE2\x86\x93", "Croix \xE2\x86\x90", "Croix \xE2\x86\x92", "Home",
    "Stick gauche \xE2\x86\x91", "Stick gauche \xE2\x86\x93", "Stick gauche \xE2\x86\x90", "Stick gauche \xE2\x86\x92",
    "Stick droit \xE2\x86\x91", "Stick droit \xE2\x86\x93", "Stick droit \xE2\x86\x90", "Stick droit \xE2\x86\x92" };
  if (a < AC::L3) return sony ? ps[a] : nin[a];
  return rest[a - AC::L3];
}

static void secPad() {
  namespace AC = ArcadiaControls;
  SDL_Gamepad* g = g_app.pads[0];
  std::string head = g ? std::string("Manette : ") + (SDL_GetGamepadName(g) ? SDL_GetGamepadName(g) : "manette") : std::string("Aucune manette branchée");
  heading("Contrôles", head.c_str());
  if (!g_app.controls.loaded) g_app.controls = AC::Defaults(false);
  auto save = [] { if (!g_app.ctlWatch.path.empty()) { AC::Save(g_app.ctlWatch.path, g_app.controls); g_app.ctlWatch.Touch(); } };
  static const char* devLabel[4] = { "Clavier + manette", "Clavier seul", "Manette seule", "Stick arcade" };
  static const char* devHint[4] = { "Les deux marchent en même temps.", "La manette est ignorée.", "Le clavier est ignoré.", "Levier et boutons d'arcade : le levier pilote aussi le stick gauche." };
  if (row("dev", "Jouer avec", devLabel[g_app.controls.device], devHint[g_app.controls.device])) { g_app.controls.device = (AC::Device)((g_app.controls.device + 1) % 4); save(); }
  if (row("calib", "Calibrer ma manette", g_app.calibState ? "En cours…" : "\xE2\x86\xB5", "« Appuie sur A » : reconnue en une seconde, sinon touche par touche. Vaut pour tous les jeux.")) { if (!g_app.calibState) g_app.calibrate(); }
  int dz = g_app.cfg.geti("deadzone", 15);
  if (sliderRow("dz", "Zone morte des sticks", dz, 0, 40, "%d %%")) g_app.cfg.seti("deadzone", dz);
  bool vib = g_app.cfg.getb("vibration", true);
  if (toggleRow("vib", "Vibrations", vib)) g_app.cfg.setb("vibration", vib);

  // Réattribution : une ligne par action, case clavier et case manette ; clique puis appuie (Échap = annuler)
  const bool showKb = g_app.controls.device != AC::PAD && g_app.controls.device != AC::STICK;
  const bool showPad = g_app.controls.device != AC::KEYBOARD;
  ImDrawList* dl0 = ImGui::GetWindowDrawList();
  ImGui::Dummy(ImVec2(0, 8 * S));
  { ImVec2 hp = ImGui::GetCursorScreenPos(); float w = ImGui::GetContentRegionAvail().x;
    text(dl0, fBold, 22, hp, W(.9f), "Touches");
    if (showKb) text(dl0, fReg, 16, ImVec2(hp.x + w * .535f - textSize(fReg, 16, "Clavier").x * .5f, hp.y + 6 * S), W(.5f), "Clavier");
    if (showPad) text(dl0, fReg, 16, ImVec2(hp.x + w * .84f - textSize(fReg, 16, "Manette").x * .5f, hp.y + 6 * S), W(.5f), "Manette"); }
  ImGui::Dummy(ImVec2(0, 36 * S));
  auto chip = [&](const char* id, ImVec2 a, ImVec2 b, const std::string& v, bool active) {
    ImGui::SetCursorScreenPos(a);
    bool pressed = ImGui::InvisibleButton(id, ImVec2(b.x - a.x, b.y - a.y));
    bool hot = ImGui::IsItemFocused() || HOV();
    ImDrawList* dl = ImGui::GetWindowDrawList(); float r = (b.y - a.y) * .5f;
    if (active) { glow(dl, a, b, r, 1.f); dl->AddRectFilled(a, b, W(.95f), r); }
    else if (hot) { dl->AddRectFilled(a, b, W(.2f), r); dl->AddRect(a, b, W(.6f), r, 0, 1.5f * S); }
    else dl->AddRectFilled(a, b, W(.07f), r);
    ImVec2 ts = textSize(fBold, 17, v.c_str());
    text(dl, fBold, 17, ImVec2(a.x + (b.x - a.x - ts.x) * .5f, a.y + (b.y - a.y - 18 * S) * .5f), active ? K(1) : W(.88f), v.c_str());
    return pressed;
  };
  auto labelOf = [](const std::vector<int>& l, bool kb) {
    std::string v; for (size_t i = 0; i < l.size(); i++) v += (i ? " / " : "") + (kb ? AC::KeyLabel(l[i]) : AC::PadLabel(l[i]));
    return v.empty() ? std::string("\xE2\x80\x94") : v;
  };
  for (int a = 0; a < AC::COUNT; a++) {
    bool padRow = a < AC::HOME; // les sticks de la manette restent des sticks
    if (!showKb && !padRow) continue;
    ImGui::PushID(a);
    float w = ImGui::GetContentRegionAvail().x, h = 48 * S;
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImDrawList* dl = ImGui::GetWindowDrawList();
    if (a % 2 == 0) dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), W(.025f), 12 * S);
    text(dl, fReg, 19, ImVec2(p.x + 18 * S, p.y + 13 * S), W(.9f), actionLabel(a));
    if (showKb) {
      bool cap = g_app.capAction == a && g_app.capKeyboard;
      if (chip("k", ImVec2(p.x + w * .40f, p.y + 7 * S), ImVec2(p.x + w * .67f, p.y + h - 7 * S), cap ? "Appuie sur une touche…" : labelOf(g_app.controls.kb[a], true), cap))
        { g_app.capAction = a; g_app.capKeyboard = true; g_app.capT0 = SDL_GetTicks(); }
    }
    if (showPad && padRow) {
      bool cap = g_app.capAction == a && !g_app.capKeyboard;
      if (chip("p", ImVec2(p.x + w * .70f, p.y + 7 * S), ImVec2(p.x + w * .98f, p.y + h - 7 * S), cap ? "Appuie sur un bouton…" : labelOf(g_app.controls.pad[a], false), cap))
        { g_app.capAction = a; g_app.capKeyboard = false; g_app.capT0 = SDL_GetTicks(); }
    }
    ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + h + 4 * S));
    ImGui::Dummy(ImVec2(w, 0));
    ImGui::PopID();
  }
  ImGui::Dummy(ImVec2(0, 6 * S));
  if (row("ctlreset", "Rétablir les touches d'origine", nullptr, "Clavier et manette, pour toutes les parties de cette console.")) {
    AC::Device d = g_app.controls.device; g_app.controls = AC::Defaults(g_app.console == "SWITCH" || g_app.console == "SWITCH 2"); g_app.controls.device = d; save();
    g_app.toast("Touches d'origine rétablies");
  }

  ImGui::Dummy(ImVec2(0, 8 * S));
  ImDrawList* dl = ImGui::GetWindowDrawList(); ImVec2 p = ImGui::GetCursorScreenPos();
  text(dl, fBold, 22, p, W(.9f), "Raccourcis");
  float y = p.y + 42 * S;
  std::vector<std::pair<std::string, std::string>> items = {
    { "Échap · F5 · F8 · F12 · Tab", "Menu · sauver · charger · capture · turbo" }, { "Souris", "Écran tactile (DS, 3DS)" },
    { "Guide", "Ouvrir / fermer ce menu" }, { "Back + Start (maintenus)", "Quitter le jeu" },
    { "Guide + RB", "Turbo \xC3\x97" "2" }, { "R / Guide + LT", "Rembobinage (maintenu)" }, { "Guide + RT", "Avance rapide \xC3\x97" "3 (maintenu)" }, { "Guide + Back", "Ralenti \xC3\x97" "0,5" }, { "Guide + X", "Sauvegarder maintenant" },
    { "Guide + Y", "Capture d'écran" }, { "Guide + LB", "Filtre net / lisse" }, { "Guide + \xE2\x86\x91 / \xE2\x86\x93", "Volume" }, { "Guide + \xE2\x86\x92", "Couper le son" },
    { "Stick droit (DS)", "Curseur de l'écran tactile · clic du stick = toucher" } };
  for (auto& s2 : items) {
    ImVec2 ts = textSize(fBold, 17, s2.first.c_str());
    dl->AddRectFilled(ImVec2(p.x, y), ImVec2(p.x + ts.x + 24 * S, y + 32 * S), W(.09f), 16 * S);
    text(dl, fBold, 17, ImVec2(p.x + 12 * S, y + 6 * S), W(.9f), s2.first.c_str());
    text(dl, fReg, 18, ImVec2(p.x + ts.x + 40 * S, y + 6 * S), W(.6f), s2.second.c_str());
    y += 42 * S;
  }
  ImGui::Dummy(ImVec2(0, y + 18 * S - ImGui::GetCursorScreenPos().y));
}

// Aide « Contrôles » quelques secondes au début de la partie
static void drawControlsHint() {
  if (g_app.hintOff || !g_app.cfg.getb("controlshint", true) || g_app.menuOpen || g_app.resumePrompt) return;
  if (!g_app.hintT0) g_app.hintT0 = SDL_GetTicks();
  float t = (SDL_GetTicks() - g_app.hintT0) / 1000.f;
  if (t > 7.5f) return;
  float a = std::min(1.f, std::min(t / .4f, (7.5f - t) / .6f));
  ImDrawList* fg = ImGui::GetForegroundDrawList(); ImVec2 ds = ImGui::GetIO().DisplaySize;
  SDL_Gamepad* g = g_app.pads[0];
  std::string l1 = std::string("\xE2\x9C\xA6  ") + (g ? (SDL_GetGamepadName(g) ? SDL_GetGamepadName(g) : TR("Manette")) : TR("Branche une manette quand tu veux")) + "      \xE2\x8C\xA8  " + TR("Clavier");
  const char* l2 = "Les deux marchent en même temps. Échap ou Guide : menu → Contrôles pour changer les touches ou calibrer.";
  float w = std::max(textSize(fBold, 20, l1.c_str()).x, textSize(fReg, 17, l2).x) + 56 * S, h = 92 * S;
  ImVec2 p0(36 * S, ds.y - h - 40 * S), p1(p0.x + w, p0.y + h);
  for (int i = 1; i <= 8; i++) { float e = i * 2 * S; fg->AddRect(ImVec2(p0.x - e, p0.y - e), ImVec2(p1.x + e, p1.y + e), W(.04f * a * (1 - i / 9.f)), 26 * S + e, 0, 2 * S); }
  fg->AddRectFilled(p0, p1, K(.86f * a), 26 * S); fg->AddRect(p0, p1, W(.14f * a), 26 * S, 0, 1.2f * S);
  fg->AddText(fBold, 20 * S, ImVec2(p0.x + 28 * S, p0.y + 18 * S), W(a), TR(l1.c_str()));
  fg->AddText(fReg, 17 * S, ImVec2(p0.x + 28 * S, p0.y + 52 * S), W(.65f * a), TR(l2));
}

static void secAdvanced() {
  heading("Avancé", g_core.info.library_name ? (std::string("Options du moteur ") + g_core.info.library_name).c_str() : "Options du moteur");
  int n = 0;
  for (auto& o : g_core.options) {
    if (!o.visible || o.values.size() < 2) continue;
    std::string hint = o.info.size() > 90 ? o.info.substr(0, 87) + "…" : o.info;
    if (row(o.key.c_str(), o.desc.c_str(), optLabel(o), hint.empty() ? nullptr : hint.c_str())) cycleOption(o);
    n++;
  }
  if (!n) { ImDrawList* dl = ImGui::GetWindowDrawList(); text(dl, fReg, 20, ImGui::GetCursorScreenPos(), W(.5f), "Ce moteur n'a pas d'options."); ImGui::Dummy(ImVec2(0, 30 * S)); }
  ImGui::Dummy(ImVec2(0, 10 * S));
  if (row("reset", "Rétablir les réglages par défaut", nullptr)) {
    for (auto& o : g_core.options) { o.value = o.def; g_app.cfg.kv.erase("core:" + o.key); }
    g_core.optionsDirty = true; g_app.toast("Réglages du moteur rétablis");
  }
}

static void secCheat() {
  heading("Rembobinage", "Reviens quelques secondes en arrière quand tu rates un saut, et avance plus vite dans les passages lents.");
  bool on = g_app.cfg.getb("rewind", true);
  if (toggleRow("rw", "Rembobinage", on)) { g_app.cfg.setb("rewind", on); if (!on) { extern void rewindReset(); rewindReset(); } }
  ImDrawList* dl = ImGui::GetWindowDrawList();
  const char* lines[] = { "Clavier : maintiens R pour revenir en arrière", "Manette : maintiens Guide + LT pour revenir en arrière", "Manette : maintiens Guide + RT pour avancer ×3", "Tab ou Guide + RB : turbo ×2 (bascule)" };
  for (const char* l : lines) { ImVec2 p = ImGui::GetCursorScreenPos(); text(dl, fReg, 19, ImVec2(p.x + 4 * S, p.y), W(.6f), l); ImGui::Dummy(ImVec2(0, 30 * S)); }
}

// ───────────────────────── Fenêtres ─────────────────────────
static void hintsBar(ImDrawList* dl, const char* const* items, int n) {
  float x = ImGui::GetIO().DisplaySize.x - 70 * S, y = ImGui::GetIO().DisplaySize.y - 70 * S;
  for (int i = n - 2; i >= 0; i -= 2) {
    ImVec2 lt = textSize(fReg, 19, items[i + 1]); x -= lt.x; text(dl, fReg, 19, ImVec2(x, y), W(.75f), items[i + 1]);
    ImVec2 bt = textSize(fBold, 15, items[i]); float d = std::max(30 * S, bt.x + 16 * S); x -= d + 10 * S;
    dl->AddRectFilled(ImVec2(x, y - 4 * S), ImVec2(x + d, y + 26 * S), W(.95f), 15 * S);
    text(dl, fBold, 15, ImVec2(x + (d - bt.x) * .5f, y + 2 * S), K(1), items[i]);
    x -= 34 * S;
  }
}

static bool modal(const char* title, const char* body, const char* yes, const char* no, int& choice) {
  ImDrawList* fg = ImGui::GetForegroundDrawList(); ImVec2 ds = ImGui::GetIO().DisplaySize;
  float w = 640 * S, h = 300 * S; ImVec2 a((ds.x - w) * .5f, (ds.y - h) * .5f), b(a.x + w, a.y + h);
  ImGui::SetNextWindowPos(a); ImGui::SetNextWindowSize(ImVec2(w, h));
  ImGui::SetNextWindowFocus();
  ImGui::Begin("##modal", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings);
  ImDrawList* dl = ImGui::GetWindowDrawList();
  (void)fg;
  ImGui::GetBackgroundDrawList()->AddRectFilled(ImVec2(0, 0), ds, IM_COL32(0, 0, 0, 120));
  glow(dl, a, b, 30 * S, .7f); glass(dl, a, b, 30 * S, .9f);
  text(dl, fBold, 30, ImVec2(a.x + 40 * S, a.y + 36 * S), W(1), title);
  text(dl, fReg, 20, ImVec2(a.x + 40 * S, a.y + 88 * S), W(.65f), body, w - 80 * S);
  ImGui::SetCursorScreenPos(ImVec2(a.x + 40 * S, b.y - 100 * S));
  float bw = (w - 100 * S) * .5f;
  static bool first = true;
  if (ImGui::IsWindowAppearing()) first = true;
  choice = 0;
  if (pill("yes", "\xE2\x9C\x93", yes, false, true, bw, 60 * S)) choice = 1;
  if (first) { focusPrev(); first = false; }
  ImGui::SameLine(0, 20 * S);
  if (pill("no", "\xE2\x86\xA9", no, false, true, bw, 60 * S)) choice = 2;
  if (ImGui::IsKeyPressed(ImGuiKey_GamepadFaceRight) || ImGui::IsKeyPressed(ImGuiKey_Escape)) choice = 2;
  ImGui::End();
  return choice != 0;
}

static void drawMenu() {
  ImGuiIO& io = ImGui::GetIO(); ImVec2 ds = io.DisplaySize;
  ImDrawList* bg = ImGui::GetBackgroundDrawList();
  float a = openT;
  bg->AddRectFilled(ImVec2(0, 0), ds, IM_COL32(0, 0, 0, (int)(110 * a)));
  bg->AddRectFilledMultiColor(ImVec2(0, 0), ImVec2(ds.x * .55f, ds.y), IM_COL32(0, 0, 0, (int)(150 * a)), IM_COL32(0, 0, 0, 0), IM_COL32(0, 0, 0, 0), IM_COL32(0, 0, 0, (int)(150 * a)));

  ImGui::SetNextWindowPos(ImVec2(0, 0)); ImGui::SetNextWindowSize(ds);
  if (focusFirst) ImGui::SetNextWindowFocus();
  ImGuiWindowFlags wf = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus;
  if (confirm) wf |= ImGuiWindowFlags_NoInputs;
  ImGui::Begin("##menu", nullptr, wf);
  ImDrawList* dl = ImGui::GetWindowDrawList();
  float slide = (1 - a) * 40 * S;

  // En-tête : titre du jeu, console, horloge, temps de jeu
  float L = 80 * S + -slide, T = 70 * S;
  text(dl, fBold, 46, ImVec2(L, T), W(1), g_app.title.c_str());
  std::string sub = (g_app.console.empty() ? std::string("") : g_app.console + "  ·  ") + "En pause";
  ImVec2 ss = textSize(fBold, 16, sub.c_str());
  dl->AddRectFilled(ImVec2(L, T + 66 * S), ImVec2(L + ss.x + 28 * S, T + 98 * S), W(.1f), 16 * S);
  text(dl, fBold, 16, ImVec2(L + 14 * S, T + 73 * S), W(.85f), sub.c_str());
  SDL_Time now; SDL_GetCurrentTime(&now); SDL_DateTime dt; SDL_TimeToDateTime(now, &dt, true);
  char clock[16]; SDL_snprintf(clock, sizeof clock, "%02d:%02d", dt.hour, dt.minute);
  ImVec2 cs = textSize(fBold, 30, clock); text(dl, fBold, 30, ImVec2(ds.x - 80 * S - cs.x, T + 6 * S), W(.95f), clock);
  int mins = (int)(g_app.playedNs / 60000000000ULL); char pt[64];
  if (mins < 60) SDL_snprintf(pt, sizeof pt, TR("Session : %d min"), mins); else SDL_snprintf(pt, sizeof pt, TR("Session : %d h %02d"), mins / 60, mins % 60);
  ImVec2 ps = textSize(fReg, 18, pt); text(dl, fReg, 18, ImVec2(ds.x - 80 * S - ps.x, T + 48 * S), W(.5f), pt);

  // Colonne de gauche
  float top = 230 * S, lw = 400 * S, ph = 64 * S, gapY = 12 * S;
  ImGui::SetCursorScreenPos(ImVec2(L, top));
  ImGui::BeginChild("##nav", ImVec2(lw + 30 * S, ds.y - top - 120 * S), ImGuiChildFlags_NavFlattened, ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoScrollbar);
  ImGui::SetCursorPos(ImVec2(10 * S, 10 * S));
  for (int i = 0; i < SEC_COUNT; i++) {
    if (i == SEC_RESTART) ImGui::Dummy(ImVec2(0, 14 * S));
    ImGui::SetCursorPosX(10 * S);
    bool en = i != SEC_CHEAT;
    if (pill(kSecLabel[i], kSecIcon[i], kSecLabel[i], section == i && i != SEC_RESUME, en, lw, ph)) {
      if (i == SEC_RESUME) g_app.closeMenu();
      else if (i == SEC_RESTART) confirm = 2;
      else if (i == SEC_QUIT) confirm = 1;
      else { section = i; ImGui::SetNavCursorVisible(true); }
    }
    if (focusFirst && i == 0) { focusPrev(); focusFirst = false; }
    // la section suit le focus (comme Steam) pour les entrées qui ont un panneau
    if (ImGui::IsItemFocused() && i >= SEC_SAVES && i <= SEC_CHEAT && g_debugSection < 0) section = i;
    ImGui::Dummy(ImVec2(0, gapY - ImGui::GetStyle().ItemSpacing.y));
  }
  ImGui::EndChild();

  // Panneau de droite
  float px = L + lw + 70 * S, pw = ds.x - px - 80 * S, py = top, phh = ds.y - top - 140 * S;
  if (section >= SEC_SAVES && section <= SEC_CHEAT) {
    ImVec2 pa(px, py), pb(px + pw, py + phh);
    glass(dl, pa, pb, 34 * S, .62f);
    ImGui::SetCursorScreenPos(ImVec2(px + 44 * S, py + 38 * S));
    ImGui::BeginChild("##panel", ImVec2(pw - 88 * S, phh - 70 * S), ImGuiChildFlags_NavFlattened, ImGuiWindowFlags_NoBackground);
    switch (section) {
    case SEC_SAVES: secSaves(); break; case SEC_IMAGE: secImage(); break; case SEC_SOUND: secSound(); break;
    case SEC_PAD: secPad(); break; case SEC_ADV: secAdvanced(); break; case SEC_CHEAT: secCheat(); break;
    }
    ImGui::EndChild();
  }
  static const char* hints[] = { "A", "Valider", "B", "Reprendre", "Guide", "Fermer le menu" };
  hintsBar(dl, hints, 6);
  ImGui::End();

  // B / Échap au premier niveau : reprendre
  if (!confirm && !ImGui::IsAnyItemActive() && ImGui::IsKeyPressed(ImGuiKey_GamepadFaceRight, false)) g_app.closeMenu();

  int c = 0;
  if (confirm == 1 && modal("Quitter le jeu ?", "Ta partie est sauvegardée automatiquement : au prochain lancement, Arcadia te proposera de reprendre ici.", "Quitter", "Annuler", c)) { if (c == 1) g_app.quit(); confirm = 0; }
  if (confirm == 2 && modal("Redémarrer ?", "Le jeu repart de zéro. Ce qui n'est pas sauvegardé sera perdu.", "Redémarrer", "Annuler", c)) { if (c == 1) { g_app.restart(); g_app.closeMenu(); } confirm = 0; }
  if (confirm == 3) {
    std::string t = slotSel == 0 ? "Reprise auto" : "Emplacement " + std::to_string(slotSel);
    if (modal(t.c_str(), g_app.slots[slotSel].date.c_str(), "Charger", slotSel == 0 ? "Annuler" : "Écraser", c)) {
      if (c == 1) { if (g_app.loadSlot(slotSel)) g_app.closeMenu(); }
      else if (c == 2 && slotSel != 0 && !ImGui::IsKeyPressed(ImGuiKey_GamepadFaceRight) && !ImGui::IsKeyPressed(ImGuiKey_Escape)) { g_app.saveSlot(slotSel); g_app.refreshSlots(); }
      confirm = 0;
    }
  }
}

extern void uiChooseResume(bool);
static void drawResumePrompt() {
  ImVec2 ds = ImGui::GetIO().DisplaySize; ImDrawList* bg = ImGui::GetBackgroundDrawList();
  SlotInfo& s = g_app.slots[0];
  if (s.thumb) { // l'image de la reprise, en grand et assombrie
    float ar = s.th ? (float)s.tw / s.th : 16.f / 9; float w = ds.x, h = w / ar; if (h < ds.y) { h = ds.y; w = h * ar; }
    bg->AddImage((ImTextureID)(intptr_t)s.thumb, ImVec2((ds.x - w) * .5f, (ds.y - h) * .5f), ImVec2((ds.x + w) * .5f, (ds.y + h) * .5f), ImVec2(0, 0), ImVec2(1, 1), IM_COL32(255, 255, 255, 70));
  }
  bg->AddRectFilled(ImVec2(0, 0), ds, IM_COL32(0, 0, 0, 90));
  float w = 760 * S, h = 560 * S; ImVec2 a((ds.x - w) * .5f, (ds.y - h) * .5f), b(a.x + w, a.y + h);
  ImGui::SetNextWindowPos(a); ImGui::SetNextWindowSize(ImVec2(w, h));
  ImGui::Begin("##resume", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings);
  ImDrawList* dl = ImGui::GetWindowDrawList();
  glow(dl, a, b, 34 * S, .8f); glass(dl, a, b, 34 * S, .82f);
  text(dl, fBold, 34, ImVec2(a.x + 44 * S, a.y + 38 * S), W(1), "Reprendre ta partie ?");
  std::string d = "Laissée le " + s.date; text(dl, fReg, 19, ImVec2(a.x + 44 * S, a.y + 88 * S), W(.55f), d.c_str());
  ImVec2 ia(a.x + 44 * S, a.y + 130 * S), ib(b.x - 44 * S, a.y + 130 * S + (w - 88 * S) * 9 / 16 * .62f);
  if (s.thumb) { float ar = s.th ? (float)s.tw / s.th : 16.f / 9; float ih = ib.y - ia.y, iw = ih * ar; float cx = (ia.x + ib.x) * .5f; dl->AddImageRounded((ImTextureID)(intptr_t)s.thumb, ImVec2(cx - iw * .5f, ia.y), ImVec2(cx + iw * .5f, ib.y), ImVec2(0, 0), ImVec2(1, 1), W(1), 18 * S); }
  ImGui::SetCursorScreenPos(ImVec2(a.x + 44 * S, b.y - 108 * S));
  float bw = (w - 108 * S) * .5f;
  bool appear = ImGui::IsWindowAppearing();
  if (pill("go", "\xE2\x96\xB6", "Reprendre", false, true, bw, 64 * S)) uiChooseResume(true);
  if (appear) focusPrev();
  ImGui::SameLine(0, 20 * S);
  if (pill("new", "\xE2\x86\xBB", "Nouvelle partie", false, true, bw, 64 * S)) uiChooseResume(false);
  ImGui::End();
}

static void drawToasts() {
  ImDrawList* fg = ImGui::GetForegroundDrawList(); ImVec2 ds = ImGui::GetIO().DisplaySize;
  uint64_t now = SDL_GetTicks(); float y = ds.y - 120 * S;
  while (!g_app.toasts.empty() && g_app.toasts.front().until < now) g_app.toasts.pop_front();
  for (auto it = g_app.toasts.rbegin(); it != g_app.toasts.rend(); ++it) {
    float left = (float)(it->until - now); float a = std::min(1.f, left / 300.f);
    ImVec2 ts = textSize(fBold, 20, it->text.c_str());
    ImVec2 p((ds.x - ts.x) * .5f - 28 * S, y), q((ds.x + ts.x) * .5f + 28 * S, y + 52 * S);
    for (int i = 1; i <= 8; i++) { float e = i * 2 * S; fg->AddRect(ImVec2(p.x - e, p.y - e), ImVec2(q.x + e, q.y + e), W(.04f * a * (1 - i / 9.f)), 26 * S + e, 0, 2 * S); }
    fg->AddRectFilled(p, q, K(.88f * a), 26 * S); fg->AddRect(p, q, W(.14f * a), 26 * S, 0, 1.2f * S);
    fg->AddText(fBold, 20 * S, ImVec2(p.x + 28 * S, p.y + 14 * S), W(a), TR(it->text.c_str()));
    y -= 64 * S;
  }
  if (g_app.cfg.getb("perf", false) && !g_app.menuOpen) {
    char b[48]; SDL_snprintf(b, sizeof b, "%.0f FPS  ·  %.1f ms", g_app.fps, g_app.fps > 0 ? 1000.f / g_app.fps : 0.f);
    ImVec2 ts = textSize(fBold, 17, b); ImVec2 p(24 * S, 24 * S), q(p.x + ts.x + 32 * S, p.y + 40 * S);
    fg->AddRectFilled(p, q, K(.75f), 20 * S); fg->AddText(fBold, 17 * S, ImVec2(p.x + 16 * S, p.y + 10 * S), W(.95f), TR(b));
  }
  if (g_app.ptrVirtual && !g_app.menuOpen) { // curseur virtuel (stick droit)
    ImVec2 c(g_app.ptrX, g_app.ptrY); float r = (g_app.ptrDown ? 9.f : 12.f) * S;
    for (int i = 1; i <= 6; i++) fg->AddCircle(c, r + i * 2.f * S, W(.06f * (1 - i / 7.f)), 0, 2 * S);
    fg->AddCircleFilled(c, r, g_app.ptrDown ? W(.95f) : W(.35f)); fg->AddCircle(c, r, W(.95f), 0, 2 * S);
  }
  if (g_app.speedMode && !g_app.menuOpen) {
    const char* t = g_app.speedMode == 1 ? "\xE2\x96\xB6\xE2\x96\xB6 ×2" : "×0,5";
    ImVec2 ts = textSize(fBold, 18, t); ImVec2 p(ds.x - ts.x - 56 * S, 24 * S), q(ds.x - 24 * S, 64 * S);
    fg->AddRectFilled(p, q, W(.92f), 20 * S); fg->AddText(fBold, 18 * S, ImVec2(p.x + 16 * S, p.y + 10 * S), K(1), TR(t));
  }
}

// ───────────────────────── Intégration ─────────────────────────
static const char* firstExisting(std::initializer_list<const char*> l) { for (auto* p : l) if (fileExists(p)) return p; return nullptr; }

void uiInit() {
  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  loadAccent();
  ImGuiIO& io = ImGui::GetIO();
  io.IniFilename = nullptr; io.LogFilename = nullptr;
  io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad | ImGuiConfigFlags_NavEnableKeyboard;
  ImGuiStyle& st = ImGui::GetStyle();
  st.WindowPadding = ImVec2(0, 0); st.WindowBorderSize = 0; st.ItemSpacing = ImVec2(0, 0);
  st.Colors[ImGuiCol_NavCursor] = ImVec4(0, 0, 0, 0);
  st.Colors[ImGuiCol_WindowBg] = ImVec4(0, 0, 0, 0); st.Colors[ImGuiCol_ChildBg] = ImVec4(0, 0, 0, 0);
  st.Colors[ImGuiCol_ScrollbarBg] = ImVec4(0, 0, 0, 0); st.Colors[ImGuiCol_ScrollbarGrab] = ImVec4(1, 1, 1, .15f);
  st.ScrollbarSize = 6; st.ScrollbarRounding = 3;
  const char* reg = firstExisting({ "C:\\Windows\\Fonts\\SegUIVar.ttf", "C:\\Windows\\Fonts\\segoeui.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf" });
  const char* bold = firstExisting({ "C:\\Windows\\Fonts\\segoeuib.ttf", "C:\\Windows\\Fonts\\SegUIVar.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf" });
  ImFontConfig fc; fc.OversampleH = 2;
  // symboles (▶ ◆ ♪ ✦ ★ ↻ ✕) : police de symboles de Windows fusionnée à chaque police
  const char* sym = firstExisting({ "C:\\Windows\\Fonts\\seguisym.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" });
  auto addFont = [&](const char* path) -> ImFont* {
    ImFont* f = path ? io.Fonts->AddFontFromFileTTF(path, 24.f, &fc) : io.Fonts->AddFontDefault();
    if (sym && path) { ImFontConfig m; m.MergeMode = true; io.Fonts->AddFontFromFileTTF(sym, 24.f, &m); }
    return f;
  };
  fReg = addFont(reg);
  fBold = bold ? addFont(bold) : fReg;
  ImGui_ImplSDL3_InitForOpenGL(g_app.window, g_app.gl);
  ImGui_ImplOpenGL3_Init(nullptr);
}

bool uiProcessEvent(const SDL_Event& e) { return ImGui_ImplSDL3_ProcessEvent(&e); }
bool uiWantsInput() { return confirm != 0; }

void uiFrame() {
  S = std::max(.5f, g_app.winH / 1080.f);
  static bool wasOpen = false;
  bool open = g_app.menuOpen;
  if (open && !wasOpen) { focusFirst = true; openT = 0; section = g_debugSection >= 0 ? g_debugSection : SEC_SAVES; confirm = 0; mouseActive = false; }
  if (ImGui::GetIO().MouseDelta.x != 0 || ImGui::GetIO().MouseDelta.y != 0) mouseActive = true;
  wasOpen = open;
  openT = std::min(1.f, openT + ImGui::GetIO().DeltaTime * 6.f);
  ImGui_ImplOpenGL3_NewFrame(); ImGui_ImplSDL3_NewFrame(); ImGui::NewFrame();
  ImGui::PushFont(fReg, 24.f);
  if (g_app.resumePrompt) drawResumePrompt();
  else if (open) drawMenu();
  drawControlsHint();
  drawToasts();
  ImGui::PopFont();
  ImGui::Render();
  ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

void uiShutdown() {
  ImGui_ImplOpenGL3_Shutdown(); ImGui_ImplSDL3_Shutdown(); ImGui::DestroyContext();
}

// ───────────────────────── Calibrage manette ─────────────────────────
static void drawPad(ImDrawList* dl, ImVec2 o, float k, const CalibView& v, float t) {
  auto P = [&](float x, float y) { return ImVec2(o.x + x * k, o.y + y * k); };
  std::string tg = v.phase == 0 ? (v.layout == "switch" ? "b" : "a") : v.phase == 1 ? v.target : "";
  float pulse = .8f + .2f * std::sin(t * 6.f);
  auto on = [&](std::initializer_list<const char*> l) { for (auto* s : l) if (tg == s) return true; return false; };
  ImU32 dim = W(.16f), line = W(.28f);
  // corps + poignées : silhouette unifiée (contour = même forme un peu plus grande, dessinée dessous)
  auto body = [&](float e, ImU32 c) {
    dl->AddCircleFilled(P(150, 250), 110 * k + e, c, 64); dl->AddCircleFilled(P(450, 250), 110 * k + e, c, 64);
    dl->AddRectFilled(ImVec2(P(110, 110).x - e, P(110, 110).y - e), ImVec2(P(490, 300).x + e, P(490, 300).y + e), c, 90 * k + e);
  };
  body(1.6f * k, line); body(0, IM_COL32(16, 16, 19, 255));
  auto hl = [&](bool lit, ImVec2 a, ImVec2 b, float r) {
    if (lit) { glow(dl, a, b, r, 2.2f * pulse); dl->AddRectFilled(a, b, W(pulse), r); }
    else dl->AddRectFilled(a, b, dim, r);
  };
  auto circ = [&](bool lit, ImVec2 c, float r, const char* lab) {
    if (lit) { for (int i = 1; i <= 8; i++) dl->AddCircle(c, r + i * 2.5f * k, W(.1f * pulse * (1 - i / 9.f)), 0, 2.5f * k); dl->AddCircleFilled(c, r, W(pulse)); }
    else dl->AddCircleFilled(c, r, dim);
    if (lab) { ImVec2 ts = fBold->CalcTextSizeA(r * 1.1f, FLT_MAX, 0, TR(lab)); dl->AddText(fBold, r * 1.1f, ImVec2(c.x - ts.x * .5f, c.y - ts.y * .5f), lit ? K(1) : W(.7f), TR(lab)); }
  };
  // gâchettes
  hl(on({ "lefttrigger" }), P(130, 40), P(210, 70), 14 * k); hl(on({ "righttrigger" }), P(390, 40), P(470, 70), 14 * k);
  hl(on({ "leftshoulder" }), P(120, 80), P(230, 100), 10 * k); hl(on({ "rightshoulder" }), P(370, 80), P(480, 100), 10 * k);
  // sticks
  bool ls = on({ "leftstick", "leftx", "lefty" }), rs = on({ "rightstick", "rightx", "righty" });
  circ(ls, P(170, 175), 34 * k, nullptr); dl->AddCircle(P(170, 175), 22 * k, ls ? K(.5f) : W(.25f), 0, 2 * k);
  circ(rs, P(370, 255), 34 * k, nullptr); dl->AddCircle(P(370, 255), 22 * k, rs ? K(.5f) : W(.25f), 0, 2 * k);
  auto arrow = [&](ImVec2 c, bool horiz) {
    float d = 58 * k; ImVec2 e = horiz ? ImVec2(c.x + d, c.y) : ImVec2(c.x, c.y + d);
    ImVec2 s = horiz ? ImVec2(c.x + 40 * k, c.y) : ImVec2(c.x, c.y + 40 * k);
    dl->AddLine(s, e, W(pulse), 4 * k);
    if (horiz) dl->AddTriangleFilled(ImVec2(e.x + 10 * k, e.y), ImVec2(e.x - 4 * k, e.y - 10 * k), ImVec2(e.x - 4 * k, e.y + 10 * k), W(pulse));
    else dl->AddTriangleFilled(ImVec2(e.x, e.y + 10 * k), ImVec2(e.x - 10 * k, e.y - 4 * k), ImVec2(e.x + 10 * k, e.y - 4 * k), W(pulse));
  };
  if (tg == "leftx") arrow(P(170, 175), true); if (tg == "lefty") arrow(P(170, 175), false);
  if (tg == "rightx") arrow(P(370, 255), true); if (tg == "righty") arrow(P(370, 255), false);
  // croix
  ImVec2 dc = P(235, 255); float a = 14 * k, b = 40 * k;
  hl(on({ "dpup" }), ImVec2(dc.x - a, dc.y - b), ImVec2(dc.x + a, dc.y - a), 5 * k);
  hl(on({ "dpdown" }), ImVec2(dc.x - a, dc.y + a), ImVec2(dc.x + a, dc.y + b), 5 * k);
  hl(on({ "dpleft" }), ImVec2(dc.x - b, dc.y - a), ImVec2(dc.x - a, dc.y + a), 5 * k);
  hl(on({ "dpright" }), ImVec2(dc.x + a, dc.y - a), ImVec2(dc.x + b, dc.y + a), 5 * k);
  dl->AddRectFilled(ImVec2(dc.x - a, dc.y - a), ImVec2(dc.x + a, dc.y + a), dim);
  // boutons de face (positions physiques)
  const char *S_ = "A", *E_ = "B", *W_ = "X", *N_ = "Y";
  if (v.layout == "switch") { S_ = "B"; E_ = "A"; W_ = "Y"; N_ = "X"; }
  else if (v.layout == "generic") { S_ = "\xE2\x9C\x95"; E_ = "\xE2\x97\x8B"; W_ = "\xE2\x96\xA1"; N_ = "\xE2\x96\xB3"; }
  circ(on({ "a" }), P(430, 210), 19 * k, S_); circ(on({ "b" }), P(470, 172), 19 * k, E_);
  circ(on({ "x" }), P(390, 172), 19 * k, W_); circ(on({ "y" }), P(430, 134), 19 * k, N_);
  // centre
  hl(on({ "back" }), P(255, 165), P(283, 183), 9 * k); hl(on({ "start" }), P(317, 165), P(345, 183), 9 * k);
  circ(on({ "guide" }), P(300, 128), 15 * k, nullptr);
}

void uiCalib(const CalibView& v) {
  S = std::max(.5f, g_app.winH / 1080.f);
  ImGui_ImplOpenGL3_NewFrame(); ImGui_ImplSDL3_NewFrame(); ImGui::NewFrame();
  ImGui::PushFont(fReg, 24.f);
  ImDrawList* dl = ImGui::GetBackgroundDrawList(); ImVec2 ds = ImGui::GetIO().DisplaySize;
  float t = (float)ImGui::GetTime();
  dl->AddRectFilledMultiColor(ImVec2(0, 0), ds, IM_COL32(26, 26, 32, 255), IM_COL32(16, 16, 20, 255), IM_COL32(8, 8, 10, 255), IM_COL32(12, 12, 16, 255));
  text(dl, fBold, 22, ImVec2(60 * S, 52 * S), W(.9f), "ARCADIA");
  text(dl, fReg, 22, ImVec2(60 * S + textSize(fBold, 22, "ARCADIA").x + 18 * S, 52 * S), W(.45f), "Calibrage de la manette");
  float w = std::min(ds.x - 120 * S, 1500 * S), h = std::min(ds.y - 220 * S, 720 * S);
  ImVec2 a((ds.x - w) * .5f, (ds.y - h) * .5f + 10 * S), b(a.x + w, a.y + h);
  glow(dl, a, b, 36 * S, .8f); glass(dl, a, b, 36 * S, .78f);
  // schéma de la manette à gauche
  float k = std::min((w * .5f) / 600.f, (h - 80 * S) / 340.f);
  drawPad(dl, ImVec2(a.x + 40 * S + (w * .5f - 600 * k) * .5f, a.y + (h - 330 * k) * .5f - 10 * S), k, v, t);
  // texte à droite
  float x = a.x + w * .55f, tw = w * .42f, y = a.y + 90 * S;
  if (v.phase == 0) {
    text(dl, fReg, 20, ImVec2(x, y), W(.5f), "Étape 1 — Reconnaissance"); y += 46 * S;
    text(dl, fBold, 46, ImVec2(x, y), W(1), v.layout == "switch" ? "Appuie sur A" : v.layout == "generic" ? "Appuie sur un bouton" : "Appuie sur A"); y += 80 * S;
    text(dl, fReg, 21, ImVec2(x, y), W(.62f), "Arcadia reconnaît ta manette et règle toutes les touches pour tous tes jeux : PSP, DS, 3DS, PS1, Game Boy, Switch…", tw);
  } else if (v.phase == 1) {
    char st[64]; SDL_snprintf(st, sizeof st, TR("Étape %d / %d"), v.step + 1, v.total);
    text(dl, fReg, 20, ImVec2(x, y), W(.5f), st);
    text(dl, fReg, 20, ImVec2(x + textSize(fReg, 20, st).x + 16 * S, y), W(.35f), v.padName.c_str()); y += 46 * S;
    text(dl, fBold, 40, ImVec2(x, y), W(1), v.label.c_str(), tw); y += textSize(fBold, 40, v.label.c_str()).y * std::ceil(textSize(fBold, 40, v.label.c_str()).x / tw) + 30 * S;
    text(dl, fReg, 20, ImVec2(x, y), W(.5f), "Ta manette n'est pas connue : on règle chaque touche une fois, Arcadia s'en souviendra pour tous les jeux.", tw);
    float py = b.y - 90 * S, pw = tw; // barre de progression
    dl->AddRectFilled(ImVec2(x, py), ImVec2(x + pw, py + 8 * S), W(.1f), 4 * S);
    dl->AddRectFilled(ImVec2(x, py), ImVec2(x + pw * (float)v.step / std::max(1, v.total), py + 8 * S), W(.9f), 4 * S);
  } else if (v.phase == 2) {
    float cy = y + 30 * S; ImVec2 c(x + 34 * S, cy);
    for (int i = 1; i <= 8; i++) dl->AddCircle(c, 34 * S + i * 2.5f * S, W(.06f * (1 - i / 9.f)), 0, 2.5f * S);
    dl->AddCircleFilled(c, 34 * S, W(.95f));
    dl->AddPolyline(std::vector<ImVec2>{ ImVec2(c.x - 15 * S, c.y), ImVec2(c.x - 4 * S, c.y + 11 * S), ImVec2(c.x + 16 * S, c.y - 12 * S) }.data(), 3, K(1), 0, 5 * S);
    y += 100 * S;
    text(dl, fBold, 44, ImVec2(x, y), W(1), "Manette prête"); y += 66 * S;
    text(dl, fBold, 22, ImVec2(x, y), W(.85f), v.padName.c_str(), tw); y += 44 * S;
    text(dl, fReg, 20, ImVec2(x, y), W(.55f), v.known ? "Reconnue automatiquement : les touches sont déjà au bon endroit dans tous les jeux." : "Calibrage enregistré : il s'applique à tous tes jeux et à tous les moteurs.", tw);
  }
  if (v.phase == 1 || v.phase == 0) {
    ImDrawList* fg = ImGui::GetForegroundDrawList();
    const char* items0[] = { "Échap", "Annuler" };
    const char* items1[] = { "Espace", "Passer", "\xE2\x8C\xAB", "Retour", "Échap", "Annuler" };
    if (v.phase == 0) hintsBar(fg, items0, 2); else hintsBar(fg, items1, 6);
  }
  ImGui::PopFont();
  ImGui::Render(); ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}
