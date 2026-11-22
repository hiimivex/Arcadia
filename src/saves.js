// Copies automatiques des sauvegardes de jeu (à la fermeture), 10 versions par émulateur et par jeu,
// restauration en un clic, dossier synchronisable (OneDrive / Google Drive) pour le cloud.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeZip, readZip } = require('./ziplite');

const MAX_BYTES = 512 * 1024 * 1024; // garde-fou : on ne copie pas plus de 512 Mo par sauvegarde
const KEEP = 10;

// Dossiers de sauvegarde connus. filter : ne garde que les chemins qui correspondent (évite les jeux installés).
const SAVE_DIRS = {
  eden:   c => [path.join(c.exeDir, 'user', 'nand', 'user', 'save'), path.join(c.appData, 'eden', 'nand', 'user', 'save')],
  lichii: c => [path.join(c.exeDir, 'user', 'nand', 'user', 'save'), path.join(c.appData, 'lichii', 'nand', 'user', 'save')],
  edencli: c => [path.join(c.exeDir, 'user', 'nand', 'user', 'save'), path.join(c.appData, 'eden', 'nand', 'user', 'save')],
  azahar: c => [path.join(c.exeDir, 'user', 'sdmc', 'Nintendo 3DS'), path.join(c.appData, 'Azahar', 'sdmc', 'Nintendo 3DS')],
  ppsspp: c => [path.join(c.exeDir, 'memstick', 'PSP', 'SAVEDATA'), path.join(c.documents, 'PPSSPP', 'PSP', 'SAVEDATA')],
  pcsx2:  c => [path.join(c.exeDir, 'memcards'), path.join(c.documents, 'PCSX2', 'memcards')],
  duckstation: c => [path.join(c.exeDir, 'memcards'), path.join(c.documents, 'DuckStation', 'memcards'), path.join(c.localAppData, 'DuckStation', 'memcards')],
  dolphin: c => [path.join(c.exeDir, 'User', 'GC'), path.join(c.exeDir, 'User', 'Wii', 'title'), path.join(c.appData, 'Dolphin Emulator', 'GC'), path.join(c.appData, 'Dolphin Emulator', 'Wii', 'title')],
  rpcs3:  c => [path.join(c.exeDir, 'dev_hdd0', 'home', '00000001', 'savedata')],
  cemu:   c => [path.join(c.exeDir, 'mlc01', 'usr', 'save')],
  xenia:  c => [path.join(c.exeDir, 'content'), path.join(c.documents, 'Xenia', 'content')],
  vita3k: c => [path.join(c.exeDir, 'ux0', 'user', '00', 'savedata'), path.join(c.appData, 'Vita3K', 'Vita3K', 'ux0', 'user', '00', 'savedata')],
  shadps4: c => [path.join(c.exeDir, 'user', 'savedata'), path.join(c.appData, 'shadPS4', 'savedata')],
  flycast: c => [path.join(c.exeDir, 'data')],
  mesen:  c => [path.join(c.exeDir, 'Saves'), path.join(c.documents, 'Mesen2', 'Saves')],
  // moteur intégré : sauvegardes du jeu (carte mémoire émulée) + sauvegardes rapides de CE jeu
  arcadia: c => [c.saves, c.states].filter(Boolean)
};
const FILTERS = {
  azahar: p => /[\\/](data|extdata)[\\/]/i.test(p) && !/[\\/]content[\\/]/i.test(p),
  xenia: p => /[\\/]00000001[\\/]/.test(p),
  flycast: p => /vmu_save/i.test(path.basename(p)),
  dolphin: p => !/[\\/]content[\\/]/i.test(p)
};
// Sauvegardes posées à côté de la ROM (melonDS, mGBA, ares, gopher64…)
const SIDE_EXT = ['sav', 'dsv', 'srm', 'eep', 'fla', 'sra', 'mpk', 'mcd'];

function walk(dir, filter, out = [], budget = { bytes: 0 }) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out, budget);
    else if (e.isFile() && (!filter || filter(p))) {
      const st = fs.statSync(p);
      budget.bytes += st.size;
      if (budget.bytes > MAX_BYTES) throw new Error('Sauvegardes trop volumineuses (> 512 Mo) : copie ignorée.');
      out.push({ path: p, mtime: st.mtimeMs, size: st.size });
    }
  }
  return out;
}

