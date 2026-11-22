// Lecture / écriture ciblée des fichiers de réglages des émulateurs.
// Principe : on ne réécrit QUE les lignes des réglages modifiés, tout le reste du fichier
// (commentaires, ordre, réglages inconnus) est conservé à l'identique.
// Formats : qtini (Eden, Lichii, Azahar), ini, toml, yaml, bml, xml, json.
const fs = require('fs');
const path = require('path');

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- INI (et INI Qt)
function iniFind(lines, section) {
  const start = lines.findIndex(l => l.trim() === `[${section}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^\s*\[.*\]\s*$/.test(lines[i])) { end = i; break; }
  return { start, end };
}
function iniGet(text, section, key) {
  const lines = text.split(/\r?\n/);
  const sec = iniFind(lines, section);
  if (!sec) return undefined;
  const re = new RegExp(`^\\s*${esc(key)}\\s*=(.*)$`);
  for (let i = sec.start + 1; i < sec.end; i++) {
    const m = lines[i].match(re);
    if (m) return m[1].trim();
  }
  return undefined;
}
function iniSet(text, section, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const spaced = /^\s*[^=\s[;#]+ = /m.test(text);
  let sec = iniFind(lines, section);
  if (!sec) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length) lines.push('');
    lines.push(`[${section}]`);
    sec = { start: lines.length - 1, end: lines.length };
  }
  const re = new RegExp(`^(\\s*${esc(key)}\\s*=)(\\s*)(.*)$`);
  for (let i = sec.start + 1; i < sec.end; i++) {
    const m = lines[i].match(re);
    if (m) { lines[i] = `${m[1]}${m[2]}${value}`; return lines.join(eol); }
  }
  // insertion à la fin de la section (avant les lignes vides finales)
  let at = sec.end;
  while (at > sec.start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, spaced ? `${key} = ${value}` : `${key}=${value}`);
  return lines.join(eol);
}

// INI Qt (QSettings) : "nom\default=false" + "nom=valeur". On garde \default cohérent.
function qtGet(text, section, key, def) {
  const isDef = iniGet(text, section, `${key}\\default`);
  if (isDef === 'true') return def;
  const v = iniGet(text, section, key);
  return v === undefined ? def : v.replace(/^"(.*)"$/, '$1');
}
function qtSet(text, section, key, value, def) {
  let t = iniSet(text, section, `${key}\\default`, String(value) === String(def) ? 'true' : 'false');
  t = iniSet(t, section, key, value);
  return t;
}

// ---------------------------------------------------------------- TOML (sections [a.b], clé = valeur)
function tomlLiteral(v) {
  if (v && typeof v === 'object' && 'raw' in v) return String(v.raw);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return JSON.stringify(String(v));
}
function tomlParse(raw) {
  const s = raw.trim();
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^".*"$/.test(s) || /^'.*'$/.test(s)) return s.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
function tomlGet(text, section, key) {
  const v = iniGet(text.replace(/\s+#.*$/gm, ''), section, key);
  return v === undefined ? undefined : tomlParse(v);
}
function tomlSet(text, section, key, value) {
  // les commentaires en fin de ligne ("value # commentaire") sont conservés
  const lines = text.split(/\r?\n/);
  const sec = iniFind(lines, section);
  if (sec) {
    const re = new RegExp(`^(\\s*${esc(key)}\\s*=\\s*)([^#]*?)(\\s*#.*)?$`);
    for (let i = sec.start + 1; i < sec.end; i++) {
      const m = lines[i].match(re);
      if (m) { lines[i] = `${m[1]}${tomlLiteral(value)}${m[3] || ''}`; return lines.join(text.includes('\r\n') ? '\r\n' : '\n'); }
    }
  }
  const t = iniSet(text, section, key, tomlLiteral(value));
  return /^\s*\w+ = /m.test(t) ? t : t.replace(new RegExp(`^${esc(key)}=`, 'm'), `${key} = `);
}

// ---------------------------------------------------------------- YAML simple (RPCS3 : 2 niveaux, Vita3K : plat)
function yamlBlock(lines, section) {
  if (!section) return { start: -1, end: lines.length, indent: '' };
  const start = lines.findIndex(l => l === `${section}:` || l.startsWith(`${section}: `) && l.trim().endsWith(':'));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].trim() && !/^\s/.test(lines[i])) { end = i; break; }
  const child = lines.slice(start + 1, end).find(l => l.trim());
  return { start, end, indent: child ? child.match(/^\s*/)[0] : '  ' };
}
function yamlGet(text, section, key) {
  const lines = text.split(/\r?\n/);
  const b = yamlBlock(lines, section);
  if (!b) return undefined;
  for (let i = b.start + 1; i < b.end; i++) {
    const l = lines[i];
    if (!l.startsWith(b.indent) || /^\s/.test(l.slice(b.indent.length))) continue;
    const m = l.slice(b.indent.length).match(new RegExp(`^${esc(key)}:\\s*(.*)$`));
    if (m) return tomlParse(m[1].replace(/^"(.*)"$/, '$1'));
  }
  return undefined;
}
function yamlSet(text, section, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const out = typeof value === 'boolean' ? String(value) : String(value);
  let b = yamlBlock(lines, section);
  if (!b) { lines.push(`${section}:`); b = { start: lines.length - 1, end: lines.length, indent: '  ' }; }
  for (let i = b.start + 1; i < b.end; i++) {
    const l = lines[i];
    if (!l.startsWith(b.indent) || /^\s/.test(l.slice(b.indent.length))) continue;
    if (new RegExp(`^${esc(key)}:`).test(l.slice(b.indent.length))) { lines[i] = `${b.indent}${key}: ${out}`; return lines.join(eol); }
  }
  let at = b.end;
  while (at > b.start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, `${b.indent}${key}: ${out}`);
  return lines.join(eol);
}

