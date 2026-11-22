// Calibrage manette façon Eden : « appuie sur A », puis bouton par bouton si SDL ne connaît pas la manette.
// Produit une ligne de mapping SDL (gamecontrollerdb) réutilisée par le moteur Arcadia ET les moteurs externes.
#include "app.h"
#include "util.h"
#include "imgui.h"
#include "imgui_impl_sdl3.h"
#include "imgui_impl_opengl3.h"
#include <cstring>
#include <cmath>
#include <map>
#include <set>

struct Step { const char* target; const char* xbox; const char* nin; const char* gen; bool axisOnly; };
static const Step kSteps[] = {
  { "a", "A", "B", "le bouton du BAS (\xE2\x9C\x95 sur PlayStation)", false },
  { "b", "B", "A", "le bouton de DROITE (\xE2\x97\x8B sur PlayStation)", false },
  { "x", "X", "Y", "le bouton de GAUCHE (\xE2\x96\xA1 sur PlayStation)", false },
  { "y", "Y", "X", "le bouton du HAUT (\xE2\x96\xB3 sur PlayStation)", false },
  { "dpup", "la croix HAUT", "la croix HAUT", "la croix directionnelle HAUT", false },
  { "dpdown", "la croix BAS", "la croix BAS", "la croix directionnelle BAS", false },
  { "dpleft", "la croix GAUCHE", "la croix GAUCHE", "la croix directionnelle GAUCHE", false },
  { "dpright", "la croix DROITE", "la croix DROITE", "la croix directionnelle DROITE", false },
  { "leftshoulder", "LB", "L", "la gâchette haute GAUCHE", false },
  { "rightshoulder", "RB", "R", "la gâchette haute DROITE", false },
  { "lefttrigger", "LT", "ZL", "la gâchette basse GAUCHE", false },
  { "righttrigger", "RT", "ZR", "la gâchette basse DROITE", false },
  { "back", "View (\xE2\xA7\x89)", "\xE2\x88\x92", "Select / Share", false },
  { "start", "Menu (\xE2\x89\xA1)", "+", "Start / Options", false },
  { "leftstick", "le clic du stick GAUCHE", "le clic du stick GAUCHE", "le clic du stick GAUCHE", false },
  { "rightstick", "le clic du stick DROIT", "le clic du stick DROIT", "le clic du stick DROIT", false },
  { "leftx", "le stick GAUCHE vers la DROITE", "le stick GAUCHE vers la DROITE", "le stick GAUCHE vers la DROITE", true },
  { "lefty", "le stick GAUCHE vers le BAS", "le stick GAUCHE vers le BAS", "le stick GAUCHE vers le BAS", true },
  { "rightx", "le stick DROIT vers la DROITE", "le stick DROIT vers la DROITE", "le stick DROIT vers la DROITE", true },
  { "righty", "le stick DROIT vers le BAS", "le stick DROIT vers le BAS", "le stick DROIT vers le BAS", true },
  { "guide", "le bouton Xbox", "HOME", "le bouton central (Home / PS)", false },
};
static const int kN = sizeof kSteps / sizeof kSteps[0];

static std::string guidStr(SDL_JoystickID id) { char b[64]; SDL_GUIDToString(SDL_GetJoystickGUIDForID(id), b, sizeof b); return b; }
static std::string cleanName(const char* n) { std::string s = n ? n : "Manette"; for (auto& c : s) if (c == ',') c = ' '; return s; }

