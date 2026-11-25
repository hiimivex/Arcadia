// SPDX-License-Identifier: GPL-3.0-or-later
// Arcadia : manette(s) + clavier fusionnés en une manette virtuelle (joueur 1), vibrations vers la vraie manette.

#include "lichii_cmd/arcadia.h"
#include "lichii_cmd/arcadia_controls.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <mutex>

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#endif

#include "common/logging.h"
#include "common/settings.h"
#include "input_common/drivers/virtual_gamepad.h"
#include "input_common/main.h"

namespace Arcadia {
namespace {

using VB = InputCommon::VirtualGamepad::VirtualButton;
using VS = InputCommon::VirtualGamepad::VirtualStick;

InputCommon::VirtualGamepad* g_pad = nullptr;
SDL_Window* g_window = nullptr;
SDL_Gamepad* g_gamepad = nullptr;
std::mutex g_gamepad_mutex;
Uint64 g_last_poll = 0;
ArcadiaControls::Map g_map;          // touches réattribuées dans Arcadia (fichier partagé, relu s'il change)
ArcadiaControls::Watcher g_watch;
Uint64 g_last_scan = 0;

// Mode 2 joueurs / 2 écrans : clavier lu même quand la fenêtre n'est pas devant (ARCADIA_KB_GLOBAL=1)
bool g_kb_global = false;
bool g_kb_state[SDL_SCANCODE_COUNT]{};

#ifdef _WIN32
// Scancode SDL (USB HID) -> code clavier Windows (jeu 1, 0xE0xx = touche étendue) ; pavé numérique : VK direct (0x1xx)
int HidToWin(int sc) {
    static const unsigned short letters[26] = {0x1E,0x30,0x2E,0x20,0x12,0x21,0x22,0x23,0x17,0x24,0x25,0x26,0x32,
                                               0x31,0x18,0x19,0x10,0x13,0x1F,0x14,0x16,0x2F,0x11,0x2D,0x15,0x2C};
    if (sc >= 4 && sc <= 29) return letters[sc - 4];
    if (sc >= 30 && sc <= 39) return 0x02 + (sc - 30);
    if (sc >= 58 && sc <= 67) return 0x3B + (sc - 58);
    if (sc >= 89 && sc <= 97) return 0x100 | (VK_NUMPAD1 + (sc - 89));
    switch (sc) {
    case 40: return 0x1C; case 41: return 0x01; case 42: return 0x0E; case 43: return 0x0F; case 44: return 0x39;
    case 45: return 0x0C; case 46: return 0x0D; case 47: return 0x1A; case 48: return 0x1B; case 49: return 0x2B;
    case 51: return 0x27; case 52: return 0x28; case 53: return 0x29; case 54: return 0x33; case 55: return 0x34;
    case 56: return 0x35; case 57: return 0x3A; case 68: return 0x57; case 69: return 0x58;
    case 79: return 0xE04D; case 80: return 0xE04B; case 81: return 0xE050; case 82: return 0xE048;
    case 84: return 0x100 | VK_DIVIDE; case 85: return 0x100 | VK_MULTIPLY; case 86: return 0x100 | VK_SUBTRACT;
    case 87: return 0x100 | VK_ADD; case 88: return 0xE01C; case 98: return 0x100 | VK_NUMPAD0; case 99: return 0x100 | VK_DECIMAL;
    case 224: return 0x1D; case 225: return 0x2A; case 226: return 0x38; case 228: return 0xE01D; case 229: return 0x36;
    case 230: return 0xE038;
    default: return 0;
    }
}

void ReadGlobalKeyboard() {
    for (int sc = 0; sc < SDL_SCANCODE_COUNT; sc++) {
        const int w = HidToWin(sc);
        if (!w) { g_kb_state[sc] = false; continue; }
        const UINT vk = (w & 0x100) && w < 0x200 ? (w & 0xFF) : MapVirtualKeyW(w, MAPVK_VSC_TO_VK_EX);
        g_kb_state[sc] = vk && (GetAsyncKeyState(int(vk)) & 0x8000);
    }
}
#else
void ReadGlobalKeyboard() {}
#endif

// Place la fenêtre sur l'écran demandé (ARCADIA_DISPLAY = left | right | numéro) puis plein écran
void PlaceOnDisplay(SDL_Window* window, const char* which) {
    int n = 0;
    SDL_DisplayID* ids = SDL_GetDisplays(&n);
    if (!ids || n == 0) { SDL_free(ids); return; }
    std::sort(ids, ids + n, [](SDL_DisplayID a, SDL_DisplayID b) {
        SDL_Rect ra{}, rb{};
        SDL_GetDisplayBounds(a, &ra);
        SDL_GetDisplayBounds(b, &rb);
        return ra.x != rb.x ? ra.x < rb.x : ra.y < rb.y;
    });
    int idx = 0;
    if (SDL_strcasecmp(which, "right") == 0) idx = n - 1;
    else if (SDL_strcasecmp(which, "left") != 0) idx = std::clamp(std::atoi(which), 0, n - 1);
    SDL_Rect r{};
    if (SDL_GetDisplayBounds(ids[idx], &r)) {
        SDL_SetWindowFullscreen(window, false);
        SDL_SetWindowFullscreenMode(window, nullptr); // plein écran fenêtré sans bordure, sur cet écran
        SDL_SetWindowPosition(window, r.x + r.w / 4, r.y + r.h / 4);
        SDL_SyncWindow(window);
        SDL_SetWindowFullscreen(window, true);
        LOG_INFO(Frontend, "Arcadia: fenêtre sur l'écran {} ({}x{} à {},{})", idx, r.w, r.h, r.x, r.y);
    }
    SDL_free(ids);
}

// Vibrations : la Switch envoie gauche et droite séparément ; on garde la plus forte des deux récentes
float g_low[2]{}, g_high[2]{};
Uint64 g_vib_at[2]{};

const char* Env(const char* name) {
    const char* v = SDL_getenv(name); // UTF-8 (accents dans les chemins et les titres)
    return v && *v ? v : nullptr;
}

std::string JsonEscape(const std::string& s) {
    std::string out;
    for (char c : s) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += c;
        } else if (static_cast<unsigned char>(c) < 0x20) {
            out += ' ';
        } else {
            out += c;
        }
    }
    return out;
}

