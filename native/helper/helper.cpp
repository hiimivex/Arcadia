// arcadia-helper : petit compagnon natif d'Arcadia (Windows) pour les émulateurs externes.
//   Remplace les scripts PowerShell : plus rapide, et rien que les antivirus puissent prendre pour suspect.
//   Entrée (une commande par ligne, UTF-8) :
//     suspend <pid> | resume <pid> | front <pid> | watch <pid> (0 = aucun)
//     adopt <pid>\t<titre>\t<icône .ico>\t<AppUserModelID>   (attend la fenêtre, la renomme, met l'icône Arcadia, la regroupe avec Arcadia)
//     dsu on|off | prefer <guid SDL> | pads <gamecontrollerdb.txt>
//   Sortie : READY, DSU READY|BUSY, OK <cmd>, MENU, QUIT, NAV <touche>, KEY ESC (Échap quand le jeu surveillé est au premier plan)
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
#include <propsys.h>
// PKEY_AppUserModel_ID {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5
static const PROPERTYKEY kAumid = { { 0x9F4C2855, 0x9F79, 0x4B39, { 0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3 } }, 5 };
#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <algorithm>
#include <vector>
#define SDL_MAIN_HANDLED
#include <SDL3/SDL.h>
#include "dsu.h"

static std::mutex g_out;
static void say(const std::string& s) { std::lock_guard<std::mutex> l(g_out); fputs(s.c_str(), stdout); fputc('\n', stdout); fflush(stdout); }

typedef LONG(NTAPI* NtProc)(HANDLE);
static NtProc pSuspend = nullptr, pResume = nullptr;
static std::atomic<DWORD> g_watch{ 0 };
static HHOOK g_hook = nullptr;

static std::wstring W(const std::string& s) {
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
  std::wstring w(n, 0); MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n); return w;
}
static DWORD fgPid() { HWND w = GetForegroundWindow(); DWORD p = 0; if (w) GetWindowThreadProcessId(w, &p); return p; }

// Fenêtre principale d'un processus : visible, sans propriétaire
struct FindWin { DWORD pid; HWND hwnd; };
static BOOL CALLBACK enumProc(HWND h, LPARAM lp) {
  auto* f = (FindWin*)lp; DWORD p = 0; GetWindowThreadProcessId(h, &p);
  if (p == f->pid && IsWindowVisible(h) && !GetWindow(h, GW_OWNER)) { f->hwnd = h; return FALSE; }
  return TRUE;
}
static HWND mainWindow(DWORD pid) { FindWin f{ pid, nullptr }; EnumWindows(enumProc, (LPARAM)&f); return f.hwnd; }

