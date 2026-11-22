// Extraction des icônes et titres intégrés aux ROM, sans connexion.
//   DS   : bannière 32x32 + titre (français si dispo)
//   3DS  : SMDH 48x48 + titre (.3ds / .cci / .cxi non chiffrés, .cia avec section meta)
//   PSP  : ICON0.PNG + PARAM.SFO dans l'ISO
//   PS3 / PS4 (jeux en dossier) : ICON0.PNG + PARAM.SFO
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { IsoReader, parseSfo, readAt } = require('./iso');

// ---------- encodeur PNG minimal ----------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

const clean = s => (s || '').replace(/\0+/g, '').replace(/\s+/g, ' ').trim();

// ---------- DS ----------
function ndsInfo(fd) {
  const h = readAt(fd, 0, 0x200);
  if (h.length < 0x200) return null;
  const off = h.readUInt32LE(0x68);
  if (!off) return null;
  const b = readAt(fd, off, 0x840);
  if (b.length < 0x840) return null;
  const pal = [];
  for (let i = 0; i < 16; i++) {
    const v = b.readUInt16LE(0x220 + i * 2);
    pal.push([(v & 31) * 255 / 31, ((v >> 5) & 31) * 255 / 31, ((v >> 10) & 31) * 255 / 31, i === 0 ? 0 : 255]);
  }
  const rgba = Buffer.alloc(32 * 32 * 4);
  for (let t = 0; t < 16; t++) {
    const tx = t % 4, ty = Math.floor(t / 4);
    for (let i = 0; i < 64; i++) {
      const byte = b[0x20 + t * 32 + (i >> 1)];
      const idx = i & 1 ? byte >> 4 : byte & 15;
      const x = tx * 8 + (i % 8), y = ty * 8 + Math.floor(i / 8);
      const c = pal[idx];
      rgba[(y * 32 + x) * 4] = c[0]; rgba[(y * 32 + x) * 4 + 1] = c[1];
      rgba[(y * 32 + x) * 4 + 2] = c[2]; rgba[(y * 32 + x) * 4 + 3] = c[3];
    }
  }
  // 0x440 = français, 0x340 = anglais. Dernière ligne = éditeur.
  let title = null;
  for (const o of [0x440, 0x340]) {
    const lines = b.toString('utf16le', o, o + 0x100).replace(/\0+$/g, '').split('\n').map(clean).filter(Boolean);
    if (lines.length) { title = (lines.length > 1 ? lines.slice(0, -1) : lines).join(' - '); break; }
  }
  return { icon: encodePNG(32, 32, rgba), title, pixel: true };
}

// ---------- 3DS ----------
function smdhInfo(b) {
  if (!b || b.length < 0x36c0 || b.toString('ascii', 0, 4) !== 'SMDH') return null;
  let title = null;
  for (const lang of [2, 1]) { // 2 = français, 1 = anglais
    const t = clean(b.toString('utf16le', 8 + lang * 0x200 + 0x80, 8 + lang * 0x200 + 0x180));
    const s = clean(b.toString('utf16le', 8 + lang * 0x200, 8 + lang * 0x200 + 0x80));
    if (t || s) { title = s || t; break; }
  }
  const rgba = Buffer.alloc(48 * 48 * 4);
  for (let i = 0; i < 48 * 48; i++) {
    const tile = Math.floor(i / 64), m = i % 64;
    const x = (tile % 6) * 8 + ((m & 1) | ((m >> 1) & 2) | ((m >> 2) & 4));
    const y = Math.floor(tile / 6) * 8 + (((m >> 1) & 1) | ((m >> 2) & 2) | ((m >> 3) & 4));
    const v = b.readUInt16LE(0x24c0 + i * 2);
    const p = (y * 48 + x) * 4;
    rgba[p] = ((v >> 11) & 31) * 255 / 31; rgba[p + 1] = ((v >> 5) & 63) * 255 / 63;
    rgba[p + 2] = (v & 31) * 255 / 31; rgba[p + 3] = 255;
  }
  let langs = null; try { langs = require('./langs').fromSmdh(b); } catch { /* */ }
  return { icon: encodePNG(48, 48, rgba), title, langs };
}

