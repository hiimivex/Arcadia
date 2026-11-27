// État global du runner, partagé entre la boucle (main.cpp) et le menu (ui.cpp).
#pragma once
#include "core.h"
#include "gl.h"
#include <string>
#include <vector>
#include <deque>

struct Toast { std::string text; uint64_t until; };

struct SlotInfo { bool exists = false; std::string date; GLuint thumb = 0; int tw = 0, th = 0; int64_t mtime = 0; };

#include "arcadia_controls.h"

struct App {
  // Arguments
  std::string corePath, gamePath, title = "Jeu", console = "", gameKey = "jeu";
  std::string systemDir, savesDir, statesDir, shotsDir, configDir;
  bool windowed = false, autotest = false;
  int autotestFrames = 0;

  SDL_Window* window = nullptr;
  SDL_GLContext gl = nullptr;
  SDL_AudioStream* audio = nullptr;
  int winW = 1280, winH = 720;

  // Image du jeu
  GLuint gameFbo = 0, gameTex = 0, gameDepth = 0; int fboW = 0, fboH = 0;   // rendu matériel
  GLuint swFbo = 0, swTex = 0; int swW = 0, swH = 0;                          // rendu logiciel
  int frameW = 0, frameH = 0; bool frameIsHw = false, haveFrame = false;
  GLuint blurFbo[5] = {}, blurTex[5] = {}; int blurW[5] = {}, blurH[5] = {};
  GLuint thumbFbo = 0, thumbTex = 0;

  // Réglages (console, éventuellement remplacés par ceux du jeu)
  Config cfg; bool perGame = false;
  std::string cfgConsolePath, cfgGamePath;

  // État
  bool running = true, paused = false, menuOpen = false, resumePrompt = false;
  double speed = 1.0; int speedMode = 0; // 0 normal, 1 turbo, 2 ralenti
  bool rewinding = false, ffHeld = false; // rembobinage (R ou Guide + LT maintenus), avance rapide maintenue (Guide + RT)
  uint64_t startTicks = 0, playedNs = 0;
  float fps = 0; int fpsFrames = 0; uint64_t fpsT0 = 0;
  std::deque<Toast> toasts;
  SlotInfo slots[7]; // 0 = reprise auto, 1..6 = emplacements
  bool wantQuit = false;

  // Entrées
  SDL_Gamepad* pads[4] = {};
  // Remote Controller Gamepad (téléphone via Remote Gamepad / manette virtuelle) : pilote le joueur 1 au même titre que la manette principale
  SDL_Gamepad* padRemote = nullptr; bool p1Remote = false, remoteOn = false; // fusion désactivée : le téléphone est un joueur à part entière
  SDL_Gamepad* p1() const { return p1Remote && padRemote ? padRemote : pads[0]; }
  const char* padLabel(SDL_Gamepad* g) const {
    if (g && (g == padRemote || (SDL_GetGamepadVendor(g) == 0x045E && SDL_GetGamepadProduct(g) == 0x028E))) return "Remote Controller Gamepad";
    const char* n = g ? SDL_GetGamepadName(g) : nullptr; return n ? n : nullptr;
  }
  uint16_t padMask[4] = {}; int16_t padAxis[4][6] = {};
  bool guideHeld = false, guideUsed = false;
  // Contrôles réattribuables (fichier partagé avec Arcadia) ; capture d'une touche depuis le menu
  ArcadiaControls::Map controls; ArcadiaControls::Watcher ctlWatch;
  int capAction = -1; bool capKeyboard = true; uint64_t capT0 = 0;
  uint64_t comboT0 = 0;
  // Écran tactile / pointeur (souris, ou stick droit + clic du stick sur DS)
  int viewX = 0, viewY = 0, viewW = 1, viewH = 1;   // rectangle du jeu à l'écran (pixels)
  float ptrX = 0, ptrY = 0; bool ptrDown = false, ptrVirtual = false;
  float mouseDX = 0, mouseDY = 0; uint64_t lastMouseMove = 0;

  void toast(const std::string& t, int ms = 2200) {
    if (!toasts.empty() && toasts.back().text == t) { toasts.back().until = SDL_GetTicks() + ms; return; }
    toasts.push_back({t, SDL_GetTicks() + (uint64_t)ms});
    while (toasts.size() > 4) toasts.pop_front();
  }
  // Réglages
  void loadConfig();
  void saveConfig();
  void applyConfig();
  // Actions
  void openMenu(); void closeMenu();
  bool saveSlot(int slot, bool silent = false);
  int saveNow();            // prochain emplacement libre, sinon le plus ancien
  void openFolder(const std::string& dir);
  bool loadSlot(int slot);
  void refreshSlots();
  void screenshot();
  void setSpeed(int mode);
  void restart();
  void quit();
  void setVolume(int v);
  // Calibrage de la manette depuis le menu (lance « arcadia-runner --calibrate » à côté)
  std::string padDb, padLayout = "xbox";
  void calibrate();
  int calibState = 0; // 0 rien, 1 en cours
  uint64_t hintT0 = 0; bool hintOff = false; // aide « Contrôles » au début de la partie
};

extern App g_app;

// ui.cpp
void uiInit();
void uiFrame();          // dessine menu / toasts / overlay perfs
void uiShutdown();
bool uiWantsInput();

// Calibrage manette (calib.cpp) — vue passée à l'interface
struct CalibView {
  int phase = 0;            // 0 = attente « appuie sur A », 1 = étapes, 2 = terminé, 3 = annulé
  std::string padName, layout = "xbox";
  int step = 0, total = 0;
  const char* target = "";  // nom SDL du contrôle demandé (a, b, dpup, leftx…)
  std::string label, hint;
  bool known = false;
};
void uiCalib(const CalibView& v);
int runCalibration(int argc, char** argv);
void resetGlState();
void captureScreen(const std::string& path);