// Choisit la manette : celle demandée par Arcadia (ARCADIA_PAD_GUID), sinon la première branchée
void OpenGamepad() {
    std::scoped_lock lk{g_gamepad_mutex};
    if (g_gamepad && SDL_GamepadConnected(g_gamepad)) {
        return;
    }
    if (g_gamepad) {
        SDL_CloseGamepad(g_gamepad);
        g_gamepad = nullptr;
    }
    int count = 0;
    SDL_JoystickID* ids = SDL_GetGamepads(&count);
    if (!ids) {
        return;
    }
    const char* wanted = Env("ARCADIA_PAD_GUID");
    // ARCADIA_PAD_SLOT : n-ième manette branchée (joueur 2 = 1) ; pas de repli sur la manette d'un autre joueur
    const char* slotEnv = Env("ARCADIA_PAD_SLOT");
    const int slot = slotEnv ? std::max(0, std::atoi(slotEnv)) : 0;
    SDL_JoystickID pick = count > slot ? ids[slot] : 0;
    if (wanted) {
        for (int i = 0; i < count; i++) {
            char guid[64]{};
            SDL_GUIDToString(SDL_GetGamepadGUIDForID(ids[i]), guid, sizeof(guid));
            if (SDL_strcasecmp(guid, wanted) == 0) {
                pick = ids[i];
                break;
            }
        }
    }
    if (pick) {
        g_gamepad = SDL_OpenGamepad(pick);
        if (g_gamepad) {
            const char* name = SDL_GetGamepadName(g_gamepad);
            char guid[64]{};
            SDL_GUIDToString(SDL_GetGamepadGUIDForID(pick), guid, sizeof(guid));
            Emit(std::string{"{\"event\":\"pad\",\"name\":\""} + JsonEscape(name ? name : "") +
                 "\",\"guid\":\"" + guid + "\"}");
        }
    }
    SDL_free(ids);
}