// Windows refuse le premier plan à un processus d'arrière-plan : Alt simulé + rattachement au fil actif
static void front(HWND w) {
  if (!w) return;
  keybd_event(VK_MENU, 0, 0, 0); keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
  DWORD fg = GetWindowThreadProcessId(GetForegroundWindow(), nullptr), me = GetCurrentThreadId();
  if (fg && fg != me) AttachThreadInput(me, fg, TRUE);
  if (IsIconic(w)) ShowWindow(w, SW_RESTORE);
  BringWindowToTop(w); SetForegroundWindow(w); SetFocus(w);
  if (fg && fg != me) AttachThreadInput(me, fg, FALSE);
}
static void setIcon(HWND w, const std::wstring& ico) {
  if (!w || ico.empty()) return;
  HICON big = (HICON)LoadImageW(nullptr, ico.c_str(), IMAGE_ICON, 256, 256, LR_LOADFROMFILE);
  HICON small = (HICON)LoadImageW(nullptr, ico.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
  if (big) { SendMessageW(w, WM_SETICON, ICON_BIG, (LPARAM)big); SetClassLongPtrW(w, GCLP_HICON, (LONG_PTR)big); }
  if (small) { SendMessageW(w, WM_SETICON, ICON_SMALL, (LPARAM)small); SetClassLongPtrW(w, GCLP_HICONSM, (LONG_PTR)small); }
}
// Regroupe la fenêtre du jeu avec Arcadia dans la barre des tâches (même AppUserModelID)
static void setAumid(HWND w, const std::wstring& id) {
  if (!w || id.empty()) return;
  IPropertyStore* ps = nullptr;
  if (SUCCEEDED(SHGetPropertyStoreForWindow(w, IID_PPV_ARGS(&ps))) && ps) {
    PROPVARIANT v; PropVariantInit(&v);
    v.vt = VT_LPWSTR; v.pwszVal = (LPWSTR)CoTaskMemAlloc((id.size() + 1) * sizeof(wchar_t));
    if (v.pwszVal) { wcscpy(v.pwszVal, id.c_str()); ps->SetValue(kAumid, v); ps->Commit(); }
    PropVariantClear(&v); ps->Release();
  }
}

static void adopt(DWORD pid, std::wstring title, std::wstring ico, std::wstring aumid) {
  std::thread([=] {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    HWND w = nullptr;
    for (int i = 0; i < 240 && !w; i++) { // jusqu'à 60 s
      HANDLE h = OpenProcess(SYNCHRONIZE, FALSE, pid);
      if (!h) break;
      bool dead = WaitForSingleObject(h, 0) == WAIT_OBJECT_0; CloseHandle(h);
      if (dead) break;
      w = mainWindow(pid); if (!w) Sleep(250);
    }
    if (!w) { say("OK adopt 0"); CoUninitialize(); return; }
    Sleep(400);
    w = mainWindow(pid) ? mainWindow(pid) : w;
    setAumid(w, aumid);
    if (!title.empty()) SetWindowTextW(w, title.c_str());
    setIcon(w, ico);
    front(w);
    say("OK adopt 1");
    // certains émulateurs (Qt…) remettent leur icône un peu plus tard : on repasse derrière
    for (int ms : { 1500, 4000, 10000 }) {
      Sleep(ms);
      HWND w2 = mainWindow(pid); if (!w2) break;
      setIcon(w2, ico); setAumid(w2, aumid);
    }
    CoUninitialize();
  }).detach();
}

static void withProcess(DWORD pid, NtProc fn) {
  if (!fn) return;
  HANDLE h = OpenProcess(PROCESS_SUSPEND_RESUME, FALSE, pid);
  if (h) { fn(h); CloseHandle(h); }
}

// Clavier : Échap n'est intercepté que si le jeu surveillé est au premier plan
static LRESULT CALLBACK kbProc(int code, WPARAM wp, LPARAM lp) {
  if (code == HC_ACTION) {
    auto* k = (KBDLLHOOKSTRUCT*)lp;
    DWORD w = g_watch.load();
    static bool down = false;
    if (k->vkCode == VK_ESCAPE && w && fgPid() == w) {
      bool press = wp == WM_KEYDOWN || wp == WM_SYSKEYDOWN;
      if (press && !down) say("KEY ESC"); // pas de répétition automatique
      down = press;
      return 1;
    }
    if (k->vkCode == VK_ESCAPE && !(wp == WM_KEYDOWN || wp == WM_SYSKEYDOWN)) down = false;
  }
  return CallNextHookEx(g_hook, code, wp, lp);
}

// ───────── Manettes (SDL : toutes marques, calibrage Arcadia) + clavier → manette réseau DSU pour les moteurs Switch ─────────
static std::mutex g_stateM;
static dsu::State g_merged;              // manette + clavier fusionnés
static std::atomic<bool> g_dsuOn{ false };
static std::string g_prefer, g_padDb;     // GUID préféré, fichier de correspondances
static std::mutex g_cfgM; static bool g_cfgDirty = false;

static uint8_t axis8(Sint16 v) { return (uint8_t)std::clamp((v + 32768) / 257, 0, 255); }
static bool vkDown(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
static bool scDown(UINT sc) { UINT vk = MapVirtualKeyW(sc, MAPVK_VSC_TO_VK_EX); return vk && vkDown((int)vk); }

// Clavier → manette Switch (touches à la même PLACE quel que soit le clavier : AZERTY, QWERTY…)
static void keyboardState(dsu::State& s, bool& stickL, bool& stickR) {
  using namespace dsu;
  struct K { UINT sc; int vk; uint16_t bit; };
  const K keys[] = {
    { 0x26, 0, CIRCLE }, { 0x25, 0, CROSS }, { 0x17, 0, TRIANGLE }, { 0x24, 0, SQUARE },   // A=L B=K X=I Y=J (losange)
    { 0x10, 0, L1 }, { 0x12, 0, R1 }, { 0x02, 0, L2 }, { 0x04, 0, R2 },                      // L=Q R=E ZL=1 ZR=3
    { 0, VK_RETURN, OPTIONS }, { 0, VK_BACK, SHARE }, { 0, VK_LSHIFT, L3 }, { 0x30, 0, R3 }, // + − L3 R3
    { 0, VK_UP, UP }, { 0, VK_DOWN, DOWN }, { 0, VK_LEFT, LEFT }, { 0, VK_RIGHT, RIGHT } };
  for (auto& k : keys) if (k.vk ? vkDown(k.vk) : scDown(k.sc)) s.buttons |= k.bit;
  if (s.buttons & L2) s.l2 = 255;
  if (s.buttons & R2) s.r2 = 255;
  if (vkDown(VK_HOME)) s.home = true;
  int lx = (scDown(0x20) ? 1 : 0) - (scDown(0x1E) ? 1 : 0), ly = (scDown(0x11) ? 1 : 0) - (scDown(0x1F) ? 1 : 0); // W A S D
  int rx = (scDown(0x23) ? 1 : 0) - (scDown(0x21) ? 1 : 0), ry = (scDown(0x14) ? 1 : 0) - (scDown(0x22) ? 1 : 0); // T F G H
  stickL = lx || ly; stickR = rx || ry;
  if (stickL) { s.lx = (uint8_t)(128 + lx * 127); s.ly = (uint8_t)(128 + ly * 127); }
  if (stickR) { s.rx = (uint8_t)(128 + rx * 127); s.ry = (uint8_t)(128 + ry * 127); }
}

static void padLoop() {
  SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
  if (!SDL_Init(SDL_INIT_GAMEPAD)) { say("PADS KO"); return; }
  SDL_Gamepad* pad = nullptr;
  int held = 0, rep = 0; bool guide = false; uint32_t nav = 0;
  const struct { uint32_t bit; const char* name; } keys[] = { { 1, "up" }, { 2, "down" }, { 4, "left" }, { 8, "right" }, { 16, "a" }, { 32, "b" }, { 64, "lb" }, { 128, "rb" } };
  for (;;) {
    { std::lock_guard<std::mutex> l(g_cfgM);
      if (g_cfgDirty) { g_cfgDirty = false; if (!g_padDb.empty()) SDL_AddGamepadMappingsFromFile(g_padDb.c_str()); if (pad) { SDL_CloseGamepad(pad); pad = nullptr; } } }
    SDL_PumpEvents(); SDL_UpdateGamepads();
    SDL_Event e; while (SDL_PollEvent(&e)) if (e.type == SDL_EVENT_GAMEPAD_REMOVED && pad && SDL_GetGamepadID(pad) == e.gdevice.which) { SDL_CloseGamepad(pad); pad = nullptr; }
    if (!pad || !SDL_GamepadConnected(pad)) { // manette préférée (choisie dans Arcadia), sinon la première
      if (pad) { SDL_CloseGamepad(pad); pad = nullptr; }
      int n = 0; SDL_JoystickID* ids = SDL_GetGamepads(&n); SDL_JoystickID pick = n ? ids[0] : 0;
      std::string pref; { std::lock_guard<std::mutex> l(g_cfgM); pref = g_prefer; }
      for (int i = 0; i < n && !pref.empty(); i++) { char gb[64]; SDL_GUIDToString(SDL_GetJoystickGUIDForID(ids[i]), gb, sizeof gb); if (pref == gb) pick = ids[i]; }
      if (pick) pad = SDL_OpenGamepad(pick);
      SDL_free(ids);
    }
    dsu::State s;
    uint32_t navNow = 0;
    if (pad) {
      using namespace dsu;
      auto B = [&](SDL_GamepadButton b) { return SDL_GetGamepadButton(pad, b); };
      // par position : bas = B Switch (croix), droite = A (rond), gauche = Y (carré), haut = X (triangle)
      if (B(SDL_GAMEPAD_BUTTON_SOUTH)) s.buttons |= CROSS; if (B(SDL_GAMEPAD_BUTTON_EAST)) s.buttons |= CIRCLE;
      if (B(SDL_GAMEPAD_BUTTON_WEST)) s.buttons |= SQUARE; if (B(SDL_GAMEPAD_BUTTON_NORTH)) s.buttons |= TRIANGLE;
      if (B(SDL_GAMEPAD_BUTTON_LEFT_SHOULDER)) s.buttons |= L1; if (B(SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER)) s.buttons |= R1;
      if (B(SDL_GAMEPAD_BUTTON_BACK)) s.buttons |= SHARE; if (B(SDL_GAMEPAD_BUTTON_START)) s.buttons |= OPTIONS;
      if (B(SDL_GAMEPAD_BUTTON_LEFT_STICK)) s.buttons |= L3; if (B(SDL_GAMEPAD_BUTTON_RIGHT_STICK)) s.buttons |= R3;
      if (B(SDL_GAMEPAD_BUTTON_DPAD_UP)) s.buttons |= UP; if (B(SDL_GAMEPAD_BUTTON_DPAD_DOWN)) s.buttons |= DOWN;
      if (B(SDL_GAMEPAD_BUTTON_DPAD_LEFT)) s.buttons |= LEFT; if (B(SDL_GAMEPAD_BUTTON_DPAD_RIGHT)) s.buttons |= RIGHT;
      Sint16 lt = SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_LEFT_TRIGGER), rt = SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER);
      s.l2 = (uint8_t)std::clamp(lt / 128, 0, 255); s.r2 = (uint8_t)std::clamp(rt / 128, 0, 255);
      if (lt > 9000) s.buttons |= L2; if (rt > 9000) s.buttons |= R2;
      s.lx = axis8(SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_LEFTX)); s.ly = 255 - axis8(SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_LEFTY));
      s.rx = axis8(SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_RIGHTX)); s.ry = 255 - axis8(SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_RIGHTY));
      // menu Arcadia : Guide, ou Back+Start bref ; Back+Start 1,5 s = quitter
      bool g = B(SDL_GAMEPAD_BUTTON_GUIDE); if (guide && !g) say("MENU"); guide = g;
      if (B(SDL_GAMEPAD_BUTTON_BACK) && B(SDL_GAMEPAD_BUTTON_START)) { if (held >= 0) { held += 8; if (held >= 1500) { say("QUIT"); held = -1; } } }
      else { if (held > 0 && held < 1500) say("MENU"); held = 0; }
      // navigation du menu Arcadia
      if (B(SDL_GAMEPAD_BUTTON_DPAD_UP) || s.ly > 200) navNow |= 1; if (B(SDL_GAMEPAD_BUTTON_DPAD_DOWN) || s.ly < 56) navNow |= 2;
      if (B(SDL_GAMEPAD_BUTTON_DPAD_LEFT) || s.lx < 56) navNow |= 4; if (B(SDL_GAMEPAD_BUTTON_DPAD_RIGHT) || s.lx > 200) navNow |= 8;
      if (B(SDL_GAMEPAD_BUTTON_SOUTH)) navNow |= 16; if (B(SDL_GAMEPAD_BUTTON_EAST)) navNow |= 32;
      if (B(SDL_GAMEPAD_BUTTON_LEFT_SHOULDER)) navNow |= 64; if (B(SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER)) navNow |= 128;
    }
    uint32_t fresh = navNow & ~nav, dirs = navNow & 15;
    if (dirs && dirs == (nav & 15)) { rep += 8; if (rep >= 400) { fresh |= dirs; rep = 300; } } else rep = 0;
    for (auto& k : keys) if (fresh & k.bit) say(std::string("NAV ") + k.name);
    nav = navNow;
    // clavier : seulement quand le jeu surveillé est au premier plan
    DWORD w = g_watch.load();
    if (w && fgPid() == w) { dsu::State k; bool sl = false, sr = false; keyboardState(k, sl, sr); s.buttons |= k.buttons; s.home = s.home || k.home;
      if (sl) { s.lx = k.lx; s.ly = k.ly; } if (sr) { s.rx = k.rx; s.ry = k.ry; } s.l2 = std::max(s.l2, k.l2); s.r2 = std::max(s.r2, k.r2); }
    { std::lock_guard<std::mutex> l(g_stateM); g_merged = s; }
    Sleep(8);
  }
}

