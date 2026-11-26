// Patchs 60 images/s pour le moteur Arcadia, tirés de bases communautaires publiques :
//  - PSP : CWCheat-Database-Plus (cheat.db, un bloc par numéro de série) → fichier .ini lu par PPSSPP
//  - PS1 : chtdb de DuckStation (patches/ et cheats/<série>.cht, codes GameShark) → codes passés au cœur
// Seuls les codes « 60 FPS » stables sont gardés (pas les versions bêta, expérimentales, « à activer après… »).

const PSP_DB_URL = 'https://raw.githubusercontent.com/Saramagrean/CWCheat-Database-Plus-/master/cheat.db';
const PS1_RAW = 'https://raw.githubusercontent.com/duckstation/chtdb/master';

const IS_60 = /60\s*fps|fps\s*60/i;
const UNSAFE = /disable|restore|demo|alpha|beta|experimental|after|in-game only|crash|bug|test/i;

const dashSerial = s => { const m = /^([A-Z]{4})-?(\d{5})$/i.exec(String(s || '').trim()); return m ? `${m[1].toUpperCase()}-${m[2]}` : null; };
const plainSerial = s => (dashSerial(s) || '').replace('-', '');

// cheat.db → Map(série sans tiret → { title, cheats: [{ name, lines }] })
function parsePspDb(text) {
  const out = new Map();
  for (const block of String(text).split(/^_S /m).slice(1)) {
    const id = plainSerial(block.slice(0, block.indexOf('\n')).trim());
    if (!id) continue;
    const title = (/^_G (.*)$/m.exec(block) || [])[1] || '';
    const cheats = []; let cur = null;
    for (const raw of block.split(/\r?\n/)) {
      const c = /^_C[01]\s+(.*)$/.exec(raw);
      if (c) { cur = c[1].trim().startsWith('↑') ? null : { name: c[1].trim(), lines: [] }; if (cur) cheats.push(cur); continue; }
      if (cur && /^_[LMN]\s/.test(raw)) cur.lines.push(raw.trim());
    }
    if (!out.has(id)) out.set(id, { title, cheats });
  }
  return out;
}
// Le meilleur code 60 images/s d'un jeu PSP (ou null)
function pickPsp60(entry) {
  if (!entry) return null;
  const ok = entry.cheats.filter(c => IS_60.test(c.name) && !UNSAFE.test(c.name) && c.lines.length);
  return ok.find(c => /always|fixed/i.test(c.name)) || ok[0] || null;
}
// Fichier de triches PPSSPP (<mémoire>/PSP/Cheats/<SÉRIE>.ini) avec le code activé (_C1) ou non (_C0)
function pspIni(serial, title, cheat, on) {
  return [`_S ${dashSerial(serial)}`, `_G ${title || ''}`, `_C${on ? 1 : 0} ${cheat.name} (Arcadia)`, ...cheat.lines, ''].join('\n');
}

// .cht de DuckStation → [{ name, type, options, codes: ['80012345 0001', …] }]
function parseCht(text) {
  const out = []; let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^\[(.+)\]$/.exec(line);
    if (h) { cur = { name: h[1], type: '', options: false, codes: [] }; out.push(cur); continue; }
    if (!cur || !line || line.startsWith('#') || line.startsWith(';')) continue;
    const kv = /^(\w+)\s*=\s*(.*)$/.exec(line);
    if (kv) { if (/^type$/i.test(kv[1])) cur.type = kv[2]; if (/^option/i.test(kv[1])) cur.options = true; continue; }
    if (/^[0-9A-F]{8}\s+[0-9A-F]{4,8}$/i.test(line)) cur.codes.push(line.toUpperCase());
  }
  return out;
}
// Codes 60 images/s d'un jeu PS1, au format libretro (une ligne « code+code+… » par patch)
function ps1Sixty(...chtTexts) {
  const lines = [];
  for (const t of chtTexts) {
    for (const s of parseCht(t)) {
      if (!IS_60.test(s.name) || UNSAFE.test(s.name) || s.options || !/gameshark/i.test(s.type || 'gameshark') || !s.codes.length) continue;
      lines.push(`# ${s.name}`, s.codes.join('+'));
      return lines; // un seul patch 60 images/s par jeu
    }
  }
  return lines;
}

// Les 15 jeux les plus joués en émulation, par console (patchs préparés même s'ils ne sont pas dans la bibliothèque)
const TOP = {
  SWITCH: ['01007EF00011E000', '0100F2C0115B6000', '0100000000010000', '0100152000022000', '01006A800016E000', '01006F8002326000', '0100A3D008C5C000',
    '01008F6008C5E000', '01001F5010DFA000', '010015100B514000', '010074F013262000', '010055D009F78000', '010093801237C000', '0100DCA0064A6000', '01006BB00C6F0000'],
  PS1: ['SCUS-94163', 'SLUS-00892', 'SLUS-01251', 'SLUS-00594', 'SLUS-00748', 'SCUS-94900', 'SCUS-94426', 'SCUS-94228', 'SLUS-00067', 'SLUS-00402',
    'SCUS-94455', 'SLUS-00707', 'SLUS-00860', 'SCUS-94221', 'SLUS-01041'],
  PSP: ['UCUS-98653', 'UCUS-98737', 'ULUS-10391', 'ULUS-10336', 'ULUS-10041', 'ULUS-10160', 'ULUS-10466', 'ULUS-10505', 'ULUS-10512', 'ULUS-10509',
    'ULUS-10566', 'ULUS-10202', 'ULUS-10025', 'UCUS-98751', 'ULUS-10490']
};

module.exports = { PSP_DB_URL, PS1_RAW, TOP, dashSerial, plainSerial, parsePspDb, pickPsp60, pspIni, parseCht, ps1Sixty };
