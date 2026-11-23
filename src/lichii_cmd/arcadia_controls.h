// Contrôles Arcadia : fichier partagé par le moteur intégré et le moteur Switch (écrit aussi par Arcadia).
//   device=both|keyboard|pad|stick
//   kb.<action>=<codes de touche SDL>   pad.<action>=<boutons SDL : south,east,…,lt,rt>
#pragma once
#include <SDL3/SDL.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace ArcadiaControls {

enum Action { A, B, X, Y, L, R, ZL, ZR, PLUS, MINUS, L3, R3, UP, DOWN, LEFT, RIGHT, HOME,
  LS_UP, LS_DOWN, LS_LEFT, LS_RIGHT, RS_UP, RS_DOWN, RS_LEFT, RS_RIGHT, COUNT };
inline const char* const kActionNames[COUNT] = { "a", "b", "x", "y", "l", "r", "zl", "zr", "plus", "minus", "l3", "r3",
  "up", "down", "left", "right", "home", "ls_up", "ls_down", "ls_left", "ls_right", "rs_up", "rs_down", "rs_left", "rs_right" };
enum Device { BOTH, KEYBOARD, PAD, STICK };
inline const char* const kDeviceNames[4] = { "both", "keyboard", "pad", "stick" };

// Boutons de manette : boutons SDL, plus les gâchettes analogiques vues comme des boutons
constexpr int PAD_LT = 100, PAD_RT = 101;
struct PadName { const char* name; int code; };
inline const PadName kPadNames[] = {
  { "south", SDL_GAMEPAD_BUTTON_SOUTH }, { "east", SDL_GAMEPAD_BUTTON_EAST }, { "west", SDL_GAMEPAD_BUTTON_WEST },
  { "north", SDL_GAMEPAD_BUTTON_NORTH }, { "back", SDL_GAMEPAD_BUTTON_BACK }, { "guide", SDL_GAMEPAD_BUTTON_GUIDE },
  { "start", SDL_GAMEPAD_BUTTON_START }, { "ls", SDL_GAMEPAD_BUTTON_LEFT_STICK }, { "rs", SDL_GAMEPAD_BUTTON_RIGHT_STICK },
  { "lb", SDL_GAMEPAD_BUTTON_LEFT_SHOULDER }, { "rb", SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER }, { "up", SDL_GAMEPAD_BUTTON_DPAD_UP },
  { "down", SDL_GAMEPAD_BUTTON_DPAD_DOWN }, { "left", SDL_GAMEPAD_BUTTON_DPAD_LEFT }, { "right", SDL_GAMEPAD_BUTTON_DPAD_RIGHT },
  { "misc1", SDL_GAMEPAD_BUTTON_MISC1 }, { "lt", PAD_LT }, { "rt", PAD_RT } };

inline const char* PadNameOf(int code) {
  for (auto& p : kPadNames) if (p.code == code) return p.name;
  return nullptr;
}
inline int PadCodeOf(const std::string& n) {
  for (auto& p : kPadNames) if (n == p.name) return p.code;
  return -1;
}

struct Map {
  Device device = BOTH;
  std::vector<int> kb[COUNT];
  std::vector<int> pad[COUNT];
  bool loaded = false;
};