void OnVibration(std::size_t port, const Common::Input::VibrationStatus& v) {
    if (port != 0) {
        return;
    }
    // L'appel alterne gauche / droite : on les distingue par l'ordre d'arrivée
    static std::atomic<int> side{0};
    const int s = side.fetch_xor(1) & 1;
    const Uint64 now = SDL_GetTicks();
    g_low[s] = v.low_amplitude;
    g_high[s] = v.high_amplitude;
    g_vib_at[s] = now;
    float low = 0.f, high = 0.f;
    for (int i = 0; i < 2; i++) {
        if (now - g_vib_at[i] < 120) {
            low = (std::max)(low, g_low[i]);
            high = (std::max)(high, g_high[i]);
        }
    }
    std::scoped_lock lk{g_gamepad_mutex};
    if (g_gamepad) {
        SDL_RumbleGamepad(g_gamepad, static_cast<Uint16>(std::clamp(low, 0.f, 1.f) * 0xFFFF),
                          static_cast<Uint16>(std::clamp(high, 0.f, 1.f) * 0xFFFF), 250);
    }
}

float Axis(SDL_Gamepad* p, SDL_GamepadAxis a) {
    return p ? SDL_GetGamepadAxis(p, a) / 32767.0f : 0.f;
}

bool Btn(SDL_Gamepad* p, SDL_GamepadButton b) {
    return p && SDL_GetGamepadButton(p, b);
}

#ifdef _WIN32
// Module contenant une adresse : nom + décalage (résolu ensuite avec les symboles de la compilation)
void DescribeAddress(FILE* f, const char* label, DWORD64 addr) {
    HMODULE mod = nullptr;
    char name[MAX_PATH] = "?";
    if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           reinterpret_cast<LPCSTR>(addr), &mod) && mod) {
        GetModuleFileNameA(mod, name, MAX_PATH);
        const char* base = std::strrchr(name, '\\');
        std::fprintf(f, "%s 0x%016llx  %s+0x%llx\n", label, static_cast<unsigned long long>(addr), base ? base + 1 : name,
                     static_cast<unsigned long long>(addr - reinterpret_cast<DWORD64>(mod)));
    } else if (label[0] == 'p') {
        std::fprintf(f, "%s 0x%016llx  (hors module)\n", label, static_cast<unsigned long long>(addr));
    }
}

LONG WINAPI OnCrash(EXCEPTION_POINTERS* ep) {
    const DWORD code = ep->ExceptionRecord->ExceptionCode;
    // exceptions de service (débogueur, C++ rattrapées, page de garde de dynarmic…) : on laisse passer
    static std::atomic<bool> once{false};
    if (once.exchange(true)) {
        return EXCEPTION_CONTINUE_SEARCH;
    }
    Common::Log::Stop(); // vide le journal d'Eden sur le disque
    wchar_t path[MAX_PATH * 2] = L"";
    if (const wchar_t* dir = _wgetenv(L"ARCADIA_USER_DIR"); dir && *dir) {
        swprintf(path, MAX_PATH * 2, L"%ls\\log\\arcadia-crash.txt", dir);
    } else {
        GetModuleFileNameW(nullptr, path, MAX_PATH);
        if (wchar_t* slash = wcsrchr(path, L'\\')) {
            wcscpy(slash + 1, L"arcadia-crash.txt");
        }
    }
    if (FILE* f = _wfopen(path, L"w")) {
        SYSTEMTIME t;
        GetLocalTime(&t);
        std::fprintf(f, "Arcadia Switch : plantage %04u-%02u-%02u %02u:%02u:%02u\ncode 0x%08lX\n", t.wYear, t.wMonth, t.wDay,
                     t.wHour, t.wMinute, t.wSecond, code);
        if (code == EXCEPTION_ACCESS_VIOLATION && ep->ExceptionRecord->NumberParameters >= 2) {
            std::fprintf(f, "acces %s 0x%016llx\n", ep->ExceptionRecord->ExceptionInformation[0] ? "ecriture" : "lecture",
                         static_cast<unsigned long long>(ep->ExceptionRecord->ExceptionInformation[1]));
        }
        DescribeAddress(f, "pc ", reinterpret_cast<DWORD64>(ep->ExceptionRecord->ExceptionAddress));
        // adresses de retour probables : valeurs de la pile qui tombent dans un module chargé
        const DWORD64* sp = reinterpret_cast<const DWORD64*>(ep->ContextRecord->Rsp);
        int found = 0;
        for (int i = 0; i < 2048 && found < 40; i++) {
            MEMORY_BASIC_INFORMATION mbi{};
            if (!VirtualQuery(sp + i, &mbi, sizeof(mbi)) || mbi.State != MEM_COMMIT) {
                break;
            }
            HMODULE mod = nullptr;
            const DWORD64 v = sp[i];
            if (v > 0x10000 && GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                                                      GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                                                  reinterpret_cast<LPCSTR>(v), &mod) && mod) {
                DescribeAddress(f, "ret", v);
                found++;
            }
        }
        std::fclose(f);
    }
    Emit("{\"event\":\"crash\"}");
    return EXCEPTION_CONTINUE_SEARCH;
}
#endif

} // namespace

