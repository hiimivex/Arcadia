// Icône + titre des jeux Switch (.nsp / .xci), lus dans le jeu lui-même.
// Les jeux Switch sont chiffrés : il faut les clés de l'utilisateur (prod.keys, déjà
// installées pour Eden / Lichii). Sans clés, Arcadia passe par la base en ligne (switchdb.js).
//
// Chemin : conteneur (PFS0 pour .nsp, HFS0 "secure" pour .xci) -> NCA de type Control
// -> en-tête AES-XTS (header_key) -> clé de section (key area ou ticket) -> RomFS AES-CTR
// -> control.nacp (titres) + icon_<Langue>.dat (JPEG).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------- clés
function parseKeys(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([0-9a-z_]+)\s*[=:]\s*([0-9a-fA-F]+)\s*$/i);
    if (m) out[m[1].toLowerCase()] = Buffer.from(m[2], 'hex');
  }
  return out;
}

// Cherche prod.keys / title.keys dans les dossiers d'Eden et Lichii (AppData ou portable).
function loadKeys(dirs) {
  const keys = { prod: null, title: {} };
  for (const d of dirs) {
    try {
      if (!keys.prod) {
        const p = ['prod.keys', 'keys.txt'].map(f => path.join(d, f)).find(f => fs.existsSync(f));
        if (p) { const k = parseKeys(fs.readFileSync(p, 'utf8')); if (k.header_key) keys.prod = k; }
      }
      const t = path.join(d, 'title.keys');
      if (fs.existsSync(t)) {
        for (const [rid, key] of Object.entries(parseKeys(fs.readFileSync(t, 'utf8')))) keys.title[rid] = key;
      }
    } catch { /* dossier illisible */ }
  }
  return keys.prod ? keys : null;
}

// ---------------------------------------------------------------- lecture
function readAt(fd, off, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, off);
  return n === len ? b : b.subarray(0, n);
}
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

// PFS0 (.nsp) et HFS0 (.xci) : { nom: { off absolu, size } }
function readPartition(fd, base, kind) {
  const h = readAt(fd, base, 0x10);
  if (h.toString('ascii', 0, 4) !== kind) return null;
  const count = u32(h, 4), strSize = u32(h, 8);
  if (count > 4096) return null;
  const esz = kind === 'PFS0' ? 0x18 : 0x40;
  const meta = readAt(fd, base + 0x10, count * esz + strSize);
  const strs = meta.subarray(count * esz);
  const data = base + 0x10 + count * esz + strSize;
  const files = {};
  for (let i = 0; i < count; i++) {
    const e = i * esz;
    const nOff = u32(meta, e + 0x10);
    const name = strs.toString('utf8', nOff, strs.indexOf(0, nOff) < 0 ? strs.length : strs.indexOf(0, nOff));
    files[name] = { off: data + u64(meta, e), size: u64(meta, e + 8) };
  }
  return files;
}

function xciSecure(fd) {
  for (const start of [0, 0x1000]) { // certains dumps commencent par la zone de clé de la cartouche
    const h = readAt(fd, start + 0x100, 0x40);
    if (h.toString('ascii', 0, 4) !== 'HEAD') continue;
    const root = readPartition(fd, start + u64(h, 0x30), 'HFS0');
    if (!root?.secure) return null;
    return readPartition(fd, root.secure.off, 'HFS0');
  }
  return null;
}