inline std::vector<std::string> SplitList(const std::string& v) {
  std::vector<std::string> out; std::string cur;
  for (char c : v) { if (c == ',') { if (!cur.empty()) out.push_back(cur); cur.clear(); } else if (c != ' ' && c != '\r') cur += c; }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

inline bool Load(const std::string& path, Map& m) {
  size_t size = 0;
  char* data = path.empty() ? nullptr : (char*)SDL_LoadFile(path.c_str(), &size);
  if (!data) return false;
  Map n;
  std::string text(data, size); SDL_free(data);
  size_t pos = 0;
  while (pos < text.size()) {
    size_t e = text.find('\n', pos); if (e == std::string::npos) e = text.size();
    std::string line = text.substr(pos, e - pos); pos = e + 1;
    size_t eq = line.find('='); if (eq == std::string::npos || line[0] == '#') continue;
    std::string k = line.substr(0, eq), v = line.substr(eq + 1);
    while (!v.empty() && (v.back() == '\r' || v.back() == ' ')) v.pop_back();
    if (k == "device") { for (int i = 0; i < 4; i++) if (v == kDeviceNames[i]) n.device = (Device)i; continue; }
    size_t dot = k.find('.'); if (dot == std::string::npos) continue;
    std::string kind = k.substr(0, dot), act = k.substr(dot + 1);
    int a = -1; for (int i = 0; i < COUNT; i++) if (act == kActionNames[i]) a = i;
    if (a < 0) continue;
    for (auto& t : SplitList(v)) {
      if (kind == "kb") { int sc = std::atoi(t.c_str()); if (sc > 0 && sc < SDL_SCANCODE_COUNT) n.kb[a].push_back(sc); }
      else if (kind == "pad") { int c = PadCodeOf(t); if (c >= 0) n.pad[a].push_back(c); }
    }
  }
  n.loaded = true; m = n;
  return true;
}

inline bool Save(const std::string& path, const Map& m) {
  std::string s = "# Contrôles Arcadia\ndevice=" + std::string(kDeviceNames[m.device]) + "\n";
  for (int i = 0; i < COUNT; i++) { s += std::string("kb.") + kActionNames[i] + "="; for (size_t j = 0; j < m.kb[i].size(); j++) s += (j ? "," : "") + std::to_string(m.kb[i][j]); s += "\n"; }
  for (int i = 0; i < COUNT; i++) { s += std::string("pad.") + kActionNames[i] + "="; for (size_t j = 0; j < m.pad[i].size(); j++) { const char* n = PadNameOf(m.pad[i][j]); if (n) s += std::string(j ? "," : "") + n; } s += "\n"; }
  return SDL_SaveFile(path.c_str(), s.data(), s.size());
}

// Réglages d'origine (identiques à src/controls.js d'Arcadia)
inline Map Defaults(bool switchLayout) {
  Map m; m.loaded = true;
  auto P = [&](int a, int c) { m.pad[a] = { c }; };
  P(A, SDL_GAMEPAD_BUTTON_EAST); P(B, SDL_GAMEPAD_BUTTON_SOUTH); P(X, SDL_GAMEPAD_BUTTON_NORTH); P(Y, SDL_GAMEPAD_BUTTON_WEST);
  P(L, SDL_GAMEPAD_BUTTON_LEFT_SHOULDER); P(R, SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER); P(ZL, PAD_LT); P(ZR, PAD_RT);
  P(PLUS, SDL_GAMEPAD_BUTTON_START); P(MINUS, SDL_GAMEPAD_BUTTON_BACK); P(L3, SDL_GAMEPAD_BUTTON_LEFT_STICK); P(R3, SDL_GAMEPAD_BUTTON_RIGHT_STICK);
  P(UP, SDL_GAMEPAD_BUTTON_DPAD_UP); P(DOWN, SDL_GAMEPAD_BUTTON_DPAD_DOWN); P(LEFT, SDL_GAMEPAD_BUTTON_DPAD_LEFT); P(RIGHT, SDL_GAMEPAD_BUTTON_DPAD_RIGHT);
  auto K = [&](int a, std::vector<int> v) { m.kb[a] = v; };
  K(UP, { SDL_SCANCODE_UP }); K(DOWN, { SDL_SCANCODE_DOWN }); K(LEFT, { SDL_SCANCODE_LEFT }); K(RIGHT, { SDL_SCANCODE_RIGHT });
  K(ZL, { SDL_SCANCODE_1 }); K(ZR, { SDL_SCANCODE_3 }); K(PLUS, { SDL_SCANCODE_RETURN });
  if (switchLayout) {
    K(A, { SDL_SCANCODE_L }); K(B, { SDL_SCANCODE_K }); K(X, { SDL_SCANCODE_I }); K(Y, { SDL_SCANCODE_J });
    K(L, { SDL_SCANCODE_Q }); K(R, { SDL_SCANCODE_E }); K(MINUS, { SDL_SCANCODE_BACKSPACE }); K(L3, { SDL_SCANCODE_LSHIFT }); K(R3, { SDL_SCANCODE_B });
    K(HOME, { SDL_SCANCODE_HOME }); K(LS_UP, { SDL_SCANCODE_W }); K(LS_DOWN, { SDL_SCANCODE_S }); K(LS_LEFT, { SDL_SCANCODE_A }); K(LS_RIGHT, { SDL_SCANCODE_D });
    K(RS_UP, { SDL_SCANCODE_T }); K(RS_DOWN, { SDL_SCANCODE_G }); K(RS_LEFT, { SDL_SCANCODE_F }); K(RS_RIGHT, { SDL_SCANCODE_H });
  } else {
    K(A, { SDL_SCANCODE_X }); K(B, { SDL_SCANCODE_Z }); K(X, { SDL_SCANCODE_S }); K(Y, { SDL_SCANCODE_A });
    K(L, { SDL_SCANCODE_Q }); K(R, { SDL_SCANCODE_W }); K(MINUS, { SDL_SCANCODE_RSHIFT, SDL_SCANCODE_BACKSPACE });
  }
  return m;
}

// Une touche ou un bouton ne sert qu'à une seule action
inline void Assign(Map& m, bool keyboard, int action, int code) {
  auto* lists = keyboard ? m.kb : m.pad;
  for (int i = 0; i < COUNT; i++) { auto& l = lists[i]; for (size_t j = 0; j < l.size();) { if (l[j] == code) l.erase(l.begin() + j); else j++; } }
  lists[action] = { code };
}

// Le fichier a-t-il changé (menu Arcadia, autre moteur) ? Vérifié au plus une fois par seconde.
struct Watcher {
  std::string path; SDL_Time mtime = 0; Uint64 lastCheck = 0;
  bool Changed() {
    if (path.empty()) return false;
    Uint64 now = SDL_GetTicks(); if (now - lastCheck < 1000) return false; lastCheck = now;
    SDL_PathInfo info; if (!SDL_GetPathInfo(path.c_str(), &info)) return false;
    if (info.modify_time == mtime) return false;
    mtime = info.modify_time; return true;
  }
  void Touch() { SDL_PathInfo info; if (!path.empty() && SDL_GetPathInfo(path.c_str(), &info)) mtime = info.modify_time; }
};

inline bool PadDown(SDL_Gamepad* g, int code) {
  if (!g) return false;
  if (code == PAD_LT) return SDL_GetGamepadAxis(g, SDL_GAMEPAD_AXIS_LEFT_TRIGGER) > 12000;
  if (code == PAD_RT) return SDL_GetGamepadAxis(g, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER) > 12000;
  return SDL_GetGamepadButton(g, (SDL_GamepadButton)code);
}
inline bool KeyDown(const bool* k, int n, int sc) { return k && sc >= 0 && sc < n && k[sc]; }

inline bool Pressed(const Map& m, int action, SDL_Gamepad* g, const bool* keys, int nkeys) {
  const bool usePad = m.device != KEYBOARD, useKb = m.device != PAD && m.device != STICK;
  if (usePad) for (int c : m.pad[action]) if (PadDown(g, c)) return true;
  if (useKb) for (int sc : m.kb[action]) if (KeyDown(keys, nkeys, sc)) return true;
  return false;
}

// Nom affiché d'une touche (lettres de TON clavier) ou d'un bouton
inline std::string KeyLabel(int sc) {
  const char* n = SDL_GetKeyName(SDL_GetKeyFromScancode((SDL_Scancode)sc, SDL_KMOD_NONE, false));
  return n && *n ? n : "?";
}
inline std::string PadLabel(int code) {
  switch (code) {
  case SDL_GAMEPAD_BUTTON_SOUTH: return "Bas (A Xbox)"; case SDL_GAMEPAD_BUTTON_EAST: return "Droite (B Xbox)";
  case SDL_GAMEPAD_BUTTON_WEST: return "Gauche (X Xbox)"; case SDL_GAMEPAD_BUTTON_NORTH: return "Haut (Y Xbox)";
  case SDL_GAMEPAD_BUTTON_BACK: return "Back"; case SDL_GAMEPAD_BUTTON_START: return "Start"; case SDL_GAMEPAD_BUTTON_GUIDE: return "Guide";
  case SDL_GAMEPAD_BUTTON_LEFT_STICK: return "Clic stick G"; case SDL_GAMEPAD_BUTTON_RIGHT_STICK: return "Clic stick D";
  case SDL_GAMEPAD_BUTTON_LEFT_SHOULDER: return "LB"; case SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER: return "RB";
  case SDL_GAMEPAD_BUTTON_DPAD_UP: return "Croix \xE2\x86\x91"; case SDL_GAMEPAD_BUTTON_DPAD_DOWN: return "Croix \xE2\x86\x93";
  case SDL_GAMEPAD_BUTTON_DPAD_LEFT: return "Croix \xE2\x86\x90"; case SDL_GAMEPAD_BUTTON_DPAD_RIGHT: return "Croix \xE2\x86\x92";
  case SDL_GAMEPAD_BUTTON_MISC1: return "Partage"; case PAD_LT: return "LT"; case PAD_RT: return "RT";
  default: return "?";
  }
}

} // namespace ArcadiaControls