void InstallCrashHandler() {
#ifdef _WIN32
    // seulement les plantages que personne n'a rattrapés (dynarmic se sert volontairement de fautes mémoire)
    SetUnhandledExceptionFilter(OnCrash);
#endif
}

bool Enabled() {
    return Env("ARCADIA") != nullptr;
}

std::string WindowTitle() {
    const char* t = Env("ARCADIA_TITLE");
    return t ? std::string{t} : std::string{};
}

void ReportStats(double fps, double speed, double frametime_ms) {
    const char* path = Env("ARCADIA_STATS");
    if (!path) return;
    if (SDL_IOStream* f = SDL_IOFromFile(path, "wb")) { // chemin UTF-8 (accents dans le dossier utilisateur)
        SDL_IOprintf(f, "{\"fps\":%.1f,\"speed\":%.0f,\"ms\":%.2f,\"t\":%llu}", fps, speed, frametime_ms, (unsigned long long)SDL_GetTicks());
        SDL_CloseIO(f);
    }
}

void Emit(const std::string& json) {
    std::fputs((json + "\n").c_str(), stdout);
    std::fflush(stdout);
}

void Init(InputCommon::InputSubsystem* input, SDL_Window* window) {
    if (!Enabled()) {
        return;
    }
    InstallCrashHandler(); // au cas où une bibliothèque l'aurait remplacé pendant le chargement
    g_window = window;
    g_pad = input->GetVirtualGamepad();
    SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
    SDL_InitSubSystem(SDL_INIT_GAMEPAD | SDL_INIT_HAPTIC);
    if (const char* db = Env("ARCADIA_PAD_DB")) {
        SDL_AddGamepadMappingsFromFile(db); // calibrages faits dans Arcadia
    }
    InputCommon::VirtualGamepad::SetVibrationCallback(OnVibration);
    if (const char* ctl = Env("ARCADIA_CONTROLS")) g_watch.path = ctl;
    if (!ArcadiaControls::Load(g_watch.path, g_map)) g_map = ArcadiaControls::Defaults(true);
    g_watch.Touch();
    g_kb_global = Env("ARCADIA_KB_GLOBAL") != nullptr;
    if (Env("ARCADIA_MUTE")) Settings::values.audio_muted = true; // une seule instance fait le son
    if (const char* d = Env("ARCADIA_DISPLAY")) PlaceOnDisplay(window, d);
    OpenGamepad();
}

void OnEvent(const SDL_Event& event) {
    if (!g_pad) {
        return;
    }
    if (event.type == SDL_EVENT_GAMEPAD_ADDED || event.type == SDL_EVENT_GAMEPAD_REMOVED) {
        OpenGamepad();
    }
}

