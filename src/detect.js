// Devine la console d'un fichier ROM ou d'un dossier de jeu.
// 1) extension sans ambiguïté  2) sinon lecture de l'en-tête du fichier.
const fs = require('fs');
const path = require('path');
const { IsoReader, readAt } = require('./iso');

const BY_EXT = {
  nds: 'DS', dsi: 'DS', ids: 'DS',
  '3ds': '3DS', cci: '3DS', cxi: '3DS', cia: '3DS', '3dsx': '3DS',
  nup: 'SWITCH 2', xci: 'SWITCH', nsp: 'SWITCH', nsz: 'SWITCH', xcz: 'SWITCH', nro: 'SWITCH', nso: 'SWITCH', nca: 'SWITCH',
  gba: 'GBA', gb: 'GB', gbc: 'GB', sgb: 'GB',
  sfc: 'SNES', smc: 'SNES', fig: 'SNES', swc: 'SNES',
  nes: 'NES', fds: 'NES', unf: 'NES', unif: 'NES',
  n64: 'N64', z64: 'N64', v64: 'N64',
  md: 'MEGADRIVE', gen: 'MEGADRIVE', smd: 'MEGADRIVE', '32x': 'MEGADRIVE',
  gdi: 'DREAMCAST', cdi: 'DREAMCAST',
  wua: 'WIIU', wud: 'WIIU', wux: 'WIIU', rpx: 'WIIU',
  vpk: 'PSVITA',
  xex: 'XBOX360', zar: 'XBOX360',
  xiso: 'XBOX',
  wbfs: 'WII', wad: 'WII',
  gcm: 'GAMECUBE', ciso: 'GAMECUBE', dol: 'GAMECUBE',
  cso: 'PSP', prx: 'PSP',
  cue: 'PS1', m3u: 'PS1', ccd: 'PS1', mds: 'PS1', ecm: 'PS1'
};
const SNIFF = new Set(['iso', 'img', 'bin', 'chd', 'pbp', 'rvz', 'gcz', 'wia', 'elf', 'gz']);
const ARCHIVES = new Set(['zip', '7z', 'rar']);
const ROM_EXTS = new Set([...Object.keys(BY_EXT), ...SNIFF]);

function sniffIso(fd) {
  // GameCube / Wii : magie dans l'en-tête disque
  const h = readAt(fd, 0, 0x40);
  if (readAt(fd, 0x100, 4).toString('latin1') === 'SEGA') return 'MEGADRIVE'; // ROM Mega Drive en .bin
  if (h.length >= 0x20) {
    if (h.readUInt32BE(0x18) === 0x5d1c9ea3) return 'WII';
    if (h.readUInt32BE(0x1c) === 0xc2339f3d) return 'GAMECUBE';
  }
  // Xbox / Xbox 360 (XDVDFS)
  for (const base of [0, 0x18300000, 0x0fd90000, 0x02080000]) {
    const m = readAt(fd, base + 0x10000, 20);
    if (m.toString('ascii') === 'MICROSOFT*XBOX*MEDIA') {
      const rootSector = readAt(fd, base + 0x10000 + 20, 4).readUInt32LE(0);
      const dir = readAt(fd, base + rootSector * 2048, 64 * 1024).toString('latin1').toLowerCase();
      if (dir.includes('default.xex')) return 'XBOX360';
      if (dir.includes('default.xbe')) return 'XBOX';
      return base === 0 ? 'XBOX' : 'XBOX360';
    }
  }
  // ISO9660 : PSP, PS3, PS1, PS2
  const iso = new IsoReader(fd);
  if (iso.ok) {
    const names = iso.root().map(e => e.name.toUpperCase());
    if (names.includes('PSP_GAME') || names.includes('UMD_DATA.BIN')) return 'PSP';
    if (names.includes('PS3_GAME') || names.includes('PS3_DISC.SFB')) return 'PS3';
    const cnf = iso.readFile('SYSTEM.CNF', 64 * 1024);
    if (cnf) {
      const t = cnf.toString('latin1').toUpperCase();
      if (t.includes('BOOT2')) return 'PS2';
      if (t.includes('BOOT')) return 'PS1';
    }
    // Disque PlayStation sans SYSTEM.CNF lisible : la taille tranche (DVD = PS2)
    return iso.sectorSize === 2352 ? 'PS1' : null;
  }
  return null;
}