// Serveur DSU sur 127.0.0.1:26760 : répond aux moteurs (version, emplacements) et leur envoie la manette fusionnée
static void dsuLoop() {
  WSADATA wd; WSAStartup(MAKEWORD(2, 2), &wd);
  SOCKET so = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(26760); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (so == INVALID_SOCKET || bind(so, (sockaddr*)&a, sizeof a) != 0) { say("DSU BUSY"); return; }
  say("DSU READY");
  u_long nb = 1; ioctlsocket(so, FIONBIO, &nb);
  const uint32_t id = GetTickCount() ^ 0xA2CAD1A0;
  struct Client { sockaddr_in addr; ULONGLONG last; };
  std::vector<Client> clients; uint32_t counter = 0;
  ULONGLONG t0 = GetTickCount64(), next = 0;
  for (;;) {
    uint8_t buf[128]; sockaddr_in from{}; int fl = sizeof from;
    int n;
    while ((n = recvfrom(so, (char*)buf, sizeof buf, 0, (sockaddr*)&from, &fl)) >= 20) {
      uint32_t magic = buf[0] | buf[1] << 8 | buf[2] << 16 | (uint32_t)buf[3] << 24, type = buf[16] | buf[17] << 8 | buf[18] << 16 | (uint32_t)buf[19] << 24;
      if (magic != dsu::CLIENT_MAGIC) continue;
      auto send = [&](const std::vector<uint8_t>& m) { sendto(so, (const char*)m.data(), (int)m.size(), 0, (sockaddr*)&from, sizeof from); };
      if (type == dsu::T_VERSION) send(dsu::versionMsg(id));
      else if (type == dsu::T_PORTINFO && n >= 24) {
        uint32_t cnt = std::min<uint32_t>(buf[20] | buf[21] << 8, 4);
        for (uint32_t i = 0; i < cnt && 24 + i < (uint32_t)n; i++) send(dsu::portInfoMsg(id, buf[24 + i], buf[24 + i] == 0 && g_dsuOn));
      } else if (type == dsu::T_PADDATA) {
        bool found = false;
        for (auto& c : clients) if (c.addr.sin_port == from.sin_port && c.addr.sin_addr.s_addr == from.sin_addr.s_addr) { c.last = GetTickCount64(); found = true; }
        if (!found) clients.push_back({ from, GetTickCount64() });
      }
      fl = sizeof from;
    }
    ULONGLONG now = GetTickCount64();
    clients.erase(std::remove_if(clients.begin(), clients.end(), [&](const Client& c) { return now - c.last > 6000; }), clients.end());
    if (g_dsuOn && now >= next && !clients.empty()) {
      next = now + 8; // ~125 Hz
      dsu::State s; { std::lock_guard<std::mutex> l(g_stateM); s = g_merged; }
      auto m = dsu::padDataMsg(id, 0, s, ++counter, (uint64_t)(now - t0) * 1000);
      for (auto& c : clients) sendto(so, (const char*)m.data(), (int)m.size(), 0, (sockaddr*)&c.addr, sizeof c.addr);
    }
    Sleep(2);
  }
}