int runCalibration(int argc, char** argv) {
  auto arg = [&](const char* k, const char* d) -> std::string { for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], k)) return argv[i + 1]; return d; };
  bool full = false; for (int i = 1; i < argc; i++) if (!strcmp(argv[i], "--full")) full = true;
  int autoQuit = SDL_atoi(arg("--quit-at", "0").c_str());
  std::string capture = arg("--capture", ""); int captureAt = SDL_atoi(arg("--capture-at", "30").c_str());
  CalibView v; v.layout = arg("--layout", "xbox");
  std::string db = arg("--pad-db", "");

  SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
  if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMEPAD | SDL_INIT_JOYSTICK)) return 1;
  if (!db.empty()) SDL_AddGamepadMappingsFromFile(db.c_str());
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_COMPATIBILITY);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  int ww = SDL_atoi(arg("--width", "1280").c_str()), wh = SDL_atoi(arg("--height", "760").c_str());
  g_app.window = SDL_CreateWindow("Calibrage de la manette — Arcadia", ww, wh, SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY);
  if (!g_app.window) return 1;
  g_app.gl = SDL_GL_CreateContext(g_app.window); SDL_GL_MakeCurrent(g_app.window, g_app.gl);
  if (!glLoad()) return 1;
  SDL_GL_SetSwapInterval(1);
  SDL_GetWindowSizeInPixels(g_app.window, &g_app.winW, &g_app.winH);
  uiInit();

  // Toutes les manettes sont ouvertes en brut : celle qui appuie la première est retenue
  std::map<SDL_JoystickID, SDL_Joystick*> joys;
  std::map<SDL_JoystickID, std::vector<int>> rest;
  auto openAll = [&]() {
    int n = 0; SDL_JoystickID* ids = SDL_GetJoysticks(&n);
    for (int i = 0; i < n; i++) if (!joys.count(ids[i])) {
      SDL_Joystick* j = SDL_OpenJoystick(ids[i]); if (!j) continue;
      joys[ids[i]] = j; auto& r = rest[ids[i]];
      for (int a = 0; a < SDL_GetNumJoystickAxes(j); a++) r.push_back(SDL_GetJoystickAxis(j, a));
    }
    SDL_free(ids);
  };
  // test automatique : manette virtuelle inconnue pilotée par un script
  SDL_Joystick* vj = nullptr;
  if (SDL_getenv("ARCADIA_CALIB_VIRTUAL")) {
    SDL_VirtualJoystickDesc d; SDL_INIT_INTERFACE(&d);
    d.type = SDL_JOYSTICK_TYPE_UNKNOWN; d.naxes = 6; d.nbuttons = 12; d.nhats = 1; d.vendor_id = 0x1234; d.product_id = 0x5678; d.name = "Manette, virtuelle";
    SDL_JoystickID id = SDL_AttachVirtualJoystick(&d); vj = SDL_OpenJoystick(id);
    SDL_SetJoystickVirtualAxis(vj, 2, -32768); SDL_SetJoystickVirtualAxis(vj, 5, -32768); SDL_UpdateJoysticks();
  }
  openAll();
  SDL_JoystickID pad = 0; std::map<std::string, std::string> bind; std::set<std::string> used;
  bool waitRelease = false; uint64_t doneAt = 0; int frame = 0;
  auto setStep = [&](int s) {
    v.step = s; v.total = kN;
    if (s >= kN) { v.phase = 2; doneAt = SDL_GetTicks(); return; }
    const Step& st = kSteps[s]; v.target = st.target;
    const char* l = v.layout == "switch" ? st.nin : v.layout == "generic" ? st.gen : st.xbox;
    v.label = st.axisOnly ? std::string("Pousse ") + l : std::string("Appuie sur ") + l;
    v.hint = s == kN - 1 ? "Espace pour passer si ta manette n'en a pas" : "Espace : passer   ·   Retour arrière : étape précédente   ·   Échap : annuler";
  };
  auto finish = [&]() {
    std::string name = cleanName(SDL_GetJoystickNameForID(pad)), g = guidStr(pad);
    std::string m;
    if (v.known && !full) { char* gm = SDL_GetGamepadMappingForID(pad); if (gm) { m = gm; SDL_free(gm); } }
    else {
      m = g + "," + name;
      for (auto& [k, val] : bind) m += "," + k + ":" + val;
      m += std::string(",platform:") + SDL_GetPlatform() + ",";
      SDL_AddGamepadMapping(m.c_str());
    }
    emit("{\"event\":\"pad\",\"guid\":\"" + jsonEsc(g) + "\",\"name\":\"" + jsonEsc(name) + "\",\"known\":" + (v.known && !full ? "true" : "false") +
         ",\"mapping\":\"" + jsonEsc(m) + "\"}");
  };
  auto accept = [&](const std::string& val) {
    if (v.phase == 0) {
      v.known = SDL_IsGamepad(pad); v.padName = cleanName(SDL_GetJoystickNameForID(pad));
      if (v.known && !full) { v.phase = 2; doneAt = SDL_GetTicks(); finish(); }
      else { v.phase = 1; setStep(0); }
      waitRelease = true; return;
    }
    if (v.phase != 1 || used.count(val)) return;
    bind[v.target] = val; used.insert(val); waitRelease = true;
    setStep(v.step + 1); if (v.phase == 2) finish();
  };
  auto released = [&]() {
    SDL_Joystick* j = joys[pad]; if (!j) return true;
    for (int b = 0; b < SDL_GetNumJoystickButtons(j); b++) if (SDL_GetJoystickButton(j, b)) return false;
    for (int h = 0; h < SDL_GetNumJoystickHats(j); h++) if (SDL_GetJoystickHat(j, h)) return false;
    auto& r = rest[pad];
    for (int a = 0; a < SDL_GetNumJoystickAxes(j) && a < (int)r.size(); a++) if (std::abs(SDL_GetJoystickAxis(j, a) - r[a]) > 9000) return false;
    return true;
  };

  bool run = true;
  while (run) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      extern bool uiProcessEvent(const SDL_Event&); uiProcessEvent(e);
      if (e.type == SDL_EVENT_QUIT) { v.phase = 3; run = false; }
      if (e.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED) SDL_GetWindowSizeInPixels(g_app.window, &g_app.winW, &g_app.winH);
      if (e.type == SDL_EVENT_JOYSTICK_ADDED) openAll();
      if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
        if (e.key.key == SDLK_ESCAPE) { v.phase = 3; run = false; }
        else if (v.phase == 1 && (e.key.key == SDLK_SPACE || e.key.key == SDLK_RETURN)) { setStep(v.step + 1); if (v.phase == 2) finish(); }
        else if (v.phase == 1 && e.key.key == SDLK_BACKSPACE && v.step > 0) {
          setStep(v.step - 1); auto it = bind.find(v.target); if (it != bind.end()) { used.erase(it->second); bind.erase(it); }
        }
      }
      if (v.phase > 1 || waitRelease) continue;
      SDL_JoystickID who = 0; std::string val;
      if (e.type == SDL_EVENT_JOYSTICK_BUTTON_DOWN) { who = e.jbutton.which; val = "b" + std::to_string(e.jbutton.button); }
      else if (e.type == SDL_EVENT_JOYSTICK_HAT_MOTION && (e.jhat.value == 1 || e.jhat.value == 2 || e.jhat.value == 4 || e.jhat.value == 8)) {
        who = e.jhat.which; val = "h" + std::to_string(e.jhat.hat) + "." + std::to_string(e.jhat.value);
      } else if (e.type == SDL_EVENT_JOYSTICK_AXIS_MOTION) {
        auto& r = rest[e.jaxis.which]; int a = e.jaxis.axis; if (a >= (int)r.size()) continue;
        int d = e.jaxis.value - r[a]; if (std::abs(d) < 16000) continue;
        who = e.jaxis.which;
        bool trig = v.phase == 1 && (!strcmp(v.target, "lefttrigger") || !strcmp(v.target, "righttrigger"));
        bool stick = v.phase == 1 && kSteps[v.step].axisOnly;
        if (stick) val = "a" + std::to_string(a) + (d < 0 ? "~" : "");
        else if (trig && r[a] < -24000) val = "a" + std::to_string(a);
        else val = std::string(d > 0 ? "+" : "-") + "a" + std::to_string(a);
        // un même axe ne sert qu'une fois pour les sticks ; pour un bouton, on garde le sens
        if (stick) { for (auto& u : used) if (u == "a" + std::to_string(a) || u == "a" + std::to_string(a) + "~") { val.clear(); break; } }
      } else continue;
      if (val.empty()) continue;
      if (v.phase == 1 && kSteps[v.step].axisOnly && val[0] != 'a') continue; // un stick, pas un bouton
      if (v.phase == 0) pad = who; else if (who != pad) continue;
      accept(val);
    }
    if (vj && frame % 6 == 0) { // script : appui, puis relâche
      static const char* seq[] = { "b0", "b0","b1","b2","b3", "h1","h4","h8","h2", "b4","b5", "t2","t5", "b6","b7","b8","b9", "p0","p1","n3","p4", "b10" };
      static int i = 0, ph = 0; int n = sizeof seq / sizeof *seq;
      if (i < n) {
        const char* c = seq[i]; int x = SDL_atoi(c + 1); bool down = ph == 0;
        if (c[0] == 'b') SDL_SetJoystickVirtualButton(vj, x, down);
        if (c[0] == 'h') SDL_SetJoystickVirtualHat(vj, 0, down ? x : 0);
        if (c[0] == 't') SDL_SetJoystickVirtualAxis(vj, x, down ? 32767 : -32768);
        if (c[0] == 'p') SDL_SetJoystickVirtualAxis(vj, x, down ? 32767 : 0);
        if (c[0] == 'n') SDL_SetJoystickVirtualAxis(vj, x, down ? -32768 : 0); // stick inversé
        ph ^= 1; if (ph == 0) i++;
      }
    }
    if (waitRelease && released()) waitRelease = false;
    if (v.phase == 2 && SDL_GetTicks() - doneAt > 1800) run = false;

    resetGlState(); xglViewport(0, 0, g_app.winW, g_app.winH); xglClearColor(.055f, .055f, .065f, 1); xglClear(GL_COLOR_BUFFER_BIT);
    uiCalib(v);
    frame++;
    if (!capture.empty() && frame == captureAt) captureScreen(capture);
    // tests : simule une manette inconnue qui passe toutes les étapes
    if (autoQuit && frame == 5 && !SDL_getenv("ARCADIA_CALIB_REAL") && !vj) { v.phase = 1; v.padName = "Manette générique USB"; setStep(SDL_atoi(arg("--step", "0").c_str())); }
    if (autoQuit && frame >= autoQuit) run = false;
    SDL_GL_SwapWindow(g_app.window);
  }
  if (v.phase == 3) emit("{\"event\":\"cancel\"}");
  uiShutdown(); SDL_GL_DestroyContext(g_app.gl); SDL_DestroyWindow(g_app.window); SDL_Quit();
  return 0;
}