function ncchIcon(fd, base) {
  const h = readAt(fd, base, 0x200);
  if (h.length < 0x200 || h.toString('ascii', 0x100, 0x104) !== 'NCCH') return null;
  const noCrypto = h[0x188 + 7] & 0x4;
  if (!noCrypto) return { encrypted: true };
  const exefs = base + h.readUInt32LE(0x1a0) * 0x200;
  const eh = readAt(fd, exefs, 0x200);
  for (let i = 0; i < 10; i++) {
    const name = eh.toString('ascii', i * 16, i * 16 + 8).replace(/\0+$/, '');
    if (name === 'icon') {
      return smdhInfo(readAt(fd, exefs + 0x200 + eh.readUInt32LE(i * 16 + 8), eh.readUInt32LE(i * 16 + 12)));
    }
  }
  return null;
}

function n3dsInfo(fd, ext) {
  const align = n => Math.ceil(n / 64) * 64;
  if (ext === 'cia') {
    const h = readAt(fd, 0, 0x20);
    if (h.length < 0x20) return null;
    const hdr = h.readUInt32LE(0), cert = h.readUInt32LE(8), tik = h.readUInt32LE(12), tmd = h.readUInt32LE(16);
    const meta = h.readUInt32LE(20), content = Number(h.readBigUInt64LE(24));
    const contentOff = align(hdr) + align(cert) + align(tik) + align(tmd);
    if (meta >= 0x400 + 0x36c0) {
      const r = smdhInfo(readAt(fd, contentOff + align(content) + 0x400, 0x36c0));
      if (r) return r;
    }
    const r = ncchIcon(fd, contentOff);
    return r && !r.encrypted ? r : null;
  }
  const h = readAt(fd, 0, 0x200);
  if (h.toString('ascii', 0x100, 0x104) === 'NCSD') {
    const r = ncchIcon(fd, h.readUInt32LE(0x120) * 0x200);
    return r && !r.encrypted ? r : null;
  }
  const r = ncchIcon(fd, 0);
  return r && !r.encrypted ? r : null;
}

// ---------- PSP ----------
function pspInfo(fd) {
  const iso = new IsoReader(fd);
  if (!iso.ok) return null;
  const icon = iso.readFile('PSP_GAME/ICON0.PNG');
  const sfo = parseSfo(iso.readFile('PSP_GAME/PARAM.SFO'));
  if (!icon && !sfo) return null;
  return { icon: icon || null, title: sfo ? clean(sfo.TITLE) : null, serial: sfo?.DISC_ID || null };
}

// ---------- PS3 / PS4 en dossier ----------
function folderGameInfo(gamePath, consoleId) {
  // PS3 : <jeu>/PS3_GAME/USRDIR/EBOOT.BIN   PS4 : <jeu>/eboot.bin + sce_sys/
  const tryRead = p => { try { return fs.readFileSync(p); } catch { return null; } };
  let root = path.dirname(gamePath);
  if (consoleId === 'PS3') {
    root = path.resolve(gamePath, '..', '..');
    const sfo = parseSfo(tryRead(path.join(root, 'PARAM.SFO')));
    return { icon: tryRead(path.join(root, 'ICON0.PNG')), title: sfo ? clean(sfo.TITLE) : null };
  }
  if (consoleId === 'PS4') {
    const sfo = parseSfo(tryRead(path.join(root, 'sce_sys', 'param.sfo')));
    return { icon: tryRead(path.join(root, 'sce_sys', 'icon0.png')), title: sfo ? clean(sfo.TITLE) : null };
  }
  return null;
}

// Point d'entrée : { icon: Buffer PNG | null, title: string | null, pixel?: bool } ou null
function extractInfo(game) {
  const ext = path.extname(game.path).slice(1).toLowerCase();
  try {
    if ((game.console === 'PS3' || game.console === 'PS4') && /eboot\.bin$/i.test(game.path)) {
      return folderGameInfo(game.path, game.console);
    }
    const fd = fs.openSync(game.path, 'r');
    try {
      if (game.console === 'DS' && ext === 'nds') return ndsInfo(fd);
      if (game.console === '3DS' && ['3ds', 'cci', 'cxi', 'cia'].includes(ext)) return n3dsInfo(fd, ext);
      if (game.console === 'PSP' && ext === 'iso') return pspInfo(fd);
      if (game.console === 'PS3' && ext === 'iso') {
        const iso = new IsoReader(fd);
        if (!iso.ok) return null;
        const sfo = parseSfo(iso.readFile('PS3_GAME/PARAM.SFO'));
        return { icon: iso.readFile('PS3_GAME/ICON0.PNG'), title: sfo ? clean(sfo.TITLE) : null };
      }
    } finally { fs.closeSync(fd); }
  } catch { /* fichier illisible : pas d'icône */ }
  return null;
}

module.exports = { extractInfo, encodePNG, ndsInfo, smdhInfo };