// Ne garder que les sauvegardes d'UN jeu quand l'émulateur les range par identifiant.
//   key = { titleId (Switch, 16 hex), tid3ds (3DS, 8 hex bas), serial (PSP, ex. ULUS10497) }
function gameFilter(emuId, key) {
  if (!key) return null;
  if ((emuId === 'eden' || emuId === 'lichii' || emuId === 'edencli') && key.titleId) { const id = key.titleId.toUpperCase(); return p => p.toUpperCase().includes(id); }
  if (emuId === 'azahar' && key.tid3ds) { const id = key.tid3ds.toLowerCase(); return p => p.toLowerCase().includes(`${path.sep}${id}${path.sep}`) || p.toLowerCase().includes(`/${id}/`); }
  if (emuId === 'ppsspp' && key.serial) { const id = key.serial.toUpperCase(); return p => p.toUpperCase().includes(id); }
  return null;
}

// -> { roots: [dossiers], files: [{ root, path, mtime }] }
function collect(emuId, ctx, romPath, key) {
  let only = gameFilter(emuId, key);
  if (emuId === 'arcadia') { // états rapides : dossier propre au jeu ; carte mémoire PSP : filtrée par numéro de série
    const serial = key && key.serial && key.serial.toUpperCase();
    const stem = romPath ? path.parse(romPath).name.toUpperCase() : null; // DS : <nom de la ROM>.sav
    only = p => (ctx.states && p.startsWith(ctx.states)) || (serial ? p.toUpperCase().includes(serial) : stem ? path.basename(p).toUpperCase().startsWith(stem) : true);
  }
  const roots = [];
  const files = [];
  const budget = { bytes: 0 };
  for (const dir of (SAVE_DIRS[emuId] ? SAVE_DIRS[emuId](ctx) : [])) {
    if (!fs.existsSync(dir) || roots.includes(dir)) continue;
    const base = FILTERS[emuId];
    const list = walk(dir, p => (!base || base(p)) && (!only || only(p)), [], budget);
    if (!list.length) continue;
    roots.push(dir);
    for (const f of list) files.push({ root: roots.length - 1, ...f });
  }
  if (romPath) { // fichiers .sav voisins de la ROM
    const dir = path.dirname(romPath), base = path.basename(romPath, path.extname(romPath)).toLowerCase();
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { /* */ }
    const side = entries.filter(n => n.toLowerCase().startsWith(base) && SIDE_EXT.includes(path.extname(n).slice(1).toLowerCase()));
    if (side.length) {
      roots.push(dir);
      for (const n of side) { const p = path.join(dir, n); const st = fs.statSync(p); files.push({ root: roots.length - 1, path: p, mtime: st.mtimeMs, size: st.size }); }
    }
  }
  return { roots, files };
}

const safe = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'jeu';
const two = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;

// Un dossier par jeu : <saves>\<CONSOLE>\<Jeu>\  (copies .zip + sessions.json)
function gameDir(savesRoot, consoleId, gameTitle) { return path.join(savesRoot, safe(consoleId), safe(gameTitle)); }

function list(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.zip')); } catch { return []; }
  return names.map(n => {
    const m = n.replace(/\.zip$/, '').split('__');
    const d = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/.exec(m[0]);
    const file = path.join(dir, n), mtime = fs.statSync(file).mtimeMs;
    const thumb = fs.existsSync(file + '.png') ? file + '.png' : null; // capture du jeu prise au moment de la copie
    return { file, date: m[0], iso: (d ? new Date(+d[1], d[2] - 1, +d[3], +d[4], +d[5], +d[6]) : new Date(mtime)).toISOString(), machine: m[1] || '', mtime, thumb };
  }).sort((a, b) => b.mtime - a.mtime);
}

