// Moteurs téléchargés à la demande (premier jeu d'une console), vérifiés par sha256
'use strict';
const BASE = 'https://raw.githubusercontent.com/hiimivex/Arcadia/f54451b66eccdc11d866c2e2f84b07286c4ddf1c/';
const PACKS = {
  'core-azahar_libretro': { file: 'core-azahar_libretro.zip', sha256: '1a7016af3416692c74e319751bd53f4b867cd3853421fe29a2d493905e1f024a', size: 12097452 },
  'core-bsnes_libretro': { file: 'core-bsnes_libretro.zip', sha256: 'fe3219f1b4aa358099f4020bdba1457b8c9e9c670329f34d1373f53bd853ac65', size: 1040519 },
  'core-dolphin_libretro': { file: 'core-dolphin_libretro.zip', sha256: 'eb99594b8ca75748604bcf29a279546e8389d12fcf4e10572b433492926bcffb', size: 9061140 },
  'core-flycast_libretro': { file: 'core-flycast_libretro.zip', sha256: '70ba5ce8d00174393f586400f267318d1ab33bd64da548dcb52af4a63651ca53', size: 4852677 },
  'core-melonds_libretro': { file: 'core-melonds_libretro.zip', sha256: '67ae39cf58f7c050a4302212a824b9f342f432274b9e937a0cbcd2349480866e', size: 1180113 },
  'core-mesen_libretro': { file: 'core-mesen_libretro.zip', sha256: '7e0e8ce3b176e2b3f4cd9758c91e98288fc6c4113f6bf7703d81cebf30a23be0', size: 1216359 },
  'core-mgba_libretro': { file: 'core-mgba_libretro.zip', sha256: 'bf65db1e40548fd77f3cad54646f1ad782e825407e2b5a4037451cee2cc4977b', size: 965268 },
  'core-mupen64plus_next_libretro': { file: 'core-mupen64plus_next_libretro.zip', sha256: 'b5fa7aa7a7044fc0857409cf2649ed61a0dbd371d89a06c24a5ebc94a8cb1263', size: 1869045 },
  'core-pcsx2_libretro': { file: 'core-pcsx2_libretro.zip', sha256: '2c6fa864a232f86cba21f9d4889bc75dbbc8840d2b45a779e43f46baed931bcc', size: 3281065 },
  'core-pcsx_rearmed_libretro': { file: 'core-pcsx_rearmed_libretro.zip', sha256: '8699b9bf0fb12915b3fbc7a44ca792fb1623ca7b3b266c675ef385b91a1b9dc2', size: 833846 },
  'core-ppsspp_libretro': { file: 'core-ppsspp_libretro.zip', sha256: '1f0a230511381e3687d8352ccc7825cb1b9d84e5e7b515ef1e4e9b5489459411', size: 8437992 },
  'core-swanstation_libretro': { file: 'core-swanstation_libretro.zip', sha256: '3042d8521c76adc6df3f85e08f4586516038ce163b109d5330e4b3a1fc51d636', size: 2578004 },
  'switch': { file: 'switch.zip', sha256: 'af6a7363278c870e63328e2b42226a8506efd4c9d62507d60e45e6dc795f105f', size: 17053331 },
  'system-dolphin': { file: 'system-dolphin.zip', sha256: 'd01a19025306356c0f2b36bb1e1712a681b37495487516c95ec9e18c0ce33432', size: 3282458 },
  'system-ppsspp': { file: 'system-ppsspp.zip', sha256: '38af135528dd9331e1170ab6549b7ce1f8aced097635474e36e046800fbd3f54', size: 8855186 },
};
const LABELS = {
  azahar_libretro: '3DS', bsnes_libretro: 'Super Nintendo', dolphin_libretro: 'GameCube / Wii', flycast_libretro: 'Dreamcast',
  melonds_libretro: 'Nintendo DS', mesen_libretro: 'NES', mgba_libretro: 'Game Boy / GBA', mupen64plus_next_libretro: 'Nintendo 64',
  pcsx2_libretro: 'PlayStation 2', pcsx_rearmed_libretro: 'PlayStation', ppsspp_libretro: 'PSP', swanstation_libretro: 'PlayStation'
};
// fichiers système livrés avec certains cœurs (polices, bases de données — aucun BIOS)
const CORE_SYSTEM = { ppsspp_libretro: 'system-ppsspp', dolphin_libretro: 'system-dolphin' };
const url = name => BASE + PACKS[name].file;
const corePacks = core => [PACKS['core-' + core] && 'core-' + core, CORE_SYSTEM[core]].filter(Boolean);
module.exports = { PACKS, LABELS, CORE_SYSTEM, url, corePacks };