int main() {
  HMODULE nt = GetModuleHandleW(L"ntdll.dll");
  pSuspend = (NtProc)GetProcAddress(nt, "NtSuspendProcess"); pResume = (NtProc)GetProcAddress(nt, "NtResumeProcess");
  std::thread(padLoop).detach();
  std::thread(dsuLoop).detach();
  std::thread([] { // crochet clavier : nécessite une boucle de messages
    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, kbProc, GetModuleHandleW(nullptr), 0);
    MSG m; while (GetMessageW(&m, nullptr, 0, 0) > 0) { TranslateMessage(&m); DispatchMessageW(&m); }
  }).detach();
  say("READY");
  char line[4096];
  while (fgets(line, sizeof line, stdin)) {
    std::string s(line); while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
    size_t sp = s.find(' '); std::string cmd = s.substr(0, sp), rest = sp == std::string::npos ? "" : s.substr(sp + 1);
    DWORD pid = (DWORD)strtoul(rest.c_str(), nullptr, 10);
    if (cmd == "suspend") { withProcess(pid, pSuspend); say("OK suspend"); }
    else if (cmd == "resume") { withProcess(pid, pResume); say("OK resume"); }
    else if (cmd == "front") { front(mainWindow(pid)); say("OK front"); }
    else if (cmd == "watch") { g_watch = pid; say("OK watch"); }
    else if (cmd == "dsu") { g_dsuOn = rest == "on"; say("OK dsu"); }
    else if (cmd == "prefer") { std::lock_guard<std::mutex> l(g_cfgM); g_prefer = rest; g_cfgDirty = true; say("OK prefer"); }
    else if (cmd == "pads") { std::lock_guard<std::mutex> l(g_cfgM); g_padDb = rest; g_cfgDirty = true; say("OK pads"); }
    else if (cmd == "adopt") {
      std::string f[4]; size_t a = 0; int i = 0;
      while (i < 4) { size_t t = rest.find('\t', a); f[i++] = rest.substr(a, t == std::string::npos ? std::string::npos : t - a); if (t == std::string::npos) break; a = t + 1; }
      adopt((DWORD)strtoul(f[0].c_str(), nullptr, 10), W(f[1]), W(f[2]), W(f[3]));
    }
    else if (cmd == "quit") break;
  }
  return 0;
}
