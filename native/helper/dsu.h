// Protocole DSU (« cemuhook ») : Arcadia se présente aux moteurs Switch comme UNE manette réseau
// qui fusionne la vraie manette (n'importe laquelle, via SDL) et le clavier. Portable (testé sous Linux).
#pragma once
#include <cstdint>
#include <cstring>
#include <vector>

namespace dsu {
constexpr uint32_t CLIENT_MAGIC = 0x43555344, SERVER_MAGIC = 0x53555344;
constexpr uint16_t VERSION = 1001;
constexpr uint32_t T_VERSION = 0x100000, T_PORTINFO = 0x100001, T_PADDATA = 0x100002;

// Bits de digital_button tels que les lit le moteur (bit i)
enum : uint16_t { SHARE = 1 << 0, L3 = 1 << 1, R3 = 1 << 2, OPTIONS = 1 << 3, UP = 1 << 4, RIGHT = 1 << 5, DOWN = 1 << 6, LEFT = 1 << 7,
  L2 = 1 << 8, R2 = 1 << 9, L1 = 1 << 10, R1 = 1 << 11, TRIANGLE = 1 << 12, CIRCLE = 1 << 13, CROSS = 1 << 14, SQUARE = 1 << 15 };

struct State { uint16_t buttons = 0; bool home = false; uint8_t lx = 128, ly = 128, rx = 128, ry = 128; uint8_t l2 = 0, r2 = 0; };

inline uint32_t crc32(const uint8_t* p, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) { c ^= p[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1))); }
  return ~c;
}
inline void put16(uint8_t* p, uint16_t v) { p[0] = v & 0xFF; p[1] = v >> 8; }
inline void put32(uint8_t* p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (v >> (8 * i)) & 0xFF; }
inline void put64(uint8_t* p, uint64_t v) { for (int i = 0; i < 8; i++) p[i] = (v >> (8 * i)) & 0xFF; }

// En-tête (20 octets) + type + charge utile ; CRC32 sur tout le message, champ CRC à zéro
inline std::vector<uint8_t> message(uint32_t serverId, uint32_t type, const uint8_t* payload, size_t len) {
  std::vector<uint8_t> m(20 + len, 0);
  put32(&m[0], SERVER_MAGIC); put16(&m[4], VERSION); put16(&m[6], (uint16_t)(len + 4));
  put32(&m[12], serverId); put32(&m[16], type);
  if (len) memcpy(&m[20], payload, len);
  put32(&m[8], crc32(m.data(), m.size()));
  return m;
}
// Infos d'un emplacement de manette (12 octets)
inline void portInfo(uint8_t* p, uint8_t slot, bool connected) {
  memset(p, 0, 12);
  p[0] = slot; p[1] = connected ? 2 : 0; p[2] = connected ? 2 : 0; p[3] = connected ? 1 : 0; // connectée, gyro complet, USB
  if (connected) { p[4] = 0xA7; p[5] = 0xCA; p[6] = 0xD1; p[7] = 0xA0; p[8] = 0x00; p[9] = slot; p[10] = 0x05; p[11] = 1; } // MAC fictive, batterie pleine, active
}
inline std::vector<uint8_t> versionMsg(uint32_t id) { uint8_t v[2]; put16(v, VERSION); return message(id, T_VERSION, v, 2); }
inline std::vector<uint8_t> portInfoMsg(uint32_t id, uint8_t slot, bool connected) { uint8_t p[12]; portInfo(p, slot, connected); return message(id, T_PORTINFO, p, 12); }
inline std::vector<uint8_t> padDataMsg(uint32_t id, uint8_t slot, const State& s, uint32_t counter, uint64_t usec) {
  uint8_t p[80]; memset(p, 0, sizeof p);
  portInfo(p, slot, true);
  put32(p + 12, counter);
  put16(p + 16, s.buttons);
  p[18] = s.home ? 1 : 0; p[19] = 0;
  p[20] = s.lx; p[21] = s.ly; p[22] = s.rx; p[23] = s.ry;
  // boutons analogiques : croix G/B/D/H, carré, croix, rond, triangle, R1, L1, R2, L2
  const uint16_t b = s.buttons;
  uint8_t* a = p + 24;
  a[0] = b & LEFT ? 255 : 0; a[1] = b & DOWN ? 255 : 0; a[2] = b & RIGHT ? 255 : 0; a[3] = b & UP ? 255 : 0;
  a[4] = b & SQUARE ? 255 : 0; a[5] = b & CROSS ? 255 : 0; a[6] = b & CIRCLE ? 255 : 0; a[7] = b & TRIANGLE ? 255 : 0;
  a[8] = b & R1 ? 255 : 0; a[9] = b & L1 ? 255 : 0; a[10] = s.r2; a[11] = s.l2;
  // pavé tactile (2 × 6 octets) : inactif ; horodatage du mouvement ; accéléromètre au repos (1 g vers le bas)
  put64(p + 48, usec);
  float acc[3] = { 0.f, -1.f, 0.f }, gyro[3] = { 0.f, 0.f, 0.f };
  memcpy(p + 56, acc, 12); memcpy(p + 68, gyro, 12);
  return message(id, T_PADDATA, p, 80);
}
} // namespace dsu
