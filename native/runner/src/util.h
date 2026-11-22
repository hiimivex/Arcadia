// Petits outils : fichiers UTF-8 (via SDL_IO), config clé=valeur, JSON d'évènements.
#pragma once
#include <SDL3/SDL.h>
#include <string>
#include <map>
#include <vector>
#include <cstdio>

inline bool fileExists(const std::string& p) { SDL_PathInfo i; return SDL_GetPathInfo(p.c_str(), &i) && i.type == SDL_PATHTYPE_FILE; }
inline std::string joinPath(const std::string& a, const std::string& b) {
  if (a.empty()) return b;
  char c = a.back();
  return (c == '/' || c == '\\') ? a + b : a + "/" + b;
}
inline bool readFile(const std::string& p, std::vector<uint8_t>& out) {
  size_t n = 0; void* d = SDL_LoadFile(p.c_str(), &n);
  if (!d) return false;
  out.assign((uint8_t*)d, (uint8_t*)d + n); SDL_free(d); return true;
}
inline bool writeFile(const std::string& p, const void* data, size_t n) {
  std::string tmp = p + ".tmp";
  SDL_IOStream* io = SDL_IOFromFile(tmp.c_str(), "wb");
  if (!io) return false;
  bool ok = SDL_WriteIO(io, data, n) == n;
  ok = SDL_CloseIO(io) && ok;
  if (!ok) { SDL_RemovePath(tmp.c_str()); return false; }
  SDL_RemovePath(p.c_str());
  return SDL_RenamePath(tmp.c_str(), p.c_str());
}
inline std::string safeName(std::string s) {
  for (auto& c : s) if (c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') c = '_';
  return s;
}

// Config « clé=valeur » (une ligne par réglage, UTF-8)
struct Config {
  std::map<std::string, std::string> kv;
  bool load(const std::string& p) {
    std::vector<uint8_t> d; if (!readFile(p, d)) return false;
    std::string s(d.begin(), d.end()); size_t i = 0;
    while (i < s.size()) {
      size_t e = s.find('\n', i); if (e == std::string::npos) e = s.size();
      std::string line = s.substr(i, e - i); i = e + 1;
      if (!line.empty() && line.back() == '\r') line.pop_back();
      size_t eq = line.find('='); if (eq == std::string::npos || line[0] == '#') continue;
      kv[line.substr(0, eq)] = line.substr(eq + 1);
    }
    return true;
  }
  bool save(const std::string& p) const {
    std::string s = "# Arcadia runner\n";
    for (auto& [k, v] : kv) s += k + "=" + v + "\n";
    return writeFile(p, s.data(), s.size());
  }
  std::string get(const std::string& k, const std::string& def = "") const { auto it = kv.find(k); return it == kv.end() ? def : it->second; }
  int geti(const std::string& k, int def) const { auto it = kv.find(k); return it == kv.end() ? def : SDL_atoi(it->second.c_str()); }
  bool getb(const std::string& k, bool def) const { auto it = kv.find(k); return it == kv.end() ? def : it->second == "1"; }
  void set(const std::string& k, const std::string& v) { kv[k] = v; }
  void seti(const std::string& k, int v) { kv[k] = std::to_string(v); }
  void setb(const std::string& k, bool v) { kv[k] = v ? "1" : "0"; }
};

inline std::string jsonEsc(const std::string& s) {
  std::string o; for (char c : s) { if (c == '"' || c == '\\') { o += '\\'; o += c; } else if ((unsigned char)c < 0x20) { char b[8]; SDL_snprintf(b, 8, "\\u%04x", c); o += b; } else o += c; }
  return o;
}
// Évènement vers Arcadia (une ligne JSON sur stdout)
inline void emit(const std::string& json) { fputs(json.c_str(), stdout); fputc('\n', stdout); fflush(stdout); }