// Copie si quelque chose a changé depuis la dernière copie de CE jeu. -> { file } | { skipped }
function backup({ dir, emuId, ctx, romPath, gameTitle, key, force }) {
  const { roots, files } = collect(emuId, ctx, romPath, key);
  if (!files.length) return { skipped: 'aucune sauvegarde trouvée' };
  const newest = Math.max(...files.map(f => f.mtime));
  const prev = list(dir)[0];
  if (!force && prev && prev.mtime >= newest) return { skipped: 'rien de nouveau' };
  fs.mkdirSync(dir, { recursive: true });
  let file, n = 0;
  do file = path.join(dir, `${stamp(new Date())}${n ? '-' + n : ''}__${safe(os.hostname())}.zip`); while (fs.existsSync(file) && ++n);
  const manifest = { app: 'Arcadia', emulator: emuId, game: gameTitle || null, key: key || null, machine: os.hostname(), date: new Date().toISOString(), roots };
  const entries = [{ name: 'arcadia-manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }];
  for (const f of files) entries.push({ name: `${f.root}/${path.relative(roots[f.root], f.path)}`, data: fs.readFileSync(f.path), mtime: new Date(f.mtime) });
  writeZip(file, entries);
  for (const old of list(dir).slice(KEEP)) { for (const f of [old.file, old.thumb]) if (f) { try { fs.unlinkSync(f); } catch { /* */ } } }
  return { file, count: files.length };
}

// Journal des sessions de jeu : <dossier du jeu>\sessions.json
function logSession(dir, s) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'sessions.json');
  let all = [];
  try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* premier */ }
  all.push({ ...s, machine: os.hostname() });
  fs.writeFileSync(f, JSON.stringify(all.slice(-500), null, 1));
}
function sessions(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')); } catch { return []; } }

// Remet une copie en place (les dossiers d'origine sont ceux du manifeste, adaptés si l'émulateur a bougé).
function restore(file, { emuId, ctx, romPath }) {
  const entries = readZip(file);
  const man = JSON.parse(entries.find(e => e.name === 'arcadia-manifest.json').data().toString('utf8'));
  // Sur un autre PC, les chemins peuvent différer : on remplace chaque racine par son équivalent local s'il existe.
  const local = (SAVE_DIRS[emuId] ? SAVE_DIRS[emuId](ctx) : []);
  const roots = man.roots.map(r => {
    if (fs.existsSync(r)) return r;
    const tail = path.basename(r);
    return local.find(l => path.basename(l) === tail && fs.existsSync(path.dirname(l))) || (romPath && path.dirname(romPath)) || r;
  });
  let n = 0;
  for (const e of entries) {
    if (e.name === 'arcadia-manifest.json') continue;
    const slash = e.name.indexOf('/');
    const root = roots[Number(e.name.slice(0, slash))];
    const rel = e.name.slice(slash + 1);
    const dest = path.resolve(root, rel);
    if (!dest.startsWith(path.resolve(root))) continue; // pas d'écriture hors du dossier
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data());
    n++;
  }
  return { count: n, machine: man.machine, date: man.date };
}

// Plus récente date de modification des sauvegardes locales (0 si aucune)
function localNewest(emuId, ctx, romPath, key) {
  try { const { files } = collect(emuId, ctx, romPath, key); return files.length ? Math.max(...files.map(f => f.mtime)) : 0; } catch { return 0; }
}

// Dossiers cloud synchronisés présents sur ce PC
function cloudCandidates() {
  const out = [];
  const add = (label, p) => { if (p && fs.existsSync(p) && !out.some(o => o.path === p)) out.push({ label, path: p }); };
  add('OneDrive', process.env.OneDrive);
  add('OneDrive', process.env.OneDriveConsumer);
  add('OneDrive (pro)', process.env.OneDriveCommercial);
  for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') for (const n of ['Mon Drive', 'My Drive']) add('Google Drive', `${l}:\\${n}`);
  add('Google Drive', path.join(os.homedir(), 'Google Drive'));
  add('Dropbox', path.join(os.homedir(), 'Dropbox'));
  return out;
}

module.exports = { SAVE_DIRS, collect, backup, restore, list, localNewest, cloudCandidates, safe, gameDir, logSession, sessions, gameFilter };