// ---------------------------------------------------------------- BML (ares) : "Section" puis "  Clé: valeur"
function bmlGet(text, section, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l === section);
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
    const m = lines[i].match(new RegExp(`^  ${esc(key)}:\\s*(.*)$`));
    if (m) return tomlParse(m[1]);
  }
  return undefined;
}
function bmlSet(text, section, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  let start = lines.findIndex(l => l === section);
  if (start < 0) { lines.push(section); start = lines.length - 1; }
  let i = start + 1;
  for (; i < lines.length && /^\s/.test(lines[i]); i++) {
    if (new RegExp(`^  ${esc(key)}:`).test(lines[i])) { lines[i] = `  ${key}: ${value}`; return lines.join(eol); }
  }
  lines.splice(i, 0, `  ${key}: ${value}`);
  return lines.join(eol);
}

// ---------------------------------------------------------------- XML (Cemu) : <content><Graphic><api>1</api>…
function xmlGet(text, section, key) {
  const sec = text.match(new RegExp(`<${esc(section)}>([\\s\\S]*?)</${esc(section)}>`));
  if (!sec) return undefined;
  const m = sec[1].match(new RegExp(`<${esc(key)}>([^<]*)</${esc(key)}>`));
  return m ? tomlParse(m[1]) : undefined;
}
function xmlSet(text, section, key, value) {
  if (!text.trim()) text = '<?xml version="1.0" encoding="UTF-8"?>\n<content>\n</content>\n';
  const v = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  const secRe = new RegExp(`(<${esc(section)}>)([\\s\\S]*?)(\\s*</${esc(section)}>)`);
  if (!secRe.test(text)) text = text.replace(/(\s*)<\/content>/, `\n    <${section}>\n    </${section}>$1</content>`);
  return text.replace(secRe, (all, open, body, close) => {
    const keyRe = new RegExp(`<${esc(key)}>[^<]*</${esc(key)}>`);
    if (keyRe.test(body)) return open + body.replace(keyRe, `<${key}>${v}</${key}>`) + close;
    return `${open}${body}\n        <${key}>${v}</${key}>${close}`;
  });
}