// ---------------------------------------------------------------- crypto NCA
function xtsDecrypt(key, data, sector0) {
  const out = Buffer.alloc(data.length);
  for (let s = 0; s * 0x200 < data.length; s++) {
    const tweak = Buffer.alloc(16);
    tweak.writeBigUInt64BE(BigInt(sector0 + s), 8); // tweak Nintendo : numéro de secteur big-endian
    const d = crypto.createDecipheriv('aes-128-xts', key, tweak);
    d.setAutoPadding(false);
    Buffer.concat([d.update(data.subarray(s * 0x200, (s + 1) * 0x200)), d.final()]).copy(out, s * 0x200);
  }
  return out;
}
function ecb(key, data) {
  const d = crypto.createDecipheriv('aes-128-ecb', key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}
const hex2 = n => n.toString(16).padStart(2, '0');

// Ouvre une NCA : renvoie un lecteur de la section RomFS déchiffrée, ou null.
function openNca(fd, nca, keys, tickets) {
  const hdr = xtsDecrypt(keys.prod.header_key, readAt(fd, nca.off, 0xC00), 0);
  if (hdr.toString('ascii', 0x200, 0x204) !== 'NCA3') return null;
  const info = {
    type: hdr[0x205],
    programId: hdr.readBigUInt64LE(0x210).toString(16).padStart(16, '0').toUpperCase()
  };
  const gen = Math.max(hdr[0x206], hdr[0x220]);
  const gi = hex2(gen > 0 ? gen - 1 : 0);
  const rights = hdr.subarray(0x230, 0x240);
  let ctrKey;
  if (rights.some(b => b)) {
    const rid = rights.toString('hex');
    const enc = tickets[rid] || keys.title[rid];
    const kek = keys.prod['titlekek_' + gi];
    if (!enc || !kek) return { ...info, missing: 'titlekey' };
    ctrKey = ecb(kek, enc);
  } else {
    const kaek = keys.prod[['key_area_key_application_', 'key_area_key_ocean_', 'key_area_key_system_'][hdr[0x207]] + gi];
    if (!kaek) return { ...info, missing: 'key_area_key_' + gi };
    ctrKey = ecb(kaek, hdr.subarray(0x300, 0x340)).subarray(0x20, 0x30);
  }
  for (let i = 0; i < 4; i++) {
    const start = u32(hdr, 0x240 + i * 0x10) * 0x200;
    const end = u32(hdr, 0x244 + i * 0x10) * 0x200;
    if (!end) continue;
    const fsh = hdr.subarray(0x400 + i * 0x200, 0x600 + i * 0x200);
    if (fsh[2] !== 0 || fsh[3] !== 3 || fsh[4] !== 3) continue; // RomFS + IVFC + AES-CTR
    if (fsh.toString('ascii', 8, 12) !== 'IVFC') continue;
    const romfs = start + u64(fsh, 0x8 + 0x10 + 5 * 0x18);
    const upper = Buffer.from(fsh.subarray(0x140, 0x148)).reverse();
    const read = (off, len) => { // off relatif au début du RomFS
      const abs = romfs + off;
      const a = abs & ~0xF;
      const iv = Buffer.alloc(16);
      upper.copy(iv, 0);
      iv.writeBigUInt64BE(BigInt(a) >> 4n, 8);
      const d = crypto.createDecipheriv('aes-128-ctr', ctrKey, iv);
      const enc = readAt(fd, nca.off + a, len + (abs - a));
      return Buffer.concat([d.update(enc), d.final()]).subarray(abs - a, abs - a + len);
    };
    return { ...info, read };
  }
  return info;
}

function romfsFiles(read) {
  const h = read(0, 0x50);
  if (u64(h, 0) !== 0x50) return null;
  const metaOff = u64(h, 0x38), metaSize = u64(h, 0x40), dataOff = u64(h, 0x48);
  if (metaSize > 0x100000) return null;
  const meta = read(metaOff, metaSize);
  const files = {};
  for (let o = 0; o + 0x20 <= meta.length;) {
    const nameLen = u32(meta, o + 0x1C);
    const name = meta.toString('utf8', o + 0x20, o + 0x20 + nameLen);
    files[name] = { off: dataOff + u64(meta, o + 8), size: u64(meta, o + 0x10) };
    o += 0x20 + ((nameLen + 3) & ~3);
  }
  return files;
}

// Ordre des langues de control.nacp
const LANGS = ['AmericanEnglish', 'BritishEnglish', 'Japanese', 'French', 'German', 'LatinAmericanSpanish',
  'Spanish', 'Italian', 'Dutch', 'CanadianFrench', 'Portuguese', 'Russian', 'Korean', 'TraditionalChinese',
  'SimplifiedChinese', 'BrazilianPortuguese'];
const PREF = ['French', 'CanadianFrench', 'BritishEnglish', 'AmericanEnglish'];

function nacpTitle(nacp) {
  const at = i => nacp.toString('utf8', i * 0x300, i * 0x300 + 0x200).replace(/\0.*$/s, '').trim();
  for (const l of PREF) { const t = at(LANGS.indexOf(l)); if (t) return t; }
  for (let i = 0; i < 16; i++) { const t = at(i); if (t) return t; }
  return null;
}

// -> { icon: Buffer JPEG, iconExt: 'jpg', title, titleId } | { titleId, needKeys } | null
function switchInfo(file, keys) {
  if (!keys) return null;
  const ext = path.extname(file).slice(1).toLowerCase();
  const fd = fs.openSync(file, 'r');
  try {
    const part = ext === 'xci' ? xciSecure(fd) : ext === 'nsp' ? readPartition(fd, 0, 'PFS0') : null;
    if (!part) return null;
    const tickets = {};
    for (const [name, f] of Object.entries(part)) {
      if (!name.endsWith('.tik') || f.size < 0x2C0) continue;
      const t = readAt(fd, f.off, 0x2C0);
      tickets[t.subarray(0x2A0, 0x2B0).toString('hex')] = t.subarray(0x180, 0x190);
    }
    let titleId = null, missing = null;
    for (const [name, f] of Object.entries(part)) {
      if (!name.endsWith('.nca') || name.endsWith('.cnmt.nca')) continue;
      const n = openNca(fd, f, keys, tickets);
      if (!n || n.type !== 2) continue; // 2 = Control
      titleId = n.programId;
      if (!n.read) { missing = n.missing; continue; }
      const files = romfsFiles(n.read);
      if (!files?.['control.nacp']) continue;
      const nacp = n.read(files['control.nacp'].off, Math.min(files['control.nacp'].size || 0x4000, 0x4000));
      const title = nacpTitle(nacp);
      let langs = null; try { langs = require('./langs').fromNacp(nacp); } catch { /* */ }
      const iconName = PREF.map(l => `icon_${l}.dat`).find(x => files[x]) || Object.keys(files).find(x => /^icon_.*\.dat$/.test(x));
      const icon = iconName && files[iconName].size < 0x80000 ? n.read(files[iconName].off, files[iconName].size) : null;
      return { title, titleId, langs, icon: icon && icon[0] === 0xFF && icon[1] === 0xD8 ? icon : null, iconExt: 'jpg' };
    }
    return titleId ? { titleId, needKeys: missing } : null;
  } finally { fs.closeSync(fd); }
}

// Identifiant du jeu SANS clés : nom du ticket (.tik) ou fichier .cnmt.xml en clair dans les .nsp.
// -> { titleId (jeu de base), patch: true si c'est une mise à jour / un DLC } | null
function switchIdNoKeys(file) {
  if (path.extname(file).toLowerCase() !== '.nsp') return null;
  const fd = fs.openSync(file, 'r');
  try {
    const part = readPartition(fd, 0, 'PFS0');
    if (!part) return null;
    let id = null, type = null;
    for (const [name, f] of Object.entries(part)) {
      if (name.endsWith('.cnmt.xml') && f.size < 0x100000) {
        const x = readAt(fd, f.off, f.size).toString('utf8');
        const m = x.match(/<Id>\s*0x([0-9a-fA-F]{16})\s*<\/Id>/);
        if (m) { id = m[1]; type = (x.match(/<Type>\s*(\w+)\s*<\/Type>/) || [])[1] || null; break; }
      }
      const t = name.match(/^([0-9a-fA-F]{16})[0-9a-fA-F]{16}\.tik$/);
      if (t && !id) id = t[1];
    }
    if (!id) return null;
    id = id.toUpperCase();
    const patch = (type && type !== 'Application') || !/000$/.test(id);
    return { titleId: id.slice(0, 13) + '000', patch };
  } finally { fs.closeSync(fd); }
}

module.exports = { parseKeys, loadKeys, switchInfo, switchIdNoKeys, readPartition, nacpTitle, LANGS };
