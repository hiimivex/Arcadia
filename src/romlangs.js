// Région et langues d'une ROM, lues dans son en-tête, pour toute console qui n'a pas de liste de langues
// dans ses métadonnées (la Switch et la 3DS en ont une : voir langs.js).
//   detect(game, info) -> { region, serial, langs } ; langs = langues proposables (ou null si inconnues)
const fs = require('fs');
const path = require('path');
const { IsoReader, readAt } = require('./iso');
const { CONSOLE_LANGS } = require('./langs');

// Langues probables d'une sortie selon sa région
const REGION_LANGS = {
  EUR: ['fr', 'en', 'de', 'it', 'es', 'nl'], USA: ['en', 'fr', 'es'], JPN: ['ja'], KOR: ['ko'],
  FRA: ['fr'], DEU: ['de'], ESP: ['es'], ITA: ['it'], NLD: ['nl'], AUS: ['en'], CHN: ['zh-Hans'], TWN: ['zh-Hant']
};
const REGION_NAMES = {
  EUR: 'européenne', USA: 'américaine', JPN: 'japonaise', KOR: 'coréenne', FRA: 'française', DEU: 'allemande',
  ESP: 'espagnole', ITA: 'italienne', NLD: 'néerlandaise', AUS: 'australienne', CHN: 'chinoise', TWN: 'taïwanaise', INT: 'internationale'
};

// Dernière lettre du code de jeu Nintendo (DS, GBA, N64, GameCube, Wii)
const NINTENDO = { E: 'USA', P: 'EUR', X: 'EUR', Y: 'EUR', Z: 'EUR', V: 'EUR', J: 'JPN', K: 'KOR', F: 'FRA', D: 'DEU',
  S: 'ESP', I: 'ITA', H: 'NLD', U: 'AUS', C: 'CHN', W: 'TWN', O: 'INT', A: 'INT' };
const nintendo = c => NINTENDO[String(c || '').toUpperCase()] || null;

// Numéros de série Sony (PS1, PS2, PSP)
function sonyRegion(serial) {
  const s = String(serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^(SLES|SCES|SCED|SLED|PBPX)/.test(s)) return /^PBPX/.test(s) ? 'JPN' : 'EUR';
  if (/^(SLUS|SCUS|LSP|PAPX)/.test(s)) return 'USA';
  if (/^(SLKA|SCKA)/.test(s)) return 'KOR';
  if (/^(SLPS|SLPM|SCPS|SLPN|SCAJ|SCPM|SIPS)/.test(s)) return 'JPN';
  const m = /^(UL|UC|NP)([A-Z])/.exec(s); // PSP : ULES, UCUS, NPJH…
  if (m) return { E: 'EUR', U: 'USA', J: 'JPN', K: 'KOR', A: 'INT', H: 'INT' }[m[2]] || null;
  return null;
}

// Disque GameCube / Wii : ID à 6 caractères selon le format
function discId(fd, ext) {
  const h = readAt(fd, 0, 0x60);
  if (h.length < 8) return null;
  let off = 0;
  const magic = h.toString('latin1', 0, 4);
  if (magic === 'WBFS') off = 1 << h[8];
  else if (magic === 'CISO') off = 0x8000;
  else if (magic === 'WIA\x01' || magic === 'RVZ\x01') off = 0x58;
  else if (h.readUInt32LE(0) === 0xb10bc001) return null; // GCZ compressé
  else if (!['iso', 'gcm', 'wbfs', 'ciso', 'rvz', 'wia'].includes(ext)) return null;
  const id = readAt(fd, off, 6).toString('latin1');
  return /^[A-Z0-9]{6}$/.test(id) ? id : null;
}

// N64 : trois ordres d'octets possibles
function n64Code(fd) {
  const h = readAt(fd, 0, 0x40);
  if (h.length < 0x40) return null;
  const w = h.readUInt32BE(0);
  let b = h;
  if (w === 0x37804012) { b = Buffer.from(h); for (let i = 0; i + 1 < b.length; i += 2) [b[i], b[i + 1]] = [b[i + 1], b[i]]; }
  else if (w === 0x40123780) { b = Buffer.from(h); for (let i = 0; i + 3 < b.length; i += 4) b.writeUInt32BE(h.readUInt32LE(i), i); }
  else if (w !== 0x80371240) return null;
  return b.toString('latin1', 0x3b, 0x3f);
}