// ---------------------------------------------------------------- JSON (chemin "A.B.c")
function jsonGet(text, section, key) {
  try {
    let o = JSON.parse(text || '{}');
    for (const p of [...(section ? section.split('.') : []), key]) { if (o == null) return undefined; o = o[p]; }
    return o;
  } catch { return undefined; }
}
function jsonSet(text, section, key, value) {
  const o = text.trim() ? JSON.parse(text) : {};
  let cur = o;
  for (const p of section ? section.split('.') : []) { if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}; cur = cur[p]; }
  cur[key] = value;
  const indent = (text.match(/\n( +|\t)"/) || [null, '  '])[1];
  return JSON.stringify(o, null, indent) + (text.endsWith('\n') ? '\n' : '');
}

// ---------------------------------------------------------------- API commune
const ENGINES = {
  qtini: { get: (t, s, k, d) => qtGet(t, s, k, d), set: (t, s, k, v, d) => qtSet(t, s, k, v, d) },
  ini: { get: (t, s, k) => { const v = iniGet(t, s, k); return v === undefined ? undefined : v.replace(/^"(.*)"$/, '$1'); }, set: (t, s, k, v) => iniSet(t, s, k, v) },
  toml: { get: tomlGet, set: tomlSet },
  yaml: { get: yamlGet, set: yamlSet },
  bml: { get: bmlGet, set: bmlSet },
  xml: { get: xmlGet, set: xmlSet },
  json: { get: jsonGet, set: jsonSet }
};

// field.key = "Section/clé" (le dernier "/" sépare la section de la clé ; section vide autorisée)
function splitKey(k) {
  const i = k.lastIndexOf('/');
  return i < 0 ? ['', k] : [k.slice(0, i), k.slice(i + 1)];
}

function readValues(format, text, fields) {
  const eng = ENGINES[format];
  const out = {};
  for (const f of fields) {
    const [s, k] = splitKey(f.key);
    let raw = eng.get(text, s, k, f.default);
    if (raw === undefined) raw = f.default;
    out[f.key] = f.decode ? f.decode(raw) : normalize(f, raw);
  }
  return out;
}
function normalize(f, raw) {
  if (f.type === 'bool') return raw === true || raw === 'true' || raw === 1 || raw === '1';
  if ((f.type === 'int' || f.type === 'slider') && raw !== undefined && raw !== '') return Number(raw);
  if (f.type === 'select' && f.options) {
    const hit = f.options.find(o => String(o[0]) === String(raw));
    return hit ? hit[0] : raw;
  }
  return raw;
}

function writeValues(format, text, fields, changes) {
  const eng = ENGINES[format];
  let t = text;
  for (const f of fields) {
    if (!(f.key in changes)) continue;
    const [s, k] = splitKey(f.key);
    let v = changes[f.key];
    if (f.encodeLike && typeof eng.get(t, s, k, f.default) === 'number') v = f.encodeLike.indexOf(v);
    else if (f.encode) v = f.encode(v);
    else if (format === 'qtini' || format === 'ini' || format === 'bml') {
      if (f.type === 'bool') v = f.boolAs ? f.boolAs[v ? 1 : 0] : (v ? 'true' : 'false');
      else v = String(v);
    } else if (f.type === 'bool') v = !!v;
    else if ((f.type === 'int' || f.type === 'slider') && typeof v !== 'number') v = Number(v);
    t = eng.set(t, s, k, v, f.default);
  }
  return t;
}

// Écrit le fichier avec une sauvegarde unique (.arcadia.bak) avant la toute première modification.
function saveFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(file + '.arcadia.bak')) fs.copyFileSync(file, file + '.arcadia.bak');
  const tmp = file + '.arcadia.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

module.exports = { readValues, writeValues, saveFile, ENGINES, iniGet, iniSet, qtGet, qtSet, tomlSet, yamlSet, xmlSet, jsonSet, bmlSet };