function sniffChd(fd) {
  const h = readAt(fd, 0, 124);
  if (h.toString('ascii', 0, 8) !== 'MComprHD') return null;
  const version = h.readUInt32BE(12);
  let metaOff = version >= 5 ? Number(h.readBigUInt64BE(48)) : version >= 3 ? Number(h.readBigUInt64BE(36)) : 0;
  const tags = new Set();
  for (let i = 0; metaOff && i < 64; i++) {
    const e = readAt(fd, metaOff, 16);
    if (e.length < 16) break;
    tags.add(e.toString('ascii', 0, 4));
    metaOff = Number(e.readBigUInt64BE(8));
  }
  if (tags.has('CHGD')) return 'DREAMCAST';
  if (tags.has('DVD ')) return 'PS2';
  if (tags.has('CHCD') || tags.has('CHT2') || tags.has('CHTR')) return 'PS1';
  return null;
}

function sniffPbp(fd) {
  const h = readAt(fd, 0, 0x28);
  if (h.toString('latin1', 1, 4) !== 'PBP') return 'PSP';
  const psar = readAt(fd, h.readUInt32LE(0x24), 12).toString('latin1');
  return psar.startsWith('PSISOIMG') || psar.startsWith('PSTITLEI') ? 'PS1' : 'PSP';
}

function sniffWia(fd) {
  // RVZ / WIA : header2 commence par disc_type (1 = GameCube, 2 = Wii)
  const h = readAt(fd, 0, 0x60);
  const magic = h.toString('latin1', 0, 3);
  if (magic === 'RVZ' || magic === 'WIA') {
    const t = readAt(fd, 0x48, 4).readUInt32BE(0);
    return t === 2 ? 'WII' : 'GAMECUBE';
  }
  if (h.length >= 8 && h.readUInt32LE(0) === 0xb10bc001) return h.readUInt32LE(4) === 1 ? 'WII' : 'GAMECUBE';
  return null;
}

// Renvoie l'id de console ou null si on ne sait pas.
function detectFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === 'cue') { // CD PlayStation : PS1 en général, mais certains jeux PS2 sont sur CD (lecture de SYSTEM.CNF)
    try {
      const m = /FILE\s+"([^"]+)"/i.exec(fs.readFileSync(file, 'utf8'));
      const bin = m && path.join(path.dirname(file), m[1]);
      if (bin && fs.existsSync(bin)) { const fd = fs.openSync(bin, 'r'); try { const c = sniffIso(fd); if (c === 'PS2' || c === 'PS1') return c; } finally { fs.closeSync(fd); } }
    } catch { /* cue illisible */ }
    return 'PS1';
  }
  if (BY_EXT[ext]) return BY_EXT[ext];
  if (!SNIFF.has(ext)) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (ext === 'chd') return sniffChd(fd);
    if (ext === 'pbp') return sniffPbp(fd);
    if (ext === 'rvz' || ext === 'gcz' || ext === 'wia') return sniffWia(fd);
    if (ext === 'elf') return null;
    return sniffIso(fd);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Dossier de jeu (PS3, PS4, Wii U décompressé) ou null.
function detectFolder(dir) {
  const has = p => fs.existsSync(path.join(dir, p));
  if (has('PS3_GAME') || has('PS3_DISC.SFB')) return 'PS3';
  if ((has('eboot.bin') || has('EBOOT.BIN')) && has('sce_sys')) return 'PS4';
  if (has('code') && has('content') && has('meta')) return 'WIIU';
  return null;
}

// Fichiers qui accompagnent un .cue / .gdi / .m3u (pistes .bin, etc.)
function companions(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const dir = path.dirname(file);
  let text;
  try { text = fs.readFileSync(file, 'latin1'); } catch { return []; }
  const out = new Set();
  if (ext === 'cue') {
    for (const m of text.matchAll(/FILE\s+"([^"]+)"/gi)) out.add(path.join(dir, m[1]));
    for (const m of text.matchAll(/FILE\s+([^\s"]+)\s+\w+\s*$/gim)) out.add(path.join(dir, m[1]));
  } else if (ext === 'gdi') {
    for (const line of text.split(/\r?\n/).slice(1)) {
      const m = line.match(/^\s*\d+\s+\d+\s+\d+\s+\d+\s+("([^"]+)"|(\S+))/);
      if (m) out.add(path.join(dir, m[2] || m[3]));
    }
  } else if (ext === 'm3u') {
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim();
      if (l && !l.startsWith('#')) {
        const p = path.join(dir, l);
        out.add(p);
        if (p.toLowerCase().endsWith('.cue')) companions(p).forEach(c => out.add(c));
      }
    }
  }
  return [...out].filter(p => fs.existsSync(p));
}

module.exports = { detectFile, detectFolder, companions, BY_EXT, ARCHIVES, ROM_EXTS };
