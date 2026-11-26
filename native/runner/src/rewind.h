// Rembobinage : historique des dernières secondes de jeu en mémoire.
// Chaque instantané n'est gardé que sous forme de différence (XOR) avec le suivant, compressée
// (suites de zéros) : quelques Mo suffisent pour ~30 s, même pour une PSP ou une DS.
#pragma once
#include <cstdint>
#include <cstring>
#include <algorithm>
#include <deque>
#include <vector>

class Rewind {
public:
  size_t budget = 256u << 20; // mémoire maximale de l'historique
  int interval = 1;           // une capture toutes les N images

  void reset() { deltas.clear(); last.clear(); bytes = 0; counter = 0; size = 0; }
  bool empty() const { return deltas.empty(); }
  size_t count() const { return deltas.size(); }

  // Après chaque image jouée normalement
  template <class Ser> void capture(size_t stateSize, Ser&& serialize) {
    if (!stateSize) return;
    if (stateSize != size) { reset(); size = stateSize; interval = stateSize < (1u << 20) ? 1 : (int)std::min<size_t>(30, stateSize >> 20); }
    if (++counter < interval) return;
    counter = 0;
    cur.resize(size);
    if (!serialize(cur.data(), size)) return;
    if (!last.empty()) {
      // delta = ancien ^ nouveau : en revenant en arrière, ancien = nouveau ^ delta
      tmp.resize(size);
      const uint8_t* a = last.data(); const uint8_t* b = cur.data(); uint8_t* x = tmp.data();
      for (size_t i = 0; i < size; i++) x[i] = a[i] ^ b[i];
      std::vector<uint8_t> enc; encode(tmp.data(), size, enc);
      bytes += enc.size(); deltas.push_back(std::move(enc));
      while (bytes > budget && !deltas.empty()) { bytes -= deltas.front().size(); deltas.pop_front(); }
    }
    last.swap(cur);
  }
  // Un pas en arrière : renvoie l'état à charger (ou nullptr si l'historique est vide)
  const std::vector<uint8_t>* stepBack() {
    if (deltas.empty() || last.empty()) return nullptr;
    std::vector<uint8_t>& d = deltas.back();
    decodeXor(d, last);
    bytes -= d.size(); deltas.pop_back();
    counter = 0;
    return &last;
  }

private:
  std::deque<std::vector<uint8_t>> deltas;
  std::vector<uint8_t> last, cur, tmp;
  size_t bytes = 0, size = 0; int counter = 0;

  static void put32(std::vector<uint8_t>& o, uint32_t v) { uint8_t b[4]; memcpy(b, &v, 4); o.insert(o.end(), b, b + 4); }
  // Format : [zéros:u32][n:u32][n octets]…
  static void encode(const uint8_t* p, size_t n, std::vector<uint8_t>& o) {
    o.reserve(n / 16 + 64);
    size_t i = 0;
    while (i < n) {
      size_t z = i; while (z < n && p[z] == 0) z++;
      size_t l = z; while (l < n && !(p[l] == 0 && l + 8 <= n && !memcmp(p + l, "\0\0\0\0\0\0\0\0", 8))) l++;
      put32(o, (uint32_t)(z - i)); put32(o, (uint32_t)(l - z)); o.insert(o.end(), p + z, p + l);
      i = l;
    }
  }
  static void decodeXor(const std::vector<uint8_t>& e, std::vector<uint8_t>& state) {
    size_t i = 0, pos = 0;
    while (i + 8 <= e.size()) {
      uint32_t z, l; memcpy(&z, &e[i], 4); memcpy(&l, &e[i + 4], 4); i += 8;
      pos += z;
      for (uint32_t k = 0; k < l && pos < state.size() && i < e.size(); k++) state[pos++] ^= e[i++];
    }
  }
};