// PS1 / PS2 : SYSTEM.CNF -> BOOT = cdrom:\SLES_123.45;1
function sonyDiscSerial(file) {
  let f = file;
  try {
    if (/\.cue$/i.test(f)) {
      const m = /FILE\s+"([^"]+)"/i.exec(fs.readFileSync(f, 'utf8'));
      if (!m) return null; f = path.join(path.dirname(file), m[1]);
    } else if (/\.m3u$/i.test(f)) {
      const first = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(x => x.trim()).find(x => x && !x.startsWith('#'));
      if (!first) return null; return sonyDiscSerial(path.join(path.dirname(file), first));
    }
    const fd = fs.openSync(f, 'r');
    try {
      const iso = new IsoReader(fd);
      if (!iso.ok) return null;
      const cnf = iso.readFile('SYSTEM.CNF', 4096);
      const m = cnf && /BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4}[_-]?\d{3}\.?\d{2})/i.exec(cnf.toString('latin1'));
      return m ? m[1].replace(/[_.-]/g, '').toUpperCase() : null;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

// Dreamcast (.gdi) : zone « JUE » de l'IP.BIN, au début de la piste 3
function dreamcastArea(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim().split(/\s+/));
    const t3 = lines.find(l => l[0] === '3');
    if (!t3) return null;
    const sect = Number(t3[3]) || 2352, name = t3[4].replace(/^"|"$/g, '');
    const fd = fs.openSync(path.join(path.dirname(file), name), 'r');
    try {
      const b = readAt(fd, sect === 2352 ? 16 : 0, 0x40);
      if (b.toString('latin1', 0, 15) !== 'SEGA SEGAKATANA') return null;
      return b.toString('latin1', 0x30, 0x38).trim();
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

function regionOf(game, info) {
  const ext = path.extname(game.path).slice(1).toLowerCase();
  const c = game.console;
  if (c === 'PSP') return { region: sonyRegion(info?.serial), serial: info?.serial || null };
  if (c === 'PS1' || c === 'PS2') { const s = sonyDiscSerial(game.path); return { region: sonyRegion(s), serial: s }; }
  if (c === 'DREAMCAST' && ext === 'gdi') {
    const a = dreamcastArea(game.path);
    if (!a) return null;
    const has = x => a.includes(x);
    return { region: has('E') ? (has('U') || has('J') ? 'INT' : 'EUR') : has('U') ? 'USA' : has('J') ? 'JPN' : null, serial: null };
  }
  let code = null;
  try {
    const fd = fs.openSync(game.path, 'r');
    try {
      if (c === 'DS' && ext === 'nds') code = readAt(fd, 0x0c, 4).toString('latin1');
      else if (c === 'GBA') code = readAt(fd, 0xac, 4).toString('latin1');
      else if (c === 'N64') code = n64Code(fd);
      else if (c === 'GAMECUBE' || c === 'WII') code = discId(fd, ext)?.slice(0, 4);
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  if (!code || !/^[A-Z0-9]{4}$/.test(code)) return null;
  return { region: nintendo(code[3]), serial: code };
}

function detect(game, info) {
  const r = regionOf(game, info);
  if (!r || !r.region) return r ? { ...r, langs: null } : null;
  let langs = r.region === 'INT' ? null : REGION_LANGS[r.region] || null;
  if (langs && game.console === 'GAMECUBE' && r.region === 'USA') langs = ['en']; // les sorties GameCube US sont en anglais
  const allowed = CONSOLE_LANGS[game.console];
  if (langs && allowed) langs = langs.filter(l => allowed.includes(l));
  return { ...r, langs: langs && langs.length ? langs : null };
}

module.exports = { detect, sonyRegion, nintendo, REGION_LANGS, REGION_NAMES };