void Poll() {
    if (!g_pad) {
        return;
    }
    const Uint64 now = SDL_GetTicks();
    if (now - g_last_poll < 4) { // ~250 Hz
        return;
    }
    g_last_poll = now;
    if (now - g_last_scan > 1000) {
        g_last_scan = now;
        OpenGamepad();
    }

    namespace AC = ArcadiaControls;
    if (g_watch.Changed()) AC::Load(g_watch.path, g_map); // changé depuis le menu Échap d'Arcadia
    SDL_Gamepad* p;
    {
        std::scoped_lock lk{g_gamepad_mutex};
        p = g_gamepad;
    }
    const AC::Device dev = g_map.device;
    if (dev == AC::KEYBOARD) p = nullptr; // clavier seul
    // Clavier : seulement quand la fenêtre du jeu est devant ; touches par position (AZERTY = QWERTY)
    const bool focused = g_window && (SDL_GetWindowFlags(g_window) & SDL_WINDOW_INPUT_FOCUS);
    const bool useKb = (focused || g_kb_global) && (dev == AC::BOTH || dev == AC::KEYBOARD);
    int nkeys = 0;
    const bool* k = nullptr;
    if (useKb && g_kb_global) {
        ReadGlobalKeyboard();
        k = g_kb_state;
        nkeys = SDL_SCANCODE_COUNT;
    } else if (useKb) {
        k = SDL_GetKeyboardState(&nkeys);
    }
    auto pressed = [&](int a) {
        for (int c : g_map.pad[a]) if (AC::PadDown(p, c)) return true;
        for (int sc : g_map.kb[a]) if (AC::KeyDown(k, nkeys, sc)) return true;
        return false;
    };
    static const VB kButton[AC::HOME + 1] = { VB::ButtonA, VB::ButtonB, VB::ButtonX, VB::ButtonY, VB::TriggerL, VB::TriggerR,
        VB::TriggerZL, VB::TriggerZR, VB::ButtonPlus, VB::ButtonMinus, VB::StickL, VB::StickR, VB::ButtonUp, VB::ButtonDown,
        VB::ButtonLeft, VB::ButtonRight, VB::ButtonHome };
    for (int a = 0; a <= AC::HOME; a++) g_pad->SetButtonState(0, kButton[a], pressed(a));
    g_pad->SetButtonState(0, VB::ButtonCapture, Btn(p, SDL_GAMEPAD_BUTTON_MISC1));

    // Sticks : manette, sauf si une direction clavier est tenue ; stick arcade : le levier (croix) pilote aussi le stick gauche
    auto stick = [&](VS s, SDL_GamepadAxis ax, SDL_GamepadAxis ay, int up) {
        float x = Axis(p, ax), y = -Axis(p, ay);
        int kx = 0, ky = 0;
        for (int sc : g_map.kb[up + 3]) if (AC::KeyDown(k, nkeys, sc)) kx++;
        for (int sc : g_map.kb[up + 2]) if (AC::KeyDown(k, nkeys, sc)) kx--;
        for (int sc : g_map.kb[up + 0]) if (AC::KeyDown(k, nkeys, sc)) ky++;
        for (int sc : g_map.kb[up + 1]) if (AC::KeyDown(k, nkeys, sc)) ky--;
        if (dev == AC::STICK && s == VS::Left && p) {
            kx += (Btn(p, SDL_GAMEPAD_BUTTON_DPAD_RIGHT) ? 1 : 0) - (Btn(p, SDL_GAMEPAD_BUTTON_DPAD_LEFT) ? 1 : 0);
            ky += (Btn(p, SDL_GAMEPAD_BUTTON_DPAD_UP) ? 1 : 0) - (Btn(p, SDL_GAMEPAD_BUTTON_DPAD_DOWN) ? 1 : 0);
        }
        if (kx != 0 || ky != 0) {
            const float n = std::sqrt(float(kx * kx + ky * ky));
            x = kx / n;
            y = ky / n;
        }
        g_pad->SetStickPosition(0, s, std::clamp(x, -1.f, 1.f), std::clamp(y, -1.f, 1.f));
    };
    stick(VS::Left, SDL_GAMEPAD_AXIS_LEFTX, SDL_GAMEPAD_AXIS_LEFTY, AC::LS_UP);
    stick(VS::Right, SDL_GAMEPAD_AXIS_RIGHTX, SDL_GAMEPAD_AXIS_RIGHTY, AC::RS_UP);
}

void Shutdown() {
    InputCommon::VirtualGamepad::SetVibrationCallback({});
    std::scoped_lock lk{g_gamepad_mutex};
    if (g_gamepad) {
        SDL_CloseGamepad(g_gamepad);
        g_gamepad = nullptr;
    }
    g_pad = nullptr;
}

} // namespace Arcadia
