const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, globalShortcut, screen, desktopCapturer, nativeImage, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Store } = require('./src/store');
const { CONSOLES } = require('./src/consoles');
const { createConsoleFolders, scanLibrary, findLoose } = require('./src/library');
const { SCHEMAS, resolveFile, allFields } = require('./src/emuschemas');
const { readValues, writeValues, saveFile } = require('./src/configfiles');
const GameInfo = require('./src/gameinfo');
const I18N = require('./renderer/i18n.js');
const Multi = require('./src/multiplayer');
const SwitchCfg = require('./src/switchcfg');
const Proc = require('./src/proctl');
const Brand = require('./src/brand');
const { Helper } = require('./src/helper');
const Langs = require('./src/langs');
const RomLangs = require('./src/romlangs');
const Controls = require('./src/controls');
const Patches = require('./src/patches');
const AUMID = 'dev.arcadia.launcher';
const ARCADIA_ICO = () => path.join(runnerDir(), 'arcadia.ico'); // hors de l'archive : lisible par le compagnon natif
const helper = new Helper(path.join(app.isPackaged ? path.join(process.resourcesPath, 'runner') : path.join(__dirname, 'runner'), 'arcadia-helper.exe'), m => log?.write('INFO', m));
if (process.platform === 'win32') app.setAppUserModelId(AUMID);
const { KNOWN_EMULATORS, detectEmulators, buildDefaultMapping, checkSetup, launch } = require('./src/emulators');
const { extractInfo } = require('./src/media');
const { Covers, REPOS } = require('./src/covers');
const { loadKeys, switchInfo, switchIdNoKeys } = require('./src/switchmeta');
const { SwitchDb, titleIdFrom } = require('./src/switchdb');
const { Importer, move, uniqueDest, extractArchive } = require('./src/importer');
const { SOURCES, installEmulator, latestAsset } = require('./src/emuinstall');
const { PRESETS, UNLOCKS, PADS } = require('./src/presets');
const { watchPad, closeProcess: closeProcessRaw } = require('./src/padwatch');
// Processus fermés par Arcadia (menu « Quitter », combo manette) : leur sortie n'est pas un plantage
const closedByArcadia = new Set();
const closeProcess = (pid, ...rest) => { closedByArcadia.add(pid); return closeProcessRaw(pid, ...rest); };
const Saves = require('./src/saves');
const { Discord } = require('./src/discord');
const discord = new Discord();
const { Log, backupStore, listStoreBackups, looksEmpty, sessionShots, Remote } = require('./src/extras');
let log = null, remote = null;

let win, store, covers, switchDb;
let games = [];
let loose = [];

const DEFAULT_SETTINGS = {
  minimizeOnPlay: true,      // réduire Arcadia pendant une partie
  coversOnline: true,        // jaquettes libretro
  iconSize: 22,              // icônes de la liste (0 = aucune)
  cardSubtitle: 'playtime',  // texte sous les jaquettes
  showBadges: true,
  showNames: true,
  viewMode: 'grid',          // grid | list
  glow: 'medium',            // off | soft | medium | strong
  uiSounds: true,            // petits sons d'interface
  bgMode: 'default',         // fond : default | custom (image) | solid (couleur unie) | transparent (Windows derrière)
  bgImage: '', bgBlur: 18, bgDim: 55, bgColor: '#0b0b0b',
  accentMode: 'image',       // couleur des boutons : image (palette du fond) | custom | windows
  accentColor: '#ffffff',
  accentByConsole: false,
  couchAuto: true,
  fpsHud: false,
  autoUpdate: true,
  ps1Wide: true,             // PS1 : patch écran large 16:9 quand la base DuckStation en a un          // télécharger tout seul les nouvelles versions publiées sur GitHub
  fps60Auto: true,          // patchs 60 images/s automatiques (Switch, PSP, PS1)            // compteur d'images/s par-dessus le jeu
  fpsHudPos: 'tl',          // tl tr bl br
  fpsHudSize: 'm',          // s m l         // Mode Canapé quand une manette s'allume    // lueur à la couleur de la console
  bigPictureOnStart: false,  // démarrer en mode TV
  autoBackup: true,          // copie des sauvegardes à la fermeture d'un jeu
  savesDir: '',              // '' = <Arcadia>\saves
  cloudPrompt: true,         // proposer une sauvegarde plus récente venant d'un autre PC
  discordId: '',             // Application ID Discord (Rich Presence)
  remoteEnabled: false,      // lancer les jeux depuis son téléphone (même Wi-Fi)
  padQuit: true,             // Back + Start maintenus 1,5 s = quitter le jeu
  useRunner: true,
  switchEngine: 'arcadia', // 'arcadia' = moteur Switch d'Arcadia ; 'eden' = moteur Eden d'origine
  sgdbKey: '',
  input: null,               // manette choisie au premier lancement : { type: keyboard|xbox|switch|generic, guid, name, known }
  resumePrompt: true,
  controlsHint: true,         // petite aide « manette + clavier » au début de chaque partie        // jeux sur émulateur externe : « Reprendre ta partie ? » avec les copies de sauvegarde
  perfLevel: 'auto',         // qualité graphique : minimal | moyenne | maximum | auto               // clé SteamGridDB (facultative) : bannières larges sur les pages de jeu           // moteur intégré Arcadia (sans fenêtre d'émulateur) quand il existe pour la console
  shortcuts: { search: 'Ctrl+F', fullscreen: 'F11', refresh: 'F5', add: 'Ctrl+O', settings: 'Ctrl+,', favorite: 'Ctrl+D', back: 'Escape' }
};
const settings = () => ({ ...DEFAULT_SETTINGS, ...(store.data.settings || {}), shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...((store.data.settings || {}).shortcuts || {}) } });
const running = new Map(); // gameId -> pid

if (!app.requestSingleInstanceLock()) app.quit();
const launchArg = argv => (argv.find(a => a.startsWith('--launch=')) || '').slice(9) || null;
let pendingLaunch = launchArg(process.argv);
app.on('second-instance', (_e, argv) => {
  const id = launchArg(argv);
  if (id) { launchOutside(id); return; }
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});

protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const MEDIA = () => path.join(app.getPath('userData'), 'media');
const mediaPath = (kind, id, ext = 'png') => path.join(MEDIA(), kind, `${id}.${ext}`);

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 680,
    backgroundColor: '#00000000', // fond géré par l'interface (image, couleur ou transparence Windows)
    title: 'Arcadia',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.once('ready-to-show', () => { win.show(); applyWindowMaterial(); });
  // fenêtre principale fermée : Arcadia se ferme vraiment (le menu Échap et le compteur, invisibles, ne doivent pas le garder en vie)
  win.on('closed', () => { win = null; try { hudStop(); } catch { /* */ } for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch { /* */ } } app.quit(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Les fichiers déposés hors de la zone prévue ne doivent pas ouvrir de nouvelle page.
  win.webContents.on('will-navigate', e => e.preventDefault());
}

process.on('uncaughtException', e => { log?.write('ERREUR', e.stack || e.message); });
process.on('unhandledRejection', e => { log?.write('ERREUR', (e && e.stack) || String(e)); });
app.whenReady().then(() => {
  setTimeout(() => detectHardware().catch(() => {}), 4000); // analyse du PC en arrière-plan (profil Auto)
  log = new Log(path.join(app.getPath('userData'), 'logs'));
  log.write('INFO', `Arcadia ${app.getVersion()} démarre`);
  store = new Store(app.getPath('userData'));
  for (const k of ['categories', 'gameCats', 'media', 'titles', 'customCovers']) if (!store.get(k)) store.data[k] = k === 'categories' ? [] : {};
  for (const d of ['icons', 'covers', 'custom', 'shots']) fs.mkdirSync(path.join(MEDIA(), d), { recursive: true });
  setupAfterStore();
  setUiLang(settings().uiLang);
  backupStore(store.file, path.join(savesRoot(), '_arcadia'));
  covers = new Covers(path.join(MEDIA(), 'libretro'));
  switchDb = new SwitchDb(path.join(MEDIA(), 'switch'));

  // media://img/?p=<chemin> : uniquement les images d'Arcadia ou de la bibliothèque
  protocol.handle('media', req => {
    const p = new URL(req.url).searchParams.get('p');
    const lib = store.get('libraryDir');
    const ok = p && (isInside(path.resolve(p), MEDIA()) || (lib && isInside(path.resolve(p), path.resolve(lib))));
    if (!ok) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });

  if (settings().remoteEnabled) remoteServer().start().catch(e => log.write('ERREUR', 'télécommande : ' + e.message));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.whenReady().then(() => {
  if (helper.available) helper.start(); watchUpdates();
  setTimeout(() => checkGithubUpdate(false), 20000); setInterval(() => checkGithubUpdate(false), 6 * 3600e3);
});
app.on('before-quit', () => { helper.stop(); try { backupStore(store.file, path.join(savesRoot(), '_arcadia')); } catch { /* */ } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------------------------------------------------------------- dossier racine Arcadia
//   <racine>\app\Arcadia.exe   <racine>\Jeux\   <racine>\Émulateurs\   <racine>\Sauvegardes\
// (anciens noms gamesfiles / emu encore reconnus)
function arcadiaRoot() {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  let d = exeDir;
  for (let i = 0; i < 4; i++) {
    if (['Jeux', 'Émulateurs', 'gamesfiles', 'emu'].some(n => fs.existsSync(path.join(d, n)))) return d;
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  if (path.basename(path.dirname(exeDir)).toLowerCase() === 'app') return path.dirname(path.dirname(exeDir));
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  const saved = store.get('rootDir');
  return saved && fs.existsSync(saved) ? saved : null;
}
const exists = p => !!p && fs.existsSync(p);
const LIB_DIR = () => ROOT && (['Jeux', 'gamesfiles'].map(n => path.join(ROOT, n)).find(exists) || path.join(ROOT, 'Jeux'));
const EMU_DIR = () => ROOT && (['Émulateurs', 'emu'].map(n => path.join(ROOT, n)).find(exists) || path.join(ROOT, 'Émulateurs'));
let ROOT = null;

function setupRoot() {
  ROOT = arcadiaRoot();
  if (!ROOT) return;
  // où tourne Arcadia (et quelle version) : les mises à jour visent toujours la bonne installation
  try { fs.writeFileSync(path.join(ROOT, '.arcadia-app.json'), JSON.stringify({ version: app.getVersion(), exe: app.getPath('exe'), resources: process.resourcesPath, at: new Date().toISOString() }, null, 1)); } catch { /* dossier en lecture seule */ }
  const lib = LIB_DIR(), emu = EMU_DIR();
  fs.mkdirSync(lib, { recursive: true });
  fs.mkdirSync(emu, { recursive: true });
  // dossier absent, ou vidé parce que son contenu a été rangé dans Arcadia -> on bascule
  const curLib = store.get('libraryDir'), curEmu = store.get('emulatorsDir');
  // premier lancement : on ne choisit pas à la place de l'utilisateur, la fenêtre d'accueil lui demande son dossier
  if (curLib && (!exists(curLib) || (!inside(curLib, lib) && !scanLibrary(curLib).length)) && scanLibrary(lib).length) store.set('libraryDir', lib);
  if (!exists(curEmu) || (!inside(curEmu, emu) && !Object.keys(detectEmulators(curEmu)).length && Object.keys(detectEmulators(emu)).length)) store.set('emulatorsDir', emu);
  repairMapping();
}
function setupAfterStore() {
  setupRoot();
  try { autoEmulators(); } catch { /* */ }
  // les sauvegardes faites avant le dossier Arcadia (dans AppData) rejoignent <racine>\Sauvegardes
  try {
    const old = path.join(app.getPath('userData'), 'saves'), dest = ROOT && path.join(ROOT, 'Sauvegardes');
    if (dest && !settings().savesDir && exists(old) && !exists(dest)) {
      try { fs.renameSync(old, dest); } catch { fs.cpSync(old, dest, { recursive: true }); }
    }
    if (ROOT) fs.mkdirSync(path.join(ROOT, 'Sauvegardes'), { recursive: true });
  } catch (e) { log?.write('ERREUR', 'migration des sauvegardes : ' + e.message); }
}

// Un émulateur a été déplacé ? On retrouve son exe dans le dossier des émulateurs.
function repairGameSettings(found) {
  const all = store.get('gameSettings') || {};
  let changed = 0;
  for (const [id, gs] of Object.entries(all)) {
    if (!gs.emulator || gs.emulator === 'arcadia') continue;
    const gone = !found[gs.emulator];
    const preferEden = (found.eden || found.edencli) && gs.emulator === 'lichii'; // Lichii complet : seulement si on le choisit à nouveau
    if (gone || preferEden) { delete gs.emulator; changed++; }
  }
  if (changed) { store.set('gameSettings', all); log?.write('INFO', `${changed} choix d'émulateur par jeu remis par défaut (émulateur absent ou Eden disponible)`); }
}
function repairMapping() {
  const dirs = [store.get('emulatorsDir'), EMU_DIR()].filter(exists);
  if (!dirs.length) return;
  const found = Object.assign({}, ...dirs.slice().reverse().map(d => detectEmulators(d))); // le dossier courant prime
  const mapping = { ...(store.get('mapping') || {}) };
  for (const [cid, m] of Object.entries(mapping)) {
    if (m.exe && !exists(m.exe) && found[m.emulator]) mapping[cid] = { ...m, exe: found[m.emulator] };
    else if (m.exe && !exists(m.exe)) delete mapping[cid]; // émulateur disparu : on laisse la carte par défaut proposer un remplaçant
  }
  if (found.eden && mapping.SWITCH && mapping.SWITCH.emulator === 'lichii') delete mapping.SWITCH;
  for (const m of Object.values(mapping)) if (m.emulator === 'azahar' && m.args === '"{rom}"') m.args = KNOWN_EMULATORS.azahar.args; // Eden reste l'émulateur Switch principal
  for (const [cid, setup] of Object.entries(buildDefaultMapping(found))) if (!mapping[cid] || checkSetup(mapping[cid])) mapping[cid] = setup;
  store.set('mapping', mapping);
  try { repairGameSettings(found); } catch { /* */ }
  // 1.16 : plus de choix de moteur dans l'interface → les anciens choix (moteur Switch, moteur intégré coupé) sont oubliés
  if (store.data.engineChoiceReset !== 1) {
    const st = { ...(store.data.settings || {}) }; delete st.useRunner; delete st.switchEngine;
    store.data.settings = st; store.data.engineChoiceReset = 1; store.save();
  }
}

function emuCandidates() {
  const lib = store.get('libraryDir');
  const bases = [ROOT, lib && path.dirname(lib)].filter(Boolean);
  const out = [];
  for (const b of bases) for (const n of ['Émulateurs', 'emu', 'Arcadia Emu', path.join('Emulator', 'Soft')]) { const p = path.join(b, n); if (exists(p) && !out.includes(p)) out.push(p); }
  return out;
}
function autoEmulators() {
  if (exists(store.get('emulatorsDir')) && Object.keys(detectEmulators(store.get('emulatorsDir'))).length) return null;
  const hit = emuCandidates().find(d => Object.keys(detectEmulators(d)).length);
  if (!hit) return null;
  store.set('emulatorsDir', hit);
  repairMapping();
  return hit;
}
function emuInstallRoot() {
  const cur = store.get('emulatorsDir');
  if (exists(cur)) return cur;
  if (ROOT) return EMU_DIR();
  const lib = store.get('libraryDir');
  return lib ? path.join(path.dirname(lib), 'Arcadia Emu') : path.join(app.getPath('documents'), 'Arcadia Emu');
}
const inside = (child, parent) => !!child && !!parent && (path.resolve(child) === path.resolve(parent) || isInside(path.resolve(child), path.resolve(parent)));
function orgStatus() {
  const emuDir = store.get('emulatorsDir'), lib = store.get('libraryDir');
  return {
    root: ROOT,
    emulatorsDir: emuDir || null,
    libraryDir: lib || null,
    emusOutside: !!ROOT && exists(emuDir) && !inside(emuDir, EMU_DIR()),
    libraryOutside: !!ROOT && exists(lib) && !inside(lib, LIB_DIR()),
    dismissed: store.get('orgDismissed') || {}
  };
}

// ---------------------------------------------------------------- état
function decorate(g) {
  const m = store.get('media')[g.id] || {};
  const custom = store.get('customCovers')[g.id];
  return {
    ...g,
    title: store.get('titles')[g.id] || g.title,
    fileTitle: g.title,
    innerTitle: m.title || null,
    icon: m.icon && fs.existsSync(m.icon) ? m.icon : null,
    pixelIcon: !!m.pixel,
    broken: !!m.broken,
    patch: !!m.patch,
    titleId: m.titleId || null,
    // langues proposées : lues dans la ROM (Switch, 3DS), sinon déduites de sa région, sinon celles de la console
    langs: Langs.SETTABLE.includes(g.console) ? (m.langs || Langs.CONSOLE_LANGS[g.console] || null) : null,
    langsFromRom: !!m.langs, langsFrom: m.langs ? (m.langsFrom || 'rom') : 'console',
    langSettable: Langs.SETTABLE.includes(g.console),
    region: m.region || null, romLangs: m.langs || null,
    coverSquare: !custom && (isSwitch(g) || (!g.cover && !!m.coverSquare)), // icônes eShop carrées
    cover: custom && fs.existsSync(custom) ? custom : g.cover || (m.cover && fs.existsSync(m.cover) ? m.cover : null)
  };
}

function snapshot() {
  const mapping = store.get('mapping');
  return {
    libraryDir: store.get('libraryDir'),
    emulatorsDir: store.get('emulatorsDir'),
    mapping,
    stats: store.get('stats'),
    favorites: store.get('favorites'),
    categories: store.get('categories'),
    gameCats: store.get('gameCats'),
    consoles: CONSOLES,
    emulators: Object.fromEntries(Object.entries(KNOWN_EMULATORS).map(([k, v]) => [k, { name: v.name }])),
    games: games.map(decorate),
    running: [...running.keys()],
    settings: settings(),
    loose: loose.length,
    org: orgStatus(),
    gameSettings: store.get('gameSettings') || {},
    savesRoot: savesRoot(),
    version: require('./package.json').version,
    runnerConsoles: Object.keys(RUNNER_CORES).filter(c => runnerFor(c)),
    switchEngine: !!arcadiaSwitchExe(),
    appVersion: app.getVersion(),
    hardware: HW_CACHE,
    status: Object.fromEntries(CONSOLES.map(c => [c.id, (c.id === 'SWITCH' || c.id === 'SWITCH 2') && !mapping[c.id] && arcadiaSwitchExe() ? null : checkSetup(mapping[c.id])]))
  };
}

// Surveillance du dossier de jeux : un téléchargement terminé ou une copie apparaît tout de suite,
// et une ROM posée hors des dossiers de console déclenche une proposition de rangement.
let watcher = null, watchDir = null, watchTimer = null;
let importing = false;
function watchLibrary() {
  const dir = store.get('libraryDir');
  if (dir === watchDir) return;
  try { watcher?.close(); } catch { /* */ }
  watcher = null; watchDir = dir;
  if (!exists(dir)) return;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_ev, name) => {
      if (!name || /\.(part|crdownload|tmp|download|!ut)$/i.test(name) || /(^|[\\/])_import[\\/]/i.test(name) || importing) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        const beforeIds = new Set(games.map(g => g.id)), beforeLoose = new Set(loose.map(x => x.path));
        rescan();
        const added = games.filter(g => !beforeIds.has(g.id)).map(g => decorate(g).title);
        const newLoose = loose.filter(x => !beforeLoose.has(x.path)).map(x => ({ name: x.name, console: x.console }));
        win?.webContents.send('state:update', snapshot());
        if (added.length || newLoose.length) win?.webContents.send('library:changed', { added, newLoose });
      }, 2500);
    });
  } catch (e) { log?.write('ERREUR', 'surveillance du dossier : ' + e.message); }
}

function rescan() {
  const dir = store.get('libraryDir');
  if (dir && fs.existsSync(dir)) createConsoleFolders(dir);
  games = scanLibrary(dir);
  loose = findLoose(dir);
  store.data.scanCache = { dir, games, loose: loose.length };
  store.save();
  queueMedia();
  watchLibrary();
  setTimeout(() => fps60Sweep().catch(() => {}), 15000); // patchs 60 images/s des jeux Switch, en arrière-plan
}

// Démarrage instantané : la dernière liste connue s'affiche tout de suite, l'analyse se fait juste après.
let firstState = true;
function stateFast() {
  const c = store.get('scanCache');
  if (firstState && c && c.dir === store.get('libraryDir') && Array.isArray(c.games)) {
    firstState = false;
    games = c.games;
    loose = new Array(c.loose || 0);
    setTimeout(() => {
      const before = JSON.stringify(games.map(g => g.id + g.size));
      rescan();
      if (JSON.stringify(games.map(g => g.id + g.size)) !== before) win?.webContents.send('state:update', snapshot());
      runPendingLaunch();
    }, 50);
    return snapshot();
  }
  firstState = false;
  rescan();
  setTimeout(runPendingLaunch, 50);
  return snapshot();
}
function runPendingLaunch() {
  if (!pendingLaunch) return;
  const id = pendingLaunch; pendingLaunch = null;
  launchOutside(id);
}
// Lancement depuis un raccourci du bureau : la question « Reprendre ? » s'affiche dans Arcadia
function launchOutside(id) {
  const r = startGame(id);
  if (r.resumePick) { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } win?.webContents.send('game:resume', { id, items: r.resumePick.items }); return; }
  if (!r.ok) win?.webContents.send('game:error', { id, error: r.error });
}

// ---------------------------------------------------------------- icônes & jaquettes (en tâche de fond)
let mediaBusy = false, pendingUpdates = {}, flushTimer = null;
function pushUpdate(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  pendingUpdates[id] = decorate(g);
  if (!flushTimer) flushTimer = setTimeout(() => {
    flushTimer = null;
    win?.webContents.send('media:update', pendingUpdates);
    pendingUpdates = {};
  }, 400);
}

async function queueMedia() {
  if (mediaBusy) { queueMedia.again = true; return; }
  mediaBusy = true;
  const media = store.get('media');
  try {
    // 1) icônes et titres internes : local, rapide
    const keys = games.some(isSwitch) ? switchKeys() : null;
    for (const g of games) {
      // pour la Switch, l'ajout des clés plus tard relance l'extraction
      const sig = `${g.size}:${Math.round(g.mtime || 0)}` + (isSwitch(g) && keys ? ':k' : '') + ':L2P2'; // L2 : région + langues lues dans l'en-tête de la ROM ; P : [vNNN] d'un jeu complet ≠ mise à jour
      const m = media[g.id] || {};
      if (m.sig === sig && 'broken' in m && !(isSwitch(g) && !('titleId' in m))) continue;
      let info = null;
      let idInfo = null;
      if (isSwitch(g)) { try { info = switchInfo(g.path, keys); } catch { info = null; } try { idInfo = switchIdNoKeys(g.path); } catch { /* */ } }
      else info = extractInfo(g);
      const next = { ...m, sig, broken: looksEmpty(g.path), patch: !!(idInfo?.patch || /[\[(]\s*(dlc|update|updates?|patch|add-?on|mise [àa] jour|maj)\b/i.test(g.file) || /\b0[0-9A-F]{12}800\b/i.test(g.file) || (!/\b0[0-9A-F]{15}\b/i.test(g.file) && /\[v[1-9]\d{3,}\]/i.test(g.file))), title: info?.title || null, pixel: !!info?.pixel, icon: null, serial: info?.serial || null, langs: info?.langs && info.langs.length ? info.langs : null, titleId: info?.titleId || keylessId(g) || titleIdFrom(g.file) };
      if (!next.langs || !isSwitch(g)) { // pas de liste dans les métadonnées : région lue dans l'en-tête
        let r = null; try { r = RomLangs.detect(g, info); } catch { /* en-tête illisible */ }
        next.region = r?.region || null; if (!next.serial && r?.serial) next.serial = r.serial;
        if (!next.langs && r?.langs) { next.langs = r.langs; next.langsFrom = 'region'; } else if (next.langs) next.langsFrom = 'rom';
      } else next.langsFrom = 'rom';
      if (info?.icon) { next.icon = mediaPath('icons', g.id, info.iconExt || 'png'); fs.writeFileSync(next.icon, info.icon); }
      media[g.id] = next;
      pushUpdate(g.id);
      await new Promise(r => setImmediate(r));
    }
    store.save();
    // 2) jaquettes en ligne : 3 en parallèle, un nouvel essai par semaine si rien trouvé
    const todo = !settings().coversOnline ? [] : games.filter(g => {
      const m = media[g.id];
      if (!(REPOS[g.console] || isSwitch(g)) || g.cover || store.get('customCovers')[g.id]) return false;
      if (m.cover && fs.existsSync(m.cover)) return false;
      return !m.coverTried || Date.now() - m.coverTried > 7 * 864e5;
    });
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const g = todo[i++];
        const m = media[g.id];
        const titles = [g.title, m.title].filter(Boolean);
        const dest = mediaPath('covers', g.id);
        try {
          const ext = path.extname(g.path).slice(1).toLowerCase();
          if (isSwitch(g)) {
            const hit = await switchDb.find({ titleId: m.titleId, titles });
            if (hit?.iconUrl) {
              m.cover = shrink(await switchDb.download(hit.iconUrl, mediaPath('covers', g.id, 'jpg')));
              m.coverSquare = true;
              if (!m.title) m.title = hit.name;
              pushUpdate(g.id);
            }
          } else if (await covers.fetchCover(g.console, titles, dest, ext)) { m.cover = shrink(dest); pushUpdate(g.id); }
          m.coverTried = Date.now();
        } catch (e) {
          // hors ligne ou limite GitHub : on réessaiera au prochain lancement
          if (/HTTP 403|HTTP 429/.test(e.message)) { i = todo.length; }
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    store.save();
  } finally {
    mediaBusy = false;
    if (queueMedia.again) { queueMedia.again = false; queueMedia(); }
  }
}

const isSwitch = g => g.console === 'SWITCH' || g.console === 'SWITCH 2';
function keylessId(g) { try { return switchIdNoKeys(g.path)?.titleId || null; } catch { return null; } }
// prod.keys / title.keys d'Eden et Lichii (installation normale ou portable)
function switchKeys() {
  const dirs = [];
  for (const id of ['eden', 'lichii', 'edencli']) {
    const ctx = emuCtx(id);
    dirs.push(path.join(ctx.exeDir, 'user', 'keys'), path.join(ctx.appData, id === 'edencli' ? 'eden' : id, 'keys'));
  }
  dirs.push(path.join(app.getPath('appData'), 'yuzu', 'keys'));
  return loadKeys(dirs);
}

// Jaquettes réduites à 460 px de large : moins de mémoire, grille plus fluide
function shrink(file) {
  try {
    const img = nativeImage.createFromPath(file);
    const { width } = img.getSize();
    if (!width || width <= 460) return file;
    const out = file.replace(/\.(png|jpe?g)$/i, '') + '.jpg';
    fs.writeFileSync(out + '.tmp', img.resize({ width: 460, quality: 'best' }).toJPEG(88));
    if (out !== file) { try { fs.unlinkSync(file); } catch { /* */ } }
    fs.renameSync(out + '.tmp', out);
    return out;
  } catch { return file; }
}

// Transfère toutes les données d'un jeu (stats, favori, catégories, images) vers un nouvel id.
function migrateId(oldId, newId) {
  if (oldId === newId) return;
  for (const key of ['stats', 'gameCats', 'media', 'titles', 'customCovers']) {
    const o = store.get(key);
    if (o[oldId] !== undefined) { o[newId] = o[oldId]; delete o[oldId]; }
  }
  const fav = store.get('favorites');
  const i = fav.indexOf(oldId);
  if (i >= 0) fav[i] = newId;
  store.save();
}

// ---------------------------------------------------------------- IPC : bibliothèque
ipcMain.handle('state:get', () => stateFast());

ipcMain.handle('library:choose', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Dossier de ta bibliothèque', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return snapshot();
  store.set('libraryDir', res.filePaths[0]);
  const emus = autoEmulators();
  rescan();
  return { ...snapshot(), emusFound: emus };
});
ipcMain.handle('library:createDefault', () => {
  const base = path.join(app.getPath('documents'), 'Arcadia Games');
  fs.mkdirSync(base, { recursive: true });
  store.set('libraryDir', base);
  rescan();
  return snapshot();
});

ipcMain.handle('library:rescan', () => { rescan(); return snapshot(); });

ipcMain.handle('library:openFolder', (_e, consoleId) => {
  const dir = store.get('libraryDir');
  if (dir) shell.openPath(consoleId ? path.join(dir, consoleId) : dir);
});

// ---------------------------------------------------------------- IPC : émulateurs
ipcMain.handle('emulators:detect', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Dossier qui contient tes émulateurs', properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return snapshot();
  const found = detectEmulators(res.filePaths[0]);
  const detected = buildDefaultMapping(found);
  const mapping = { ...store.get('mapping') };
  for (const [id, setup] of Object.entries(detected)) if (!mapping[id] || checkSetup(mapping[id])) mapping[id] = setup;
  store.set('emulatorsDir', res.filePaths[0]);
  store.set('mapping', mapping);
  return { ...snapshot(), detected: Object.keys(found) };
});

ipcMain.handle('emulators:pickExe', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Exécutable de l'émulateur", properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'Programmes', extensions: ['exe'] }] : []
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('emulators:pickCore', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Core RetroArch', properties: ['openFile'], filters: [{ name: 'Cores libretro', extensions: ['dll', 'so', 'dylib'] }] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('emulators:set', (_e, consoleId, setup) => {
  const mapping = store.get('mapping');
  if (setup) mapping[consoleId] = setup; else delete mapping[consoleId];
  store.set('mapping', mapping);
  return snapshot();
});

// ---------------------------------------------------------------- IPC : organisation & installation
const taskProgress = d => win?.webContents.send('task:progress', d);

async function moveAllInto(srcDir, destDir, label) {
  const entries = fs.readdirSync(srcDir).filter(n => !['desktop.ini', 'thumbs.db'].includes(n.toLowerCase()));
  let done = 0;
  const moved = [];
  for (const name of entries) {
    const from = path.join(srcDir, name);
    let to = path.join(destDir, name);
    taskProgress({ title: `${label} ${done + 1}/${entries.length}`, file: name, pct: 100 * done / entries.length });
    if (fs.existsSync(to)) {
      const st = fs.statSync(from);
      if (st.isDirectory() && fs.statSync(to).isDirectory()) { // fusion de dossiers (ex. SWITCH dans SWITCH)
        await moveAllInto(from, to, label);
        try { fs.rmdirSync(from); } catch { /* pas vide */ }
        done++; moved.push(name); continue;
      }
      to = await uniqueDest(to);
    }
    await move(from, to, () => {});
    done++; moved.push(name);
  }
  return moved;
}

ipcMain.handle('org:moveEmus', async () => {
  try {
    const src = store.get('emulatorsDir'), dest = EMU_DIR();
    if (running.size) throw new Error('Ferme les jeux en cours avant de déplacer les émulateurs.');
    fs.mkdirSync(dest, { recursive: true });
    const moved = await moveAllInto(src, dest, 'Déplacement des émulateurs');
    const mapping = store.get('mapping') || {};
    for (const m of Object.values(mapping)) if (m.exe && inside(m.exe, src)) m.exe = path.join(dest, path.relative(src, m.exe));
    store.set('mapping', mapping);
    store.set('emulatorsDir', dest);
    repairMapping();
    taskProgress({ title: `${moved.length} élément(s) déplacé(s)`, file: dest, pct: 100, done: true });
    return { ok: true, state: snapshot() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('org:moveLibrary', async () => {
  try {
    const src = store.get('libraryDir'), dest = LIB_DIR();
    if (running.size) throw new Error('Ferme les jeux en cours avant de déplacer la bibliothèque.');
    createConsoleFolders(dest);
    const moved = await moveAllInto(src, dest, 'Déplacement des jeux');
    store.set('libraryDir', dest);
    rescan();
    taskProgress({ title: `${moved.length} élément(s) déplacé(s)`, file: dest, pct: 100, done: true });
    return { ok: true, state: snapshot() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('org:connect', (_e, which) => {
  const d = store.get('orgDismissed') || {};
  d[which] = true;
  store.set('orgDismissed', d);
  return snapshot();
});

ipcMain.handle('org:chooseRoot', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Dossier Arcadia (Jeux, Émulateurs et Sauvegardes y seront créés)', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return snapshot();
  store.set('rootDir', res.filePaths[0]);
  setupRoot();
  rescan();
  return snapshot();
});

// Catalogue : installé ? installable automatiquement ? quelles consoles ?
ipcMain.handle('emus:catalog', () => {
  const found = Object.assign({}, ...[...emuCandidates(), store.get('emulatorsDir')].filter(exists).map(d => detectEmulators(d)));
  const used = new Set(Object.values(store.get('mapping') || {}).filter(m => m.exe && exists(m.exe)).map(m => m.emulator));
  return Object.entries(KNOWN_EMULATORS).filter(([id]) => SOURCES[id]).map(([id, e]) => ({
    id, name: e.name, consoles: e.consoles,
    installed: !!found[id] || used.has(id),
    exe: found[id] || null,
    auto: !!SOURCES[id].repo,
    page: SOURCES[id].page || `https://github.com/${SOURCES[id].repo}/releases/latest`,
    note: SOURCES[id].note || SOURCES[id].why || null
  }));
});

ipcMain.handle('emus:install', async (_e, ids) => {
  const results = [];
  const emuRoot = emuInstallRoot();
  fs.mkdirSync(emuRoot, { recursive: true });
  for (const [i, id] of ids.entries()) {
    const e = KNOWN_EMULATORS[id];
    try {
      const r = await installEmulator(id, emuRoot, e.name, extractArchive, p =>
        taskProgress({ title: `${e.name} (${i + 1}/${ids.length}) · ${p.step}`, file: e.name, pct: p.pct }));
      results.push({ id, name: e.name, ok: true, version: r.version });
    } catch (err) { results.push({ id, name: e.name, ok: false, error: err.message }); }
  }
  if (!exists(store.get('emulatorsDir'))) store.set('emulatorsDir', emuRoot);
  // les consoles de chaque émulateur fraîchement installé pointent vers la nouvelle version
  const fresh = detectEmulators(emuRoot);
  const mapping = store.get('mapping') || {};
  for (const r of results.filter(x => x.ok && fresh[x.id])) {
    const e = KNOWN_EMULATORS[r.id];
    for (const cid of e.consoles) {
      const m = mapping[cid];
      if (!m || m.emulator === r.id || checkSetup(m)) mapping[cid] = { emulator: r.id, exe: fresh[r.id], args: (e.argsByConsole || {})[cid] || e.args };
    }
  }
  store.set('mapping', mapping);
  repairMapping();
  taskProgress({ title: 'Installation terminée', file: '', pct: 100, done: true });
  return { ok: true, results, state: snapshot() };
});

// ---------------------------------------------------------------- mise à jour d'Arcadia
// Un « Arcadia-Setup-x.y.z.exe » plus récent posé à côté d'Arcadia (ou dans son dossier racine) est proposé au démarrage,
// puis installé en silencieux par-dessus (l'installateur ferme Arcadia, remplace ses fichiers et le relance).
const verNum = v => v.split('.').map(Number).reduce((a, n) => a * 1000 + (n || 0), 0);
function findUpdate() {
  const lib = store.get('libraryDir');
  const dirs = [path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')), ROOT, ROOT && path.join(ROOT, '_updates'), lib, lib && path.dirname(lib)].filter(exists);
  let best = null;
  for (const d of new Set(dirs)) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      // installeur complet, ou mise à jour rapide (seulement l'application : Arcadia-Update-x.y.z.asar)
      const m = n.match(/^Arcadia-(Setup|Update)-(\d+\.\d+\.\d+)\.(exe|asar)$/i);
      if (!m || (m[1].toLowerCase() === 'setup') !== (m[3].toLowerCase() === 'exe')) continue;
      if (verNum(m[2]) > verNum(app.getVersion()) && (!best || verNum(m[2]) > verNum(best.version) || (m[2] === best.version && best.quick)))
        best = { version: m[2], file: path.join(d, n), quick: m[3].toLowerCase() === 'asar' };
    }
  }
  return best;
}
ipcMain.handle('app:checkUpdate', () => { const u = app.isPackaged && process.platform === 'win32' ? findUpdate() : null; if (u) updNotified = u.version; return u; });
ipcMain.handle('app:installUpdate', (_e, file) => {
  const u = findUpdate();
  if (!u || path.resolve(u.file) !== path.resolve(file)) return { ok: false, error: 'Mise à jour introuvable' };
  if (u.quick) return installQuickUpdate(u);
  const exeDir = path.dirname(app.getPath('exe'));
  const installDir = path.basename(exeDir).toLowerCase() === 'app' ? path.dirname(exeDir) : exeDir;
  require('child_process').spawn(u.file, ['/S', `/D=${installDir}`], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => { app.quit(); setTimeout(() => app.exit(0), 2500); }, 300); // sortie forcée si une fenêtre retient Arcadia
  return { ok: true };
});

// Mise à jour rapide : un petit script attend la fermeture d'Arcadia, remplace l'application puis la relance
function installQuickUpdate(u) {
  const dst = path.join(process.resourcesPath, 'app.asar');
  const bat = path.join(app.getPath('temp'), 'arcadia-maj.cmd');
  fs.writeFileSync(bat, [
    '@echo off', 'setlocal enabledelayedexpansion', 'set n=0',
    ':wait', `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
    ':copy', `copy /Y "${u.file}" "${dst}" >nul 2>&1 || (set /a n+=1 & timeout /t 1 /nobreak >nul & if !n! LSS 30 goto copy)`,
    `start "" "${app.getPath('exe')}"`, ''
  ].join('\r\n'));
  require('child_process').spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  log?.write('INFO', `mise à jour rapide vers ${u.version}`);
  setTimeout(() => { app.quit(); setTimeout(() => app.exit(0), 2500); }, 300); // sortie forcée si une fenêtre retient Arcadia
  return { ok: true };
}
// Mise à jour en ligne : la dernière release GitHub publique est téléchargée dans <Arcadia>\_updates,
// puis proposée comme une mise à jour posée à la main (bannière + écran de mise à jour).
const GH_REPO = 'hiimivex/Arcadia';
let ghBusy = false;
// 1) vérification seule : une nouvelle release → bannière « Mise à jour disponible »
// 2) quand le joueur accepte : téléchargement (progression), empreinte vérifiée, installation silencieuse, redémarrage
let ghRelease = null, ghNotified = null;
async function checkGithubUpdate(manual) {
  const TEST_API = process.env.ARCADIA_UPDATE_API; // essais uniquement
  if (ghBusy || (!TEST_API && (!app.isPackaged || process.platform !== 'win32')) || !ROOT) return { ok: false, error: 'indisponible' };
  if (!manual && settings().autoUpdate === false) return { ok: false, error: 'désactivé' };
  ghBusy = true;
  try {
    // toutes les releases publiées (y compris « pre-release ») : la plus haute version gagne
    const r = await net.fetch(TEST_API || `https://api.github.com/repos/${GH_REPO}/releases?per_page=20`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Arcadia' } });
    if (r.status === 404) return { ok: true, latest: app.getVersion(), upToDate: true }; // aucune release publiée
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const body = await r.json();
    const vOf = x => String(x.tag_name || '').replace(/^v/i, '');
    const rel = (Array.isArray(body) ? body : [body]).filter(x => x && !x.draft && /^\d+\.\d+\.\d+$/.test(vOf(x))).sort((a, b) => verNum(vOf(b)) - verNum(vOf(a)))[0];
    if (!rel) return { ok: true, latest: app.getVersion(), upToDate: true };
    const version = String(rel.tag_name || '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(version) || verNum(version) <= verNum(app.getVersion())) return { ok: true, latest: version || app.getVersion(), upToDate: true };
    const asset = (rel.assets || []).find(a => new RegExp(`^Arcadia-Setup-${version.replace(/\./g, '\\.')}\\.exe$`, 'i').test(a.name));
    if (!asset) return { ok: false, error: `Version ${version} publiée sans installateur` };
    ghRelease = { version, asset };
    if (ghNotified !== version || manual) { ghNotified = version; win?.webContents.send('app:update', { version, online: true }); }
    return { ok: true, version, available: true };
  } catch (e) {
    log?.write('INFO', `mise à jour en ligne : ${e.message}`);
    return { ok: false, error: e.message };
  } finally { ghBusy = false; }
}
async function downloadRelease() {
  const { version, asset } = ghRelease || {};
  if (!asset) throw new Error('Mise à jour introuvable');
  const dir = path.join(ROOT, '_updates'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, asset.name);
  const send = pct => win?.webContents.send('app:updDownload', { version, pct });
  if (exists(dest) && fs.statSync(dest).size === asset.size) { send(100); return dest; }
  log?.write('INFO', `mise à jour en ligne : téléchargement de ${asset.name}`);
  send(0);
  const d = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Arcadia' } });
  if (!d.ok || !d.body) throw new Error(`Téléchargement : HTTP ${d.status}`);
  const part = dest + '.part', out = fs.createWriteStream(part), hash = require('crypto').createHash('sha256');
  let got = 0, last = -1;
  const reader = d.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value); got += buf.length; hash.update(buf);
    if (!out.write(buf)) await new Promise(res => out.once('drain', res));
    const pct = Math.floor(got * 100 / (asset.size || 1));
    if (pct !== last) { last = pct; send(pct); }
  }
  await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
  if (asset.size && got !== asset.size) { fs.rmSync(part, { force: true }); throw new Error('téléchargement incomplet'); }
  const want = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
  if (want && want[1].toLowerCase() !== hash.digest('hex')) { fs.rmSync(part, { force: true }); throw new Error('empreinte sha256 différente : fichier rejeté'); }
  fs.renameSync(part, dest);
  updNotified = version; // le dossier _updates ne redéclenche pas une deuxième bannière
  return dest;
}
ipcMain.handle('app:installOnline', async () => {
  try {
    const file = await downloadRelease();
    const exeDir = path.dirname(app.getPath('exe'));
    const installDir = path.basename(exeDir).toLowerCase() === 'app' ? path.dirname(exeDir) : exeDir;
    log?.write('INFO', `mise à jour en ligne : installation de ${path.basename(file)}`);
    if (process.env.ARCADIA_UPDATE_API) return { ok: true, file }; // essais : pas d'installation
    require('child_process').spawn(file, ['/S', `/D=${installDir}`], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => { app.quit(); setTimeout(() => app.exit(0), 2500); }, 300);
    return { ok: true };
  } catch (e) {
    log?.write('INFO', `mise à jour en ligne : ${e.message}`);
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('app:checkOnline', () => checkGithubUpdate(true));
// Surveille l'arrivée d'une nouvelle version pendant qu'Arcadia est ouvert
let updNotified = null;
function watchUpdates() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  setInterval(() => {
    let u = null; try { u = findUpdate(); } catch { /* dossier indisponible */ }
    if (u && u.version !== updNotified) { updNotified = u.version; win?.webContents.send('app:update', u); }
  }, 15000);
}
// Paramètres → Moteurs : pour chaque console, le moteur utilisé et ce qui lui manque (lecture seule)
ipcMain.handle('engines:list', () => CONSOLES.map(c => {
  const g = { id: '', console: c.id };
  const st = setupFor(g);
  let engine = null, ready = true, need = null;
  if (st?.runner) { engine = 'Moteur Arcadia'; const nb = runnerNeedsBios(c.id); if (nb) { ready = false; need = `${BIOS[nb].label} manquant`; } }
  else if (st && st.exe === arcadiaSwitchExe()) engine = 'Arcadia Switch';
  else if (st) { engine = (KNOWN_EMULATORS[st.emulator] || {}).name || st.emulator; const err = checkSetup(st); if (err) { ready = false; need = 'pas installé'; } }
  else { ready = false; need = 'aucun moteur installé'; }
  if (ready && st && SWITCH_EMUS.includes(st.emulator)) { const n = switchNeeds(st); if (n.keys || n.firmware) { ready = false; need = n.keys ? 'clés (prod.keys) manquantes' : 'firmware manquant'; } }
  if (ready && st?.emulator === 'vita3k' && !vitaFirmwareOk(st.exe)) { ready = false; need = 'firmware manquant'; }
  if (ready && st?.emulator === 'rpcs3' && !ps3FirmwareOk(st.exe)) { ready = false; need = 'firmware manquant'; }
  if (ready && st?.emulator === 'xemu') { const n = xemuNeeds(st.exe); if (n.mcpx || n.bios || n.hdd) { ready = false; need = 'fichiers système manquants'; } }
  return { id: c.id, name: c.name, engine: engine ? engine.replace(/ \(.*\)$/, '') : null, ready, need };
}));
ipcMain.handle('app:openUrl', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---------------------------------------------------------------- IPC : jeux
ipcMain.handle('game:favorite', (_e, id) => { store.toggleFavorite(id); return snapshot(); });

ipcMain.handle('game:rename', (_e, id, name) => {
  const t = store.get('titles');
  if (name && name.trim()) t[id] = name.trim(); else delete t[id];
  store.save();
  return snapshot();
});

ipcMain.handle('game:setCover', async (_e, id) => {
  const res = await dialog.showOpenDialog(win, { title: 'Image du jeu', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (res.canceled || !res.filePaths[0]) return snapshot();
  const ext = path.extname(res.filePaths[0]).slice(1).toLowerCase();
  const dest = mediaPath('custom', `${id}-${Date.now()}`, ext);
  fs.copyFileSync(res.filePaths[0], dest);
  store.get('customCovers')[id] = dest;
  store.save();
  return snapshot();
});

ipcMain.handle('game:resetCover', (_e, id) => {
  delete store.get('customCovers')[id];
  const m = store.get('media')[id];
  if (m) { delete m.coverTried; delete m.cover; delete m.coverSquare; }
  store.save();
  queueMedia();
  return snapshot();
});

ipcMain.handle('game:show', (_e, id) => {
  const g = games.find(x => x.id === id);
  if (g) shell.showItemInFolder(g.path);
});

ipcMain.handle('game:moveTo', async (_e, id, consoleId) => {
  const g = games.find(x => x.id === id);
  const lib = store.get('libraryDir');
  if (!g || !lib || g.console === consoleId) return snapshot();
  const consoleDir = path.join(lib, g.console);
  // On déplace le premier niveau sous le dossier console (le fichier, ou le dossier du jeu)
  const top = path.join(consoleDir, path.relative(consoleDir, g.path).split(path.sep)[0]);
  const dest = await uniqueDest(path.join(lib, consoleId, path.basename(top)));
  await move(top, dest, () => {});
  const oldPaths = games.filter(x => x.path.startsWith(top)).map(x => [x.id, path.join(dest, path.relative(top, x.path))]);
  const { gameId } = require('./src/library');
  for (const [oldId, newPath] of oldPaths) migrateId(oldId, gameId(lib, newPath));
  rescan();
  return snapshot();
});

// Émulateur effectif d'un jeu : réglage du jeu > attribution de la console
// ---------------------------------------------------------------- moteur intégré (arcadia-runner + cœurs libretro)
// Cœurs du moteur intégré, par ordre de préférence. « bios » : fichiers de la console à fournir soi-même
// (dans <données>/system) ; « required » : sans eux, ce cœur ne peut pas démarrer.
const BIOS = {
  PS1: { dir: '', test: n => /^(scph.*|ps1_rom)\.bin$/i.test(n), rename: 'ps1_rom.bin', size: [524288], label: 'BIOS PlayStation (scph5502.bin, scph1001.bin…)', optional: true },
  PS2: { dir: path.join('pcsx2', 'bios'), test: n => /\.(bin|rom0?)$/i.test(n), size: [4194304, 4194304 * 2], label: 'BIOS PlayStation 2 (fichier de 4 Mo)' },
  DREAMCAST: { dir: 'dc', test: n => /^dc_boot\.bin$/i.test(n), rename: 'dc_boot.bin', size: [2097152], label: 'BIOS Dreamcast (dc_boot.bin)', optional: true }
};
const RUNNER_CORES = {
  PSP: ['ppsspp_libretro'], DS: ['melonds_libretro'], '3DS': ['azahar_libretro'],
  PS1: [{ core: 'swanstation_libretro', bios: 'PS1' }, 'pcsx_rearmed_libretro'], // HD avec ton BIOS, sinon BIOS intégré
  NES: ['mesen_libretro'], SNES: ['bsnes_libretro'], GBA: ['mgba_libretro'], GB: ['mgba_libretro'],
  N64: ['mupen64plus_next_libretro'], DREAMCAST: ['flycast_libretro'],
  GAMECUBE: ['dolphin_libretro'], WII: ['dolphin_libretro'],
  PS2: [{ core: 'pcsx2_libretro', bios: 'PS2' }]
};
function runnerDir() { return app.isPackaged ? path.join(process.resourcesPath, 'runner') : path.join(__dirname, 'runner'); }
// Dossier système des cœurs : dans les données d'Arcadia (les BIOS survivent aux mises à jour) ;
// les fichiers livrés avec Arcadia (PPSSPP, Dolphin…) y sont recopiés à chaque nouvelle version.
let SYS_SYNCED = false;
function runnerSystem() {
  const dst = path.join(runnerData(), 'system');
  if (!SYS_SYNCED) {
    SYS_SYNCED = true;
    try {
      const src = path.join(runnerDir(), 'system'), stamp = path.join(dst, '.arcadia-version'), ver = app.getVersion();
      let cur = ''; try { cur = fs.readFileSync(stamp, 'utf8'); } catch { /* première fois */ }
      if (exists(src) && cur !== ver) { fs.mkdirSync(dst, { recursive: true }); fs.cpSync(src, dst, { recursive: true, force: true }); fs.writeFileSync(stamp, ver); }
    } catch (e) { log?.write('INFO', `dossier système du moteur : ${e.message}`); }
  }
  return dst;
}
function biosFiles(id) {
  const b = BIOS[id]; if (!b) return [];
  try { return fs.readdirSync(path.join(runnerSystem(), b.dir)).filter(n => b.test(n) && b.size.includes(fs.statSync(path.join(runnerSystem(), b.dir, n)).size)); } catch { return []; }
}
function runnerFor(consoleId) {
  const list = RUNNER_CORES[consoleId];
  if (!list) return null;
  const dir = runnerDir();
  const exe = path.join(dir, process.platform === 'win32' ? 'arcadia-runner.exe' : 'arcadia-runner');
  if (!exists(exe)) return null;
  for (const c of list) {
    const core = typeof c === 'string' ? c : c.core, bios = typeof c === 'string' ? null : c.bios;
    const lib = path.join(dir, 'cores', core + (process.platform === 'win32' ? '.dll' : '.so'));
    if (!exists(lib)) continue;
    if (bios && !biosFiles(bios).length) continue;
    return { exe, core: lib, system: runnerSystem(), coreName: core };
  }
  return null;
}
// Le cœur existe mais il manque le BIOS obligatoire de la console (ex. PS2)
function runnerNeedsBios(consoleId) {
  for (const c of RUNNER_CORES[consoleId] || []) {
    if (typeof c === 'string' || !c.bios || BIOS[c.bios].optional) continue;
    if (exists(path.join(runnerDir(), 'cores', c.core + (process.platform === 'win32' ? '.dll' : '.so'))) && !biosFiles(c.bios).length) return c.bios;
  }
  return null;
}
ipcMain.handle('controls:get', (_e, consoleId) => ({ consoleId, labels: Controls.labels(consoleId), actions: Controls.ACTIONS, ...Controls.read(controlsDir(), consoleId) }));
ipcMain.handle('controls:set', (_e, consoleId, patch) => {
  let c = Controls.read(controlsDir(), consoleId);
  if (patch.reset) { const d = c.device; c = Controls.defaults(consoleId); c.device = d; }
  if (patch.device && Controls.DEVICES.includes(patch.device)) c.device = patch.device;
  if (patch.assign) Controls.assign(c, patch.assign.kind, patch.assign.action, patch.assign.code);
  Controls.write(controlsDir(), consoleId, c);
  return { consoleId, labels: Controls.labels(consoleId), actions: Controls.ACTIONS, ...c };
});
ipcMain.handle('bios:status', () => Object.fromEntries(Object.entries(BIOS).map(([k, b]) => [k, { label: b.label, optional: !!b.optional, files: biosFiles(k) }])));
// ---------------------------------------------------------------- PS3 : firmware officiel (distribué gratuitement par Sony)
function rpcs3Exe() {
  const m = Object.values(store.get('mapping') || {}).find(x => x.emulator === 'rpcs3' && exists(x.exe));
  if (m) return m.exe;
  for (const d of [EMU_DIR(), store.get('emulatorsDir')].filter(exists)) { const e = detectEmulators(d).rpcs3; if (e) return e; }
  return null;
}
function ps3FirmwareOk(exe) { return !!exe && exists(path.join(path.dirname(exe), 'dev_flash', 'vsh', 'module', 'vsh.self')); }
async function ps3FirmwareUrl() {
  // liste officielle interrogée par les PS3 elles-mêmes : la ligne CDN= donne le fichier PS3UPDAT.PUP actuel
  for (const region of ['fr', 'eu', 'us']) {
    try {
      const r = await net.fetch(`http://fus01.ps3.update.playstation.net/update/ps3/list/${region}/ps3-updatelist.txt`);
      if (!r.ok) continue;
      const m = /CDN=(https?:\/\/[^;\s]+PS3UPDAT\.PUP)/i.exec(await r.text());
      if (m) return m[1];
    } catch { /* région suivante */ }
  }
  return null;
}
ipcMain.handle('ps3:firmware', (_e, mode) => ps3Firmware(mode));
async function ps3Firmware(mode, given) {
  const exe = rpcs3Exe();
  if (!exe) return { ok: false, error: 'RPCS3 est introuvable dans le dossier des émulateurs.' };
  if (ps3FirmwareOk(exe)) return { ok: true, already: true };
  let pup = given || null;
  if (given) mode = 'pick';
  else if (mode === 'pick') {
    const res = await dialog.showOpenDialog(win, { title: 'Choisis PS3UPDAT.PUP', properties: ['openFile'], filters: [{ name: 'Firmware PS3', extensions: ['pup', 'PUP'] }] });
    if (res.canceled) return { ok: false, cancelled: true };
    pup = res.filePaths[0];
  } else {
    const url = await ps3FirmwareUrl();
    if (!url) return { ok: false, manual: true, error: 'Le serveur de Sony n\'a pas répondu.' };
    pup = path.join(app.getPath('temp'), 'PS3UPDAT.PUP');
    const send = p => win?.webContents.send('ps3:progress', p);
    try {
      const r = await net.fetch(url);
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
      const total = Number(r.headers.get('content-length')) || 0;
      const out = fs.createWriteStream(pup); let got = 0, last = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        out.write(Buffer.from(value)); got += value.length;
        if (Date.now() - last > 300) { last = Date.now(); send({ got, total }); }
      }
      await new Promise(res => out.end(res));
      send({ got, total: total || got });
    } catch (e) { return { ok: false, manual: true, error: `Téléchargement impossible (${e.message}).` }; }
  }
  // RPCS3 installe le firmware lui-même (petite fenêtre de progression)
  await new Promise(res => {
    const ch = require('child_process').spawn(exe, ['--installfw', pup], { cwd: path.dirname(exe), stdio: 'ignore' });
    ch.on('exit', res); ch.on('error', res);
  });
  if (mode !== 'pick') { try { fs.unlinkSync(pup); } catch { /* */ } }
  return ps3FirmwareOk(exe) ? { ok: true } : { ok: false, error: 'RPCS3 n\'a pas terminé l\'installation. Réessaie, ou installe-le depuis RPCS3 (Fichier → Installer le firmware).' };
}

// Téléchargement avec progression (fichiers publics des constructeurs : firmware Sony, disque dur vierge de xemu)
async function downloadTo(url, file, channel) {
  const send = p => win?.webContents.send(channel, p);
  const r = await net.fetch(url);
  if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
  const total = Number(r.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file); let got = 0, last = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    out.write(Buffer.from(value)); got += value.length;
    if (Date.now() - last > 300) { last = Date.now(); send({ got, total }); }
  }
  await new Promise(res => out.end(res));
  send({ got, total: total || got });
}
// ---------------------------------------------------------------- PS Vita : firmware + polices officiels (serveurs de Sony)
const VITA_FW = [
  { name: 'PSVUPDAT.PUP', url: 'http://dus01.psv.update.playstation.net/update/psv/image/2022_0209/rel_f2c7b12fe85496ec88a0391b514d6e3b/PSVUPDAT.PUP' },
  { name: 'PSP2UPDAT.PUP', url: 'http://dus01.psp2.update.playstation.net/update/psp2/image/2022_0209/sd_59dcf059d3328fb67be7e51f8aa33418/PSP2UPDAT.PUP' }
];
function vitaExe() {
  const m = Object.values(store.get('mapping') || {}).find(x => x.emulator === 'vita3k' && exists(x.exe));
  if (m) return m.exe;
  for (const d of [EMU_DIR(), store.get('emulatorsDir')].filter(exists)) { const e = detectEmulators(d).vita3k; if (e) return e; }
  return null;
}
function vitaFirmwareOk(exe) {
  if (!exe) return false;
  return [path.dirname(exe), path.join(app.getPath('appData'), 'Vita3K', 'Vita3K')].some(d => exists(path.join(d, 'os0')) && exists(path.join(d, 'vs0')));
}
ipcMain.handle('vita:firmware', (_e, mode) => vitaFirmware(mode));
async function vitaFirmware(mode, given) {
  const exe = vitaExe();
  if (!exe) return { ok: false, error: 'Vita3K est introuvable dans le dossier des émulateurs.' };
  let files = given || [];
  if (given) mode = 'pick';
  else if (mode === 'pick') {
    const res = await dialog.showOpenDialog(win, { title: 'Choisis PSVUPDAT.PUP (et PSP2UPDAT.PUP)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Firmware PS Vita', extensions: ['pup', 'PUP'] }] });
    if (res.canceled) return { ok: false, cancelled: true };
    files = res.filePaths;
  } else {
    try {
      // adresse actuelle du firmware donnée par la liste de mises à jour de Sony (repli : 3.74 connu)
      let sys = VITA_FW[0].url;
      try { const t = await (await net.fetch('http://fus01.psv.update.playstation.net/update/psv/list/eu/psv-updatelist.xml')).text(); const m = /https?:[^"<\s]+PSVUPDAT\.PUP/i.exec(t); if (m) sys = m[0]; } catch { /* liste injoignable */ }
      for (const f of [{ ...VITA_FW[0], url: sys }, VITA_FW[1]]) { const dst = path.join(app.getPath('temp'), f.name); await downloadTo(f.url, dst, 'vita:progress'); files.push(dst); }
    } catch (e) { return { ok: false, manual: true, error: `Téléchargement impossible (${e.message}).` }; }
  }
  for (const f of files) { // Vita3K installe lui-même chaque paquet
    await new Promise(res => { const ch = require('child_process').spawn(exe, ['--firmware', f], { cwd: path.dirname(exe), stdio: 'ignore' }); ch.on('exit', res); ch.on('error', res); });
  }
  if (mode !== 'pick') for (const f of files) { try { fs.unlinkSync(f); } catch { /* */ } }
  return vitaFirmwareOk(exe) ? { ok: true } : { ok: false, error: 'Vita3K n\'a pas terminé l\'installation. Réessaie, ou installe-le depuis Vita3K (Fichier → Installer le firmware).' };
}
// ---------------------------------------------------------------- Xbox (xemu) : BIOS + MCPX (de la console du joueur) + disque dur vierge (fourni par xemu)
const XEMU_HDD = 'https://github.com/xemu-project/xemu-hdd-image/releases/latest/download/xbox_hdd.qcow2.zip';
function xemuToml(exe) {
  const local = path.join(path.dirname(exe), 'xemu.toml');
  return exists(local) ? local : path.join(app.getPath('appData'), 'xemu', 'xemu', 'xemu.toml');
}
function xemuNeeds(exe) {
  let t = ''; try { t = fs.readFileSync(xemuToml(exe), 'utf8'); } catch { /* jamais lancé */ }
  const get = k => { const m = new RegExp(`^\\s*${k}\\s*=\\s*['"](.*)['"]`, 'm').exec(t); return m ? m[1].replace(/\\\\/g, '\\') : ''; };
  return { mcpx: !exists(get('bootrom_path')), bios: !exists(get('flashrom_path')), hdd: !exists(get('hdd_path')) };
}
ipcMain.handle('xbox:install', (_e, what) => xboxInstall(what));
async function xboxInstall(what, given) {
  const exe = Object.values(store.get('mapping') || {}).find(x => x.emulator === 'xemu' && exists(x.exe))?.exe
    || [EMU_DIR(), store.get('emulatorsDir')].filter(exists).map(d => detectEmulators(d).xemu).find(Boolean);
  if (!exe) return { ok: false, error: 'xemu est introuvable dans le dossier des émulateurs.' };
  const dir = path.join(path.dirname(exe), 'arcadia-system'); fs.mkdirSync(dir, { recursive: true });
  const { tomlSet } = require('./src/configfiles');
  const setKey = (key, file) => { const f = xemuToml(exe); let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { /* */ } fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, tomlSet(t, 'sys.files', key, file)); };
  if (what === 'hdd') {
    const zip = path.join(app.getPath('temp'), 'xbox_hdd.qcow2.zip');
    try { await downloadTo(XEMU_HDD, zip, 'xbox:progress'); } catch (e) { return { ok: false, error: `Téléchargement impossible (${e.message}).` }; }
    try { for (const z of require('./src/ziplite').readZip(zip)) if (/\.qcow2$/i.test(z.name)) fs.writeFileSync(path.join(dir, 'xbox_hdd.qcow2'), z.data()); } catch (e) { return { ok: false, error: `Décompression impossible (${e.message}).` }; }
    try { fs.unlinkSync(zip); } catch { /* */ }
    const hdd = path.join(dir, 'xbox_hdd.qcow2'); if (!exists(hdd)) return { ok: false, error: 'Disque dur introuvable dans l\'archive.' };
    setKey('hdd_path', hdd);
    return { ok: true, message: 'Disque dur Xbox installé', need: xemuNeeds(exe) };
  }
  const spec = { mcpx: { title: 'Choisis ta ROM MCPX (512 octets)', sizes: [512], key: 'bootrom_path', name: 'mcpx_1.0.bin' },
                 bios: { title: 'Choisis ton BIOS Xbox (256 Ko ou 1 Mo)', sizes: [262144, 1048576], key: 'flashrom_path', name: 'bios.bin' } }[what];
  if (!spec) return { ok: false, error: 'Fichier inconnu' };
  let src = given;
  if (!src) {
    const res = await dialog.showOpenDialog(win, { title: spec.title, properties: ['openFile'], filters: [{ name: 'ROM', extensions: ['bin', 'rom'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
    if (res.canceled) return { ok: false, cancelled: true };
    src = res.filePaths[0];
  }
  if (!spec.sizes.includes(fs.statSync(src).size)) return { ok: false, error: `Ce fichier n'a pas la bonne taille pour un ${what === 'mcpx' ? 'MCPX' : 'BIOS Xbox'}.` };
  const dst = path.join(dir, spec.name); fs.copyFileSync(src, dst); setKey(spec.key, dst);
  return { ok: true, message: (what === 'mcpx' ? 'MCPX' : 'BIOS Xbox') + ' installé', need: xemuNeeds(exe) };
}

// Installe le BIOS que l'utilisateur a extrait de SA console (copie dans le dossier système du moteur)
ipcMain.handle('bios:install', (_e, id) => biosInstall(id));
async function biosInstall(id, given) {
  const b = BIOS[id]; if (!b) return { ok: false, error: 'Console inconnue' };
  let files = given;
  if (!files) {
    const res = await dialog.showOpenDialog(win, { title: `Choisis ton ${b.label}`, properties: ['openFile', 'multiSelections'], filters: [{ name: 'BIOS', extensions: ['bin', 'rom', 'rom0'] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
    if (res.canceled) return { ok: false, cancelled: true };
    files = res.filePaths;
  }
  const dst = path.join(runnerSystem(), b.dir); fs.mkdirSync(dst, { recursive: true });
  let n = 0; const bad = [];
  for (const f of files) {
    let name = path.basename(f); const size = fs.statSync(f).size;
    if (!b.size.includes(size) || !/\.(bin|rom0?)$/i.test(name)) { bad.push(name); continue; }
    if (!b.test(name)) { if (!b.rename) { bad.push(name); continue; } name = b.rename; } // le cœur cherche un nom précis
    fs.copyFileSync(f, path.join(dst, name)); n++;
    // SwanStation (PS1 HD) ne lit que scph5500/5501/5502.bin ou ps1_rom.bin : copie sous un nom qu'il connaît
    if (id === 'PS1' && !SWAN_ANY.includes(name.toLowerCase()) && !exists(path.join(dst, 'ps1_rom.bin'))) { try { fs.copyFileSync(f, path.join(dst, 'ps1_rom.bin')); } catch { /* */ } }
  }
  if (!n) return { ok: false, error: `Ce fichier ne ressemble pas à un ${b.label}${bad.length ? ` (${bad.join(', ')})` : ''}.` };
  return { ok: true, message: `${n} fichier(s) BIOS installé(s).`, state: snapshot() };
}
function runnerData() {
  const emu = EMU_DIR();
  return emu ? path.join(emu, 'Arcadia') : path.join(app.getPath('userData'), 'runner');
}
// ---------------------------------------------------------------- Manettes (calibrage partagé par tous les moteurs)
// Contrôles par console (périphérique + touches réattribuées), partagés par tous les moteurs Arcadia
function controlsDir() { return path.join(runnerData(), 'controls'); }
function controlsFile(consoleId) { try { return Controls.ensure(controlsDir(), consoleId); } catch { return ''; } }
function padDbPath() { return path.join(runnerData(), 'gamecontrollerdb.txt'); }
function padDbLines() { try { return fs.readFileSync(padDbPath(), 'utf8').split(/\r?\n/).filter(l => /^[0-9a-f]{32},/i.test(l)); } catch { return []; } }
function padDbUpsert(mapping) {
  const guid = mapping.slice(0, 32).toLowerCase();
  const lines = padDbLines().filter(l => l.slice(0, 32).toLowerCase() !== guid);
  lines.push(mapping);
  fs.mkdirSync(path.dirname(padDbPath()), { recursive: true });
  fs.writeFileSync(padDbPath(), '# Manettes calibrées dans Arcadia (format SDL gamecontrollerdb)\n' + lines.join('\n') + '\n');
}
function padRunnerArgs() {
  const inp = settings().input, args = [];
  if (inp && inp.guid && inp.type !== 'keyboard') args.push('--pad-first', inp.guid);
  args.push('--pad-layout', inp && inp.type && inp.type !== 'keyboard' ? inp.type : 'xbox', '--pad-db', padDbPath());
  if (settings().controlsHint === false) args.push('--no-hint');
  return args;
}
// moteurs externes (Eden, Azahar…) : ils lisent SDL_GAMECONTROLLERCONFIG au démarrage
function padEnv() {
  const lines = padDbLines();
  // la manette reste lue même si la fenêtre du jeu perd le focus (menu Arcadia, notification Windows…)
  const env = { ...process.env, SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS: '1' };
  if (lines.length) env.SDL_GAMECONTROLLERCONFIG = lines.join('\n');
  return env;
}
function padDbFor(guid) { return guid ? padDbLines().find(l => l.slice(0, 32).toLowerCase() === guid.toLowerCase()) || '' : ''; }
let calibChild = null;
ipcMain.handle('input:calibrate', (_e, o) => runCalibration(o));
function runCalibration({ layout = 'xbox', full = false } = {}) { return new Promise(resolve => {
  const exe = path.join(runnerDir(), process.platform === 'win32' ? 'arcadia-runner.exe' : 'arcadia-runner');
  if (!exists(exe)) return resolve({ ok: false, error: 'Moteur Arcadia introuvable : réinstalle Arcadia.' });
  if (calibChild) try { calibChild.kill(); } catch { /* déjà fermé */ }
  const args = ['--calibrate', '--layout', layout, ...(full ? ['--full'] : []), ...(exists(padDbPath()) ? ['--pad-db', padDbPath()] : [])];
  const child = calibChild = require('child_process').spawn(exe, args, { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '', result = null;
  child.stdout.on('data', d => {
    buf += d.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      try { const ev = JSON.parse(line); if (ev.event === 'pad' || ev.event === 'cancel') result = ev; } catch { /* autre sortie */ }
    }
  });
  child.on('error', e => resolve({ ok: false, error: e.message }));
  child.on('exit', () => {
    calibChild = null;
    if (!result || result.event === 'cancel') return resolve({ ok: false, cancelled: true });
    if (!result.known && result.mapping) padDbUpsert(result.mapping);
    const input = { type: layout, guid: result.guid, name: result.name.replace(/\s+/g, ' ').trim(), known: !!result.known, at: Date.now() };
    store.data.settings = { ...settings(), input }; store.save();
    log?.write('INFO', `manette ${input.name} (${input.guid}) ${input.known ? 'reconnue' : 'calibrée'}`);
    if (!OV.open) win?.focus();
    resolve({ ok: true, input, state: snapshot() });
  });
}); }
ipcMain.handle('input:set', (_e, input) => { store.data.settings = { ...settings(), input: { ...input, at: Date.now() } }; store.save(); return snapshot(); });

function runnerKey(g) {
  const k = gameKey(g);
  return Saves.safe(k.serial || k.titleId || k.tid3ds || decorate(g).title || g.id);
}
function runnerPaths(g) {
  const data = runnerData();
  return { data, saves: path.join(data, 'saves', g.console), states: path.join(data, 'states', runnerKey(g)), shots: path.join(data, 'captures'), config: path.join(data, 'config') };
}
// Lance le runner ; lit ses évènements (une ligne JSON par évènement sur stdout)
function launchRunner(setup, g, title, onExit, extra = []) {
  const p = runnerPaths(g);
  const args = ['--core', setup.core, '--game', g.path, '--title', title, '--console', g.console, '--key', runnerKey(g),
    '--data', p.data, '--system', setup.system, '--saves', p.saves, '--states', p.states, '--shots', p.shots, '--config', p.config, ...padRunnerArgs(),
    ...(controlsFile(g.console) ? ['--controls', controlsFile(g.console)] : []), ...extra];
  const start = Date.now();
  let seconds = null, error = null, buf = '';
  const accentHex = /^#[0-9a-f]{6}$/i.test(UI_ACCENT.c || '') ? UI_ACCENT.c : '#39e5c8';
  const child = require('child_process').spawn(setup.exe, args, { cwd: path.dirname(setup.exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, env: { ...padEnv(), ARCADIA_ACCENT: accentHex, ARCADIA_STATS: statsFile() } });
  child.stdout.on('data', d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event === 'pad' && ev.guid) { // manette calibrée depuis le menu du jeu : retenue pour tous les jeux
          try { if (!ev.known && ev.mapping) padDbUpsert(ev.mapping); } catch { /* */ }
          const cur = settings().input || {};
          store.data.settings = { ...settings(), input: { type: cur.type && cur.type !== 'keyboard' ? cur.type : 'xbox', guid: ev.guid, name: String(ev.name || '').replace(/\s+/g, ' ').trim(), known: !!ev.known, at: Date.now() } };
          store.save();
        }
        if (ev.event === 'exit') seconds = ev.seconds;
        else if (ev.event === 'error') error = ev.message;
        log?.write('RUNNER', line);
      } catch { /* ligne partielle */ }
    }
  });
  child.stderr.on('data', d => log?.write('RUNNER', d.toString('utf8').trim().slice(0, 500)));
  child.on('error', e => onExit && onExit(0, e.message));
  child.on('exit', code => onExit && onExit(seconds ?? Math.round((Date.now() - start) / 1000), error || (code && seconds === null ? `Le moteur s'est arrêté (code ${code}).` : null)));
  return child.pid;
}

function setupFor(g, external) {
  const base = (store.get('mapping') || {})[g.console];
  const gs = (store.get('gameSettings') || {})[g.id] || {};
  const rn = runnerFor(g.console);
  // une console, un moteur : le moteur Arcadia, sauf s'il a planté sur ce jeu avec cette version (secours automatique)
  const fellBack = gs.fallback === app.getVersion();
  if (rn && !external && !fellBack && settings().useRunner !== false) return { emulator: 'arcadia', runner: true, ...rn };
  let setup = base ? { ...base } : null;
  if (gs.emulator && gs.emulator !== (base && base.emulator)) {
    const e = KNOWN_EMULATORS[gs.emulator];
    const dirs = [EMU_DIR(), store.get('emulatorsDir')].filter(exists);
    const exe = Object.values(store.get('mapping') || {}).find(m => m.emulator === gs.emulator && exists(m.exe))?.exe
      || dirs.map(d => detectEmulators(d)[gs.emulator]).find(Boolean);
    if (e && exe) setup = { emulator: gs.emulator, exe, args: (e.argsByConsole || {})[g.console] || e.args };
  }
  // Switch sans émulateur installé : le moteur Switch d'Arcadia, fourni avec Arcadia
  if (!setup && (g.console === 'SWITCH' || g.console === 'SWITCH 2') && arcadiaSwitchExe()) setup = { emulator: 'edencli', exe: arcadiaSwitchExe(), args: KNOWN_EMULATORS.edencli.args };
  if (setup && gs.extraArgs) setup.args = `${gs.extraArgs} ${setup.args}`;
  return setup;
}

function savesRoot() {
  const st = settings();
  if (st.savesDir) return st.savesDir;
  return ROOT ? path.join(ROOT, 'Sauvegardes') : path.join(app.getPath('userData'), 'saves');
}
// Identifiant d'un jeu pour isoler SES sauvegardes (Switch : Title ID, 3DS : Title ID, PSP : numéro de série)
function gameKey(g) {
  const m = store.get('media')[g.id] || {};
  if (isSwitch(g)) return { titleId: m.titleId || keylessId(g) || titleIdFrom(g.file) };
  try {
    if (g.console === '3DS' && /\.(3ds|cci)$/i.test(g.path)) {
      const fd = fs.openSync(g.path, 'r'); const b = Buffer.alloc(0x110); fs.readSync(fd, b, 0, 0x110, 0); fs.closeSync(fd);
      if (b.toString('ascii', 0x100, 0x104) === 'NCSD') return { tid3ds: b.readUInt32LE(0x108).toString(16).padStart(8, '0') };
    }
    if (g.console === 'PSP') {
      const fromName = (g.file.match(/\b([A-Z]{4}\d{5})\b/) || [])[1];
      if (fromName) return { serial: fromName };
      if (m.serial) return { serial: m.serial };
    }
  } catch { /* clé inconnue : toutes les sauvegardes de l'émulateur sont copiées */ }
  return null;
}
const gameSavesDir = g => Saves.gameDir(savesRoot(), g.console, decorate(g).title);
function saveCtx(setup, g) {
  const c = { ...emuCtx(setup.emulator), exe: setup.exe, exeDir: path.dirname(setup.exe) };
  if (setup.runner && g) Object.assign(c, runnerPaths(g), { console: g.console });
  return c;
}
function backupFor(g, force) {
  const setup = setupFor(g);
  if (!setup?.emulator || (!KNOWN_EMULATORS[setup.emulator] && !setup.runner)) return { skipped: 'émulateur inconnu' };
  return Saves.backup({ dir: gameSavesDir(g), emuId: setup.emulator, ctx: saveCtx(setup, g), romPath: g.path, gameTitle: decorate(g).title, key: gameKey(g), force });
}

// ---------------------------------------------------------------- Switch : clés et firmware
const SWITCH_EMUS = ['eden', 'lichii', 'edencli'];
// Moteur Switch d'Arcadia (Eden recompilé : manette + clavier lus par Arcadia, vibrations, nom et icône Arcadia)
function arcadiaSwitchExe() {
  const e = path.join(runnerDir(), 'switch', process.platform === 'win32' ? 'arcadia-switch.exe' : 'arcadia-switch');
  return exists(e) ? e : null;
}
// Dossier de données d'un émulateur Switch (portable « user » à côté de l'exe, sinon AppData)
function switchDataDir(exe, id) {
  const portable = path.join(path.dirname(exe), 'user');
  if (exists(portable)) return portable;
  return path.join(app.getPath('appData'), id === 'edencli' ? 'eden' : id);
}
function switchNeeds(setup) {
  const dir = switchDataDir(setup.exe, setup.emulator);
  let keys = true, firmware = true;
  try { keys = !/^\s*header_key\s*=/m.test(fs.readFileSync(path.join(dir, 'keys', 'prod.keys'), 'utf8')); } catch { /* absent */ }
  try { firmware = !fs.readdirSync(path.join(dir, 'nand', 'system', 'Contents', 'registered')).some(n => n.toLowerCase().endsWith('.nca')); } catch { /* absent */ }
  return { keys, firmware, dir };
}
// Tous les dossiers Switch connus (Eden, Lichii, moteur sans interface) : une installation sert partout
function switchTargets() {
  const dirs = new Set();
  const all = Object.assign({}, ...[EMU_DIR(), store.get('emulatorsDir')].filter(exists).map(d => detectEmulators(d)));
  for (const m of Object.values(store.get('mapping') || {})) if (SWITCH_EMUS.includes(m.emulator) && exists(m.exe)) all[m.emulator] = m.exe;
  for (const id of SWITCH_EMUS) if (all[id]) dirs.add(switchDataDir(all[id], id));
  if (arcadiaSwitchExe()) dirs.add(switchDataDir(arcadiaSwitchExe(), 'edencli')); // moteur Switch d'Arcadia
  for (const d of [EMU_DIR(), store.get('emulatorsDir')].filter(exists)) { const e = path.join(d, 'Eden', 'user'); if (exists(path.dirname(e))) dirs.add(e); } // Eden à venir
  return [...dirs];
}
// ---------------------------------------------------------------- Fonds d'écran (recherche Wallhaven, images publiques)
const WALL_RES = ['1280x720', '1920x1080', '2560x1440', '3840x2160'];
// Fonds d'écran : Wallhaven (fonds d'écran, tout public) + Openverse (images libres, contenu adulte exclu, GIF compris)
async function wallhavenSearch(q, res, page) {
  const u = new URL('https://wallhaven.cc/api/v1/search');
  // contenu tout public seulement : images « SFW », sans la catégorie « personnes », mots-clés suggestifs exclus
  const NOT = ['sexy', 'ecchi', 'lingerie', 'bikini', 'swimwear', 'underwear', 'cleavage', 'nude', 'ass', 'boobs', 'panties', 'stockings', 'thighs', 'feet', 'pantyhose', 'erotic', 'big boobs', 'women'].map(t => '-' + (t.includes(' ') ? `"${t}"` : t)).join(' ');
  u.searchParams.set('q', `${String(q || '').slice(0, 120)} ${NOT}`.trim()); u.searchParams.set('purity', '100'); u.searchParams.set('categories', '110');
  u.searchParams.set('sorting', q ? 'relevance' : 'toplist'); u.searchParams.set('topRange', '1y'); u.searchParams.set('page', String(page));
  if (res[0]) u.searchParams.set('atleast', res[0]);
  u.searchParams.set('ratios', '16x9,16x10,21x9,32x9');
  const r = await net.fetch(u.toString(), { headers: { 'User-Agent': 'Arcadia' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return { last: j.meta?.last_page || page, items: (j.data || []).map(w => ({ id: 'wh-' + w.id, full: w.path, thumb: w.thumbs?.large || w.thumbs?.original, res: w.resolution, type: (w.file_type || '').replace('image/', ''), size: w.file_size })) };
}
async function openverseSearch(q, res, types, page) {
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', String(q || '').trim().slice(0, 120) || 'landscape wallpaper');
  u.searchParams.set('page', String(page)); u.searchParams.set('page_size', '20');
  u.searchParams.set('aspect_ratio', 'wide'); u.searchParams.set('size', 'large'); u.searchParams.set('mature', 'false');
  const ext = (types || []).map(t => (t === 'jpeg' ? 'jpg' : t)).filter(t => ['jpg', 'png', 'gif', 'webp'].includes(t));
  u.searchParams.set('extension', (ext.length ? ext : ['jpg', 'png', 'gif', 'webp']).join(','));
  const r = await net.fetch(u.toString(), { headers: { 'User-Agent': 'Arcadia' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const minW = res[0] ? parseInt(res[0], 10) : 0;
  return { last: Math.min(j.page_count || page, 20), items: (j.results || []).filter(x => !x.mature && (x.width || 0) >= minW).map(x => ({
    id: 'ov-' + x.id, full: x.url, thumb: x.thumbnail || x.url, res: x.width && x.height ? `${x.width}x${x.height}` : '', type: String(x.filetype || path.extname(new URL(x.url).pathname).slice(1) || 'jpg').toLowerCase(), size: x.filesize || 0 })) };
}
ipcMain.handle('wall:search', async (_e, { q, res = [], types = [], page = 1 }) => {
  const r0 = (res || []).filter(x => WALL_RES.includes(x)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); // « au moins » la plus petite choisie
  const onlyGif = types && types.length && types.every(t => t === 'gif'); // Wallhaven n'a presque pas de GIF
  const [a, b] = await Promise.allSettled([onlyGif ? Promise.resolve({ last: 0, items: [] }) : wallhavenSearch(q, r0, page), openverseSearch(q, r0, types, page)]);
  const A = a.status === 'fulfilled' ? a.value : { last: 0, items: [] }, B = b.status === 'fulfilled' ? b.value : { last: 0, items: [] };
  if (a.status === 'rejected' && b.status === 'rejected') return { ok: false, error: `Recherche impossible (${a.reason?.message || b.reason?.message})` };
  const items = []; // en alternance : fonds d'écran et images libres
  for (let i = 0; i < Math.max(A.items.length, B.items.length); i++) { if (A.items[i]) items.push(A.items[i]); if (B.items[i]) items.push(B.items[i]); }
  return { ok: true, page, last: Math.max(A.last, B.last, page), items };
});
function wallName(url) { // nom de fichier sûr, avec son extension d'image
  let n = decodeURIComponent(path.basename(new URL(url).pathname) || 'image').replace(/[^\w.\-]+/g, '_').slice(-80);
  if (!/\.(jpe?g|png|gif|webp)$/i.test(n)) n += '.jpg';
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 8) + '-' + n;
}
function wallDir() { const d = path.join(MEDIA(), 'backgrounds'); fs.mkdirSync(d, { recursive: true }); return d; }
async function fetchFile(url, file) {
  if (!/^https:\/\//.test(url)) throw new Error('adresse refusée');
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Arcadia' } }); if (!r.ok) throw new Error('HTTP ' + r.status);
  if (!/^image\//.test(r.headers.get('content-type') || '')) throw new Error('ce n\'est pas une image');
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
ipcMain.handle('wall:install', async (_e, url) => {
  try {
    const f = path.join(wallDir(), wallName(url)); if (!exists(f)) await fetchFile(url, f);
    store.data.settings = { ...settings(), bgMode: 'custom', bgImage: f }; store.save();
    return { ok: true, state: snapshot() };
  } catch (e) { return { ok: false, error: `Installation impossible (${e.message})` }; }
});
ipcMain.handle('wall:local', async () => { // image de l'ordinateur
  const r = await dialog.showOpenDialog(win, { title: 'Choisis une image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }] });
  if (r.canceled) return { ok: false, cancelled: true };
  const f = path.join(wallDir(), 'perso-' + Date.now() + path.extname(r.filePaths[0])); fs.copyFileSync(r.filePaths[0], f);
  store.data.settings = { ...settings(), bgMode: 'custom', bgImage: f }; store.save();
  return { ok: true, state: snapshot() };
});
ipcMain.handle('wall:download', async (_e, url) => {
  const name = wallName(url);
  const r = await dialog.showSaveDialog(win, { title: 'Enregistrer le fond d\'écran', defaultPath: path.join(app.getPath('pictures'), name) });
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
  try { await fetchFile(url, r.filePath); return { ok: true, file: r.filePath }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ui:windowsAccent', () => { try { return '#' + systemPreferences.getAccentColor().slice(0, 6); } catch { return null; } });
// Transparence : matériau acrylique de Windows 11 derrière l'interface
function applyWindowMaterial() {
  if (!win || process.platform !== 'win32') return;
  try { win.setBackgroundMaterial(settings().bgMode === 'transparent' ? 'acrylic' : 'none'); } catch { /* Windows 10 */ }
}
ipcMain.handle('ui:material', () => applyWindowMaterial());

// Au démarrage : des jeux Switch mais pas de clés / firmware → Arcadia le signale une fois
ipcMain.handle('switch:need', () => {
  const g = games.find(isSwitch); if (!g) return null;
  const setup = setupFor(g); if (!setup || !SWITCH_EMUS.includes(setup.emulator)) return null;
  const n = switchNeeds(setup);
  return n.keys || n.firmware ? { keys: n.keys, firmware: n.firmware } : null;
});
ipcMain.handle('switch:install', (_e, what) => switchInstall(what));
async function switchInstall(what, given) {
  const targets = switchTargets();
  if (!targets.length) return { ok: false, error: 'Aucun émulateur Switch installé.' };
  try {
    if (what === 'keys') {
      let src = given;
      if (!src) {
        const res = await dialog.showOpenDialog(win, { title: 'Choisis ton prod.keys', properties: ['openFile'], filters: [{ name: 'Clés Switch', extensions: ['keys'] }] });
        if (res.canceled) return { ok: false };
        src = res.filePaths[0];
      }
      if (!/^\s*header_key\s*=/m.test(fs.readFileSync(src, 'utf8'))) return { ok: false, error: 'Ce fichier ne contient pas de header_key : ce n\'est pas un prod.keys valide.' };
      for (const t of targets) {
        fs.mkdirSync(path.join(t, 'keys'), { recursive: true });
        fs.copyFileSync(src, path.join(t, 'keys', 'prod.keys'));
        const tk = path.join(path.dirname(src), 'title.keys'); if (exists(tk)) fs.copyFileSync(tk, path.join(t, 'keys', 'title.keys'));
      }
      return { ok: true, message: `Clés installées pour ${targets.length} émulateur(s) Switch.` };
    }
    if (what === 'firmware') {
      let srcDir = given, tmp = null;
      if (!srcDir) {
        const res = await dialog.showOpenDialog(win, { title: 'Choisis ton firmware (.zip ou dossier de .nca)', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Firmware', extensions: ['zip', '7z'] }] });
        if (res.canceled) return { ok: false };
        srcDir = res.filePaths[0];
      }
      if (!fs.statSync(srcDir).isDirectory()) {
        tmp = path.join(app.getPath('temp'), 'arcadia-firmware');
        fs.rmSync(tmp, { recursive: true, force: true });
        const { extractArchive } = require('./src/importer');
        await extractArchive(srcDir, tmp, () => {});
        srcDir = tmp;
      }
      const ncas = listFiles(srcDir, '.nca');
      if (!ncas.length) { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, error: 'Aucun fichier .nca : ce n\'est pas un firmware Switch.' }; }
      for (const t of targets) {
        const reg = path.join(t, 'nand', 'system', 'Contents', 'registered');
        fs.mkdirSync(reg, { recursive: true });
        for (const f of ncas) fs.copyFileSync(f, path.join(reg, path.basename(f)));
      }
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: true, message: `Firmware installé (${ncas.length} fichiers) pour ${targets.length} émulateur(s) Switch.` };
    }
    return { ok: false, error: 'Action inconnue' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---------------------------------------------------------------- menu Arcadia par-dessus un émulateur externe
// Échap, Guide ou Back+Start bref : le jeu est mis en pause (processus suspendu) et le menu Arcadia s'affiche.
const OV = { win: null, game: null, open: false, relaunch: null };
const UI_ACCENT = { c: null, on: null }; // couleur des boutons d'Arcadia, reprise par le menu Échap
// Langue de l'interface (fr / en) : boîtes de dialogue Windows, moteur Arcadia, fiches des jeux
function setUiLang(l) {
  I18N.setLang(l); GameInfo.setLang(I18N.lang); process.env.ARCADIA_LANG = I18N.lang;
}
{
  const tr = o => {
    if (!o || typeof o !== 'object') return o;
    const r = { ...o };
    for (const k of ['title', 'message', 'detail', 'buttonLabel', 'checkboxLabel']) if (typeof r[k] === 'string') r[k] = I18N.t(r[k]);
    if (Array.isArray(r.buttons)) r.buttons = r.buttons.map(b => I18N.t(b));
    if (Array.isArray(r.filters)) r.filters = r.filters.map(f => ({ ...f, name: I18N.t(f.name) }));
    return r;
  };
  for (const fn of ['showOpenDialog', 'showSaveDialog', 'showMessageBox', 'showOpenDialogSync', 'showSaveDialogSync', 'showMessageBoxSync']) {
    const orig = dialog[fn].bind(dialog);
    dialog[fn] = (a, b) => (b === undefined ? orig(tr(a)) : orig(a, tr(b)));
  }
  const eb = dialog.showErrorBox.bind(dialog);
  dialog.showErrorBox = (t, c) => eb(I18N.t(t), I18N.t(c));
}
ipcMain.on('ui:reload', e => e.sender.reload());
ipcMain.handle('ui:lang', (_e, l) => {
  store.data.settings = { ...settings(), uiLang: l === 'en' ? 'en' : 'fr' }; store.save();
  setUiLang(l); return I18N.lang;
});
ipcMain.on('ui:accent', (_e, c, on) => { UI_ACCENT.c = typeof c === 'string' && /^#[0-9a-f]{6}$|^rgb/i.test(c) ? c : null; UI_ACCENT.on = typeof on === 'string' ? on : null; });
// Réglages proposés dans le menu Arcadia des moteurs Switch (appliqués au prochain lancement du jeu)
const SW_OPTS = [
  { sec: 'image', key: 'Renderer/resolution_setup', hint: 'S\'applique en relançant le jeu.', label: 'Résolution', values: [['1', '0,5x · 540p'], ['3', '1x · 1080p'], ['5', '1,5x · 1620p'], ['6', '2x · 4K'], ['7', '3x · 6K']], def: '3' },
  { sec: 'image', key: 'System/use_docked_mode', hint: 'S\'applique en relançant le jeu.', label: 'Mode de la console', values: [['1', 'TV · meilleure image'], ['0', 'Portable · plus léger']], def: '1' },
  { sec: 'image', key: 'Arcadia/hud', label: 'Compteur d\'images/s', values: [['false', 'Masqué'], ['true', 'Affiché']], def: 'false', hint: 'Position et taille : Paramètres → Interface.' },
  { sec: 'image', key: 'Arcadia/fps60', label: '60 images/s (patch du jeu)', values: [['on', 'Activé si disponible'], ['off', 'Désactivé']], def: 'on', hint: 'Vrais 60 images/s, sans taches : patch communautaire (base NX-60FPS) installé tout seul s\'il existe pour ce jeu et cette version.' },
  { sec: 'image', key: 'Renderer/nvidia_dlss', label: 'DLSS NVIDIA (jeux Switch 2)', values: [['false', 'Désactivé'], ['true', 'Activé · RTX']], def: 'false', hint: 'Remplace l\'agrandissement intégré des jeux Switch 2 par le vrai DLSS de ta carte NVIDIA RTX : plus net, plus fluide.' },
  { sec: 'image', key: 'Renderer/use_vsync', hint: 'S\'applique en relançant le jeu.', label: 'Synchronisation verticale', values: [['2', 'Activée'], ['1', 'Mailbox · faible latence'], ['0', 'Désactivée']], def: '2' },
  { sec: 'image', key: 'Renderer/anti_aliasing', live: true, hint: 'S\'applique tout de suite.', label: 'Anticrénelage', values: [['0', 'Aucun'], ['1', 'FXAA'], ['2', 'SMAA']], def: '1' },
  { sec: 'image', key: 'Renderer/scaling_filter', live: true, hint: 'S\'applique tout de suite.', label: 'Filtre d\'agrandissement', values: [['1', 'Bilinéaire'], ['5', 'ScaleForce'], ['6', 'AMD FSR']], def: '6' },
  { sec: 'image', key: 'Renderer/aspect_ratio', live: true, hint: 'S\'applique tout de suite.', label: 'Format', values: [['0', '16:9'], ['4', 'Étirer à l\'écran']], def: '0' },
  { sec: 'son', key: 'Audio/volume', live: true, hint: 'S\'applique tout de suite.', label: 'Volume', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => [String(v), v + ' %']), def: '100' },
  { sec: 'son', key: 'Audio/audio_muted', live: true, hint: 'S\'applique tout de suite.', label: 'Couper le son', values: [['false', 'Non'], ['true', 'Oui']], def: 'false' },
  { sec: 'manette', key: 'Arcadia/control', label: 'Jouer avec', values: [['pad', 'Ma manette'], ['keyboard', 'Le clavier']], def: 'pad', hint: 'Le moteur Switch n\'accepte qu\'une commande par touche : manette OU clavier.' },
  { sec: 'manette', key: 'Arcadia/mouse', label: 'Souris (avec le clavier)', values: [['camera', 'Caméra + clics (ZR · ZL)'], ['off', 'Désactivée']], def: 'camera', hint: 'Bouger la souris tourne la caméra (stick droit). S\'applique en relançant le jeu.' },
  { sec: 'manette', key: 'Controls/vibration_enabled', label: 'Vibrations', values: [['true', 'Activées'], ['false', 'Désactivées']], def: 'true' }
];
// Langue retenue pour un jeu : choix du joueur, sinon le français s'il est dans la ROM
function gameLang(g) {
  const gs = (store.get('gameSettings') || {})[g.id] || {};
  return Langs.pick(gs.lang || null, decorate(g).langs, I18N.lang);
}
// Images intermédiaires : choix Arcadia → réglages du moteur (frame_gen + type : 1 Optical Flow, 2 DLSS Frame Generation)
function frameGenChoice(o) { return o['Arcadia/frame_gen'] || (o['Renderer/frame_gen'] === 'true' ? 'of' : 'off'); }
function swEngineOpts(id) {
  const o = { ...extOpts(id) };
  let fg = 'off'; // images intermédiaires retirées : taches visibles même en DLSS sur des jeux émulés à 30 images/s
  delete o['Arcadia/frame_gen'];
  if (o['Renderer/nvidia_dlss'] === 'true' && !streamlineReady()) { installStreamline().catch(() => {}); o['Renderer/nvidia_dlss'] = 'false'; }
  if (fg === 'dlss' && !streamlineReady()) { // fichiers NVIDIA pas encore là : on les télécharge, sans images intermédiaires cette fois
    log?.write('INFO', 'DLSS Frame Generation : fichiers NVIDIA absents, téléchargement en arrière-plan');
    installStreamline().catch(() => {});
    fg = 'off';
  }
  o['Renderer/frame_gen'] = fg === 'off' ? 'false' : 'true';
  o['Renderer/frame_gen_type'] = fg === 'dlss' ? '2' : '1';
  return o;
}
// NVIDIA Streamline (DLSS Frame Generation) : SDK officiel de NVIDIA sur GitHub, extrait dans <dossier Switch>/streamline
const STREAMLINE_ZIP = 'https://github.com/NVIDIA-RTX/Streamline/releases/download/v2.14.16/streamline-sdk-v2.14.16.zip';
const STREAMLINE_FILES = ['sl.interposer.dll', 'sl.common.dll', 'sl.dlss.dll', 'sl.dlss_g.dll', 'sl.reflex.dll', 'sl.pcl.dll', 'nvngx_dlssg.dll', 'NvLowLatencyVk.dll'];
function streamlineReady() {
  const dir = arcadiaSwitchExe() && switchDataDir(arcadiaSwitchExe(), 'edencli');
  return !!dir && STREAMLINE_FILES.every(f => exists(path.join(dir, 'streamline', f)));
}
let streamlineJob = null;
function installStreamline() {
  if (streamlineJob) return streamlineJob;
  streamlineJob = (async () => {
    const tmp = path.join(app.getPath('temp'), 'arcadia-streamline.zip');
    try {
      await downloadTo(STREAMLINE_ZIP, tmp, 'dlss:progress');
      const want = new Set([...STREAMLINE_FILES, 'nvngx_dlss.dll', 'nvngx_dlss.license.txt', 'reflex.license.txt'].map(n => n.toLowerCase()));
      const entries = require('./src/ziplite').readZip(tmp).filter(z => /^bin\/x64\/[^/]+$/i.test(z.name) && want.has(path.basename(z.name).toLowerCase()));
      if (!entries.some(z => /sl\.dlss_g\.dll$/i.test(z.name))) throw new Error('archive NVIDIA inattendue');
      for (const d of switchTargets()) {
        const out = path.join(d, 'streamline'); fs.mkdirSync(out, { recursive: true });
        for (const z of entries) fs.writeFileSync(path.join(out, path.basename(z.name)), z.data());
      }
      log?.write('INFO', `DLSS Frame Generation : ${entries.length} fichiers NVIDIA installés`);
      win?.webContents.send('dlss:progress', { done: true });
      return true;
    } catch (e) {
      log?.write('ERREUR', `DLSS Frame Generation : ${e.message}`);
      win?.webContents.send('dlss:progress', { error: e.message });
      return false;
    } finally { try { fs.unlinkSync(tmp); } catch { /* déjà parti */ } streamlineJob = null; }
  })();
  return streamlineJob;
}
// Patchs 60 images/s : base communautaire NX-60FPS-RES-GFX-Cheats (titles/<id du jeu>/cheats/<build id>.txt).
// Seules les lignes « 60 FPS » sont gardées, posées comme une modification du jeu dans le dossier du moteur.
const FPS60_RAW = 'https://raw.githubusercontent.com/ChanseyIsTheBest/NX-60FPS-RES-GFX-Cheats/main/titles';
function engineBuildId(userDir) { // build id du programme principal, lu dans le journal du moteur
  try { const m = /build_id=([0-9A-F]{16,64}), name=main/i.exec(fs.readFileSync(path.join(userDir, 'log', 'eden_log.txt'), 'utf8')); return m ? m[1].slice(0, 16).toUpperCase() : null; } catch { return null; }
}
function only60fps(txt) { // garde les sections [..60 FPS..] (et leurs lignes), sans les variantes 30/45 ni la résolution
  const out = []; let keep = false, any = false;
  for (const line of String(txt).split(/\r?\n/)) {
    const h = /^\s*[\[{](.*)[\]}]\s*$/.exec(line);
    if (h) keep = /^\s*\{/.test(line) || (/60\s*fps|fps\s*60|unlock/i.test(h[1]) && !/30|45|dynamic res|resolution/i.test(h[1])); // {code maître} : toujours gardé
    if (h && keep && !/^\s*\{/.test(line)) any = true;
    if (keep) out.push(line);
  }
  return any ? out.join('\n').trim() : '';
}
// Tous les patchs 60 images/s connus pour ce jeu (une version = un fichier) : le moteur prend celui de la version installée
async function applyFps60(g, on) {
  const tid = String(decorate(g).titleId || titleIdFrom(g.file) || '').toUpperCase();
  if (!/^0[0-9A-F]{15}$/.test(tid)) return { ok: false, why: 'identifiant du jeu inconnu' };
  const dirs = switchTargets().map(d => path.join(d, 'load', tid, 'Arcadia 60 FPS', 'cheats'));
  if (!on) { for (const d of dirs) { try { for (const f of fs.readdirSync(d)) fs.writeFileSync(path.join(d, f), ''); } catch { /* rien d'installé */ } } return { ok: true, off: true }; }
  const r = await net.fetch(`https://api.github.com/repos/ChanseyIsTheBest/NX-60FPS-RES-GFX-Cheats/contents/titles/${tid}/cheats`, { headers: { 'User-Agent': 'Arcadia', Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return { ok: false, none: true, why: 'aucun patch 60 images/s pour ce jeu' };
  if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
  const list = (await r.json()).filter(f => /^[0-9A-F]{16}\.txt$/i.test(f.name));
  let n = 0;
  for (const f of list) {
    const t = await net.fetch(`${FPS60_RAW}/${tid}/cheats/${f.name}`); if (!t.ok) continue;
    const keep = only60fps(await t.text()); if (!keep) continue;
    for (const d of dirs) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, f.name.toUpperCase()), keep + '\n'); }
    n++;
  }
  if (!n) return { ok: false, none: true, why: 'aucun patch 60 images/s pour ce jeu' };
  log?.write('INFO', `60 images/s : ${n} version(s) de ${decorate(g).title} couvertes`);
  return { ok: true, n };
}
// ---- PSP et PS1 (moteur Arcadia) : bases de codes publiques, gardées en cache dans le dossier du moteur
const patchesDir = () => path.join(runnerData(), 'patches');
const fps60On = g => settings().fps60Auto !== false && (extOpts(g.id)['Arcadia/fps60'] || 'on') === 'on';
let pspDbCache = null;
function pspDb() {
  if (pspDbCache) return pspDbCache;
  try { pspDbCache = Patches.parsePspDb(fs.readFileSync(path.join(patchesDir(), 'psp-cheat.db'), 'utf8')); } catch { pspDbCache = null; }
  return pspDbCache;
}
async function refreshPspDb(force) {
  const f = path.join(patchesDir(), 'psp-cheat.db');
  try { if (!force && Date.now() - fs.statSync(f).mtimeMs < 7 * 864e5) return; } catch { /* absent */ }
  const r = await net.fetch(Patches.PSP_DB_URL); if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text(); if (!/^_S /m.test(t)) throw new Error('base PSP inattendue');
  fs.mkdirSync(patchesDir(), { recursive: true }); fs.writeFileSync(f, t); pspDbCache = null;
  log?.write('INFO', `60 images/s PSP : base à jour (${pspDb()?.size || 0} jeux)`);
}
async function cachePs1(serial) {
  const id = Patches.dashSerial(serial); if (!id) return;
  const f = path.join(patchesDir(), 'PS1', id + '.txt');
  try { if (Date.now() - fs.statSync(f).mtimeMs < 7 * 864e5 && exists(f.replace(/\.txt$/, '.ws.txt'))) return; } catch { /* absent */ }
  const texts = [];
  for (const d of ['patches', 'cheats']) { const r = await net.fetch(`${Patches.PS1_RAW}/${d}/${id}.cht`); if (r.ok) texts.push(await r.text()); else if (r.status !== 404) throw new Error('HTTP ' + r.status); }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Patches.ps1Sixty(...texts).join('\n')); // vide = pas de patch
  fs.writeFileSync(f.replace(/\.txt$/, '.ws.txt'), Patches.ps1Wide(...texts).join('\n'));
}
// Patch 16:9 PS1 prêt pour ce jeu (et activé dans les paramètres)
function ps1WideFile(g) {
  if (g.console !== 'PS1' || settings().ps1Wide === false) return null;
  const id = Patches.dashSerial(decorate(g).serial); if (!id) return null;
  const f = path.join(patchesDir(), 'PS1', id + '.ws.txt');
  try { return fs.readFileSync(f, 'utf8').trim() ? f : null; } catch { return null; }
}
// Options du cœur liées aux patchs (PPSSPP : lire les triches)
function runnerPatchOpts(g) {
  if (g.console === 'PSP') return ['ppsspp_cheats=enabled'];
  if (ps1WideFile(g) && setupFor(g)?.coreName === 'swanstation_libretro') return ['swanstation_Display_AspectRatio=16:9'];
  return [];
}
// Prépare les patchs d'un jeu juste avant de le lancer ; renvoie les arguments du moteur
function runnerPatchArgs(g) {
  const on = fps60On(g), serial = decorate(g).serial;
  try {
    if (g.console === 'PSP' && Patches.plainSerial(serial)) {
      const entry = pspDb()?.get(Patches.plainSerial(serial)), c = Patches.pickPsp60(entry);
      const dir = path.join(runnerPaths(g).saves, 'PSP', 'Cheats'), file = path.join(dir, Patches.plainSerial(serial) + '.ini');
      if (c) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, Patches.pspIni(serial, entry.title, c, on)); log?.write('INFO', `60 images/s PSP : ${c.name} ${on ? 'activé' : 'désactivé'}`); }
      else if (!pspDb()) refreshPspDb().catch(() => {}); // base pas encore là : prête pour la prochaine partie
    }
    if (g.console === 'PS1' && Patches.dashSerial(serial)) {
      const id = Patches.dashSerial(serial), f = path.join(patchesDir(), 'PS1', id + '.txt');
      if (!exists(f) || !exists(f.replace(/\.txt$/, '.ws.txt'))) { cachePs1(serial).catch(() => {}); }
      const parts = [];
      if (on && exists(f) && fs.readFileSync(f, 'utf8').trim()) { parts.push(fs.readFileSync(f, 'utf8').trim()); log?.write('INFO', '60 images/s PS1 : patch activé'); }
      const ws = ps1WideFile(g);
      if (ws && setupFor(g)?.coreName === 'swanstation_libretro') { parts.push(fs.readFileSync(ws, 'utf8').trim()); log?.write('INFO', 'écran large PS1 : patch 16:9 activé'); }
      if (parts.length) { const run = path.join(patchesDir(), 'PS1', id + '.run.txt'); fs.writeFileSync(run, parts.join('\n')); return ['--cheats', run]; }
    }
  } catch (e) { log?.write('INFO', `patchs : ${e.message}`); }
  return [];
}
// Par défaut, dès qu'un jeu Switch est dans la bibliothèque (une fois par jeu, revérifié chaque semaine)
let fps60Busy = false;
async function fps60Sweep() {
  if (fps60Busy || settings().fps60Auto === false) return; fps60Busy = true;
  try {
    // PSP : toute la base (couvre tous les jeux qui ont un code), PS1 : jeux de la bibliothèque + les 15 plus joués
    try { await refreshPspDb(); } catch (e) { log?.write('INFO', `60 images/s PSP : ${e.message}`); }
    const ps1 = new Set([...games.filter(g => g.console === 'PS1').map(g => decorate(g).serial), ...Patches.TOP.PS1].map(Patches.dashSerial).filter(Boolean));
    for (const s of ps1) { try { await cachePs1(s); } catch { break; } }
    // Switch : les 15 plus joués, même absents de la bibliothèque (prêts le jour où le jeu arrive)
    const owned = new Set(games.filter(isSwitch).map(g => String(decorate(g).titleId || titleIdFrom(g.file) || '').toUpperCase()));
    const done = store.get('fps60Top') || {};
    for (const tid of Patches.TOP.SWITCH) {
      if (owned.has(tid) || (done[tid] && Date.now() - done[tid] < 7 * 864e5)) continue;
      let r; try { r = await applyFps60({ id: 'top-' + tid, file: `[${tid}]`, console: 'SWITCH', title: tid }, true); } catch (e) { r = { ok: false, why: e.message }; }
      if (!r.ok && !r.none) break;
      done[tid] = Date.now(); store.data.fps60Top = done; store.save();
    }
    for (const g of games.filter(isSwitch)) {
      if ((extOpts(g.id)['Arcadia/fps60'] || 'on') !== 'on') continue;
      const m = (store.get('media') || {})[g.id] || {};
      if (m.fps60 && Date.now() - m.fps60.at < 7 * 864e5) continue;
      let r; try { r = await applyFps60(g, true); } catch (e) { r = { ok: false, why: e.message }; }
      if (!r.ok && !r.none) break; // hors ligne ou limite GitHub : on réessaiera plus tard
      const media = store.get('media') || {}; (media[g.id] ||= {}).fps60 = { at: Date.now(), n: r.n || 0 }; store.save();
    }
  } finally { fps60Busy = false; }
}

// ---------------------------------------------------------------- compteur d'images/s par-dessus le jeu
// Les moteurs Arcadia (Switch et moteur intégré) écrivent leurs images/s dans ce fichier chaque seconde.
function statsFile() { return path.join(app.getPath('temp'), `arcadia-stats-${process.pid}.json`); }
const HUD = { win: null, timer: null, id: null, last: 0, key: '' };
const HUD_SIZE = { s: [128, 46], m: [168, 60], l: [236, 84] };
function hudPlace() {
  const st = settings(), [w, h] = HUD_SIZE[st.fpsHudSize] || HUD_SIZE.m, pos = st.fpsHudPos || 'tl';
  const b = HUD.display || screen.getPrimaryDisplay().bounds, m = 18;
  const x = pos.endsWith('r') ? b.x + b.width - w - m : b.x + m, y = pos.startsWith('b') ? b.y + b.height - h - m : b.y + m;
  HUD.win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
}
function hudStart(id) {
  hudStop();
  try { fs.unlinkSync(statsFile()); } catch { /* pas encore créé */ }
  HUD.id = id; HUD.display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  HUD.timer = setInterval(hudTick, 500);
}
function hudStop() {
  clearInterval(HUD.timer); HUD.timer = null; HUD.id = null;
  if (HUD.win && !HUD.win.isDestroyed()) HUD.win.destroy();
  HUD.win = null; HUD.key = '';
}
function hudTick() {
  const st = settings();
  let d = null; try { d = JSON.parse(fs.readFileSync(statsFile(), 'utf8')); } catch { /* moteur sans compteur, ou pas encore démarré */ }
  const show = st.fpsHud && d && !OV.open;
  if (!show) { if (HUD.win && !HUD.win.isDestroyed()) HUD.win.hide(); return; }
  if (!HUD.win || HUD.win.isDestroyed()) {
    HUD.win = new BrowserWindow({ width: 168, height: 60, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, fullscreenable: false, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'hud-preload.js') } });
    HUD.win.setAlwaysOnTop(true, 'screen-saver'); HUD.win.setIgnoreMouseEvents(true);
    HUD.win.loadFile(path.join(__dirname, 'renderer', 'hud.html'));
    HUD.key = '';
  }
  const key = `${st.fpsHudPos}|${st.fpsHudSize}`;
  if (key !== HUD.key) { HUD.key = key; hudPlace(); }
  HUD.win.webContents.send('hud', { fps: d.fps, speed: d.speed, size: st.fpsHudSize || 'm', accent: UI_ACCENT.c || '#39e5c8' });
  if (!HUD.win.isVisible()) HUD.win.showInactive();
}
// Réglages vidéo/son que le moteur Switch applique en direct (fichier relu par le moteur s'il change)
function liveIni(id) {
  const o = extOpts(id), out = [];
  for (const opt of SW_OPTS.filter(x => x.live)) { const v = o[opt.key]; if (v !== undefined) out.push(`${opt.key.split('/')[1]}=${v}`); }
  return out.join('\n') + '\n';
}
function extOpts(id) { return ((store.get('extOpts') || {})[id]) || {}; }
function overlayData() {
  const G = OV.game; if (!G) return null;
  const g = games.find(x => x.id === G.id);
  const d = { title: G.title, console: G.consoleName, seconds: Math.round((Date.now() - G.start) / 1000), note: G.note, kind: G.kind, accent: UI_ACCENT.c, onAccent: UI_ACCENT.on };
  const inp = settings().input;
  d.pad = { name: inp && inp.type !== 'keyboard' ? inp.name : (G.padName || 'Clavier & souris'), type: inp ? inp.type : 'keyboard' };
  d.shortcuts = [['Échap', 'Ouvrir / fermer ce menu'], ['Guide (Xbox)', 'Ouvrir / fermer ce menu'], ['Back + Start', 'Ouvrir ce menu'], ['Back + Start (1,5 s)', 'Quitter le jeu'], ['F11', 'Plein écran / fenêtré']];
  if (G.kind === 'switch') {
    const inp0 = settings().input;
    const cur = { 'Arcadia/control': inp0 && inp0.type === 'keyboard' ? 'keyboard' : 'pad', ...SwitchCfg.readOpts(G.userDir, SW_OPTS.map(o => o.key)), ...extOpts(G.id) };
    cur['Arcadia/hud'] = String(!!settings().fpsHud);
    if (!cur['Arcadia/fps60']) cur['Arcadia/fps60'] = 'on';
    d.opts = SW_OPTS.filter(o => !((G.dsu || G.engine) && o.key === 'Arcadia/control')).map(o => ({ ...o, value: String(cur[o.key] ?? o.def) }));
    d.dsu = !!G.dsu;
    const dg = g && decorate(g);
    if (dg && dg.langs && dg.langs.length) {
      const LN = Langs.LANGS, chosen = ((store.get('gameSettings') || {})[G.id] || {}).lang || '';
      d.opts.unshift({ sec: 'langue', key: 'Arcadia/lang', label: 'Langue du jeu', hint: dg.langsFromRom ? 'Langues présentes dans ce jeu' : 'Le jeu l\'utilise s\'il la propose', values: [['', I18N.lang === 'en' ? (dg.langs.includes('en') ? 'Automatique (anglais)' : 'Automatique') : dg.langs.includes('fr') ? 'Automatique (français)' : 'Automatique'], ...dg.langs.map(c => [c, LN[c] || c])], value: chosen });
    }
    d.pending = !!G.changed;
  }
  // moteur Arcadia : périphérique et touches réattribuables (appliqués à la reprise, sans relancer)
  if (G.engine) d.controls = { labels: Controls.labels(G.consoleId), actions: Controls.ACTIONS, ...Controls.read(controlsDir(), G.consoleId) };
  try {
    const items = g ? Saves.list(gameSavesDir(g)) : [];
    d.saves = { count: items.length, items: items.slice(0, 8).map(b => ({ iso: b.iso, machine: b.machine, thumb: thumbUrl(b.thumb) })) };
  } catch { d.saves = { items: [], count: 0 }; }
  return d;
}
function thumbUrl(file, w = 360) {
  if (!file) return null;
  try { const im = nativeImage.createFromPath(file); return im.isEmpty() ? null : im.resize({ width: w }).toDataURL(); } catch { return null; }
}
// Image du jeu au moment de la pause (le moteur est figé) : sert de miniature aux copies de sauvegarde
async function captureScreen() {
  if (!desktopCapturer) return null;
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: Math.round(960 * disp.size.height / disp.size.width) } });
  const src = srcs.find(x => String(x.display_id) === String(disp.id)) || srcs[0];
  return src && !src.thumbnail.isEmpty() ? src.thumbnail.toPNG() : null;
}
async function grabShot() {
  OV.shot = null;
  try { OV.shot = await captureScreen(); if (OV.shot && OV.game) liveShots.set(OV.game.id, OV.shot); } catch (e) { log?.write('INFO', `capture du menu : ${e.message}`); }
}
// Miniatures des sauvegardes : image du jeu prise régulièrement pendant la partie (jeu devant, pas de menu Arcadia)
const liveShots = new Map();
function watchShots(id) {
  const t = setInterval(async () => {
    if (!running.has(id)) { clearInterval(t); return; }
    if (OV.open || (win && win.isFocused())) return;
    try { const png = await captureScreen(); if (png && running.has(id) && !OV.open) liveShots.set(id, png); } catch { /* écran indisponible */ }
  }, 45000);
  return () => clearInterval(t);
}
function keepShot(g, backup) {
  const png = liveShots.get(g.id); liveShots.delete(g.id);
  if (!png) return;
  try {
    const dir = gameSavesDir(g); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'derniere-partie.png'), png); // « Continuer »
    const target = backup?.file || (Saves.list(dir)[0] || {}).file; // la copie faite à la fermeture (ou la dernière sans image)
    if (target && !exists(target + '.png')) fs.writeFileSync(target + '.png', png);
  } catch { /* sans miniature */ }
}
function overlayWin() {
  if (OV.win && !OV.win.isDestroyed()) return OV.win;
  const d = screen.getPrimaryDisplay().bounds;
  OV.win = new BrowserWindow({
    x: d.x, y: d.y, width: d.width, height: d.height, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  OV.win.setAlwaysOnTop(true, 'screen-saver');
  OV.win.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  return OV.win;
}
// Pendant que le menu est ouvert, le clavier est capté pour lui (même si Windows ne lui donne pas le focus)
const OV_KEYS = { Up: 'up', Down: 'down', Left: 'left', Right: 'right', Return: 'a', Space: 'a', Backspace: 'b', Tab: 'rb', 'Shift+Tab': 'lb' };
function ovNav(k) { if (OV.open && OV.win && !OV.win.isDestroyed()) OV.win.webContents.send('ov:nav', k); }
function ovKeys(on) {
  const keys = helper.available ? { ...OV_KEYS, Escape: 'menu' } : OV_KEYS;
  for (const [acc, k] of Object.entries(keys)) {
    try { if (on) globalShortcut.register(acc, () => ovNav(k)); else globalShortcut.unregister(acc); } catch { /* raccourci pris */ }
  }
}
// Aide « Contrôles » au début de la partie : affichée sans prendre le focus ni bloquer la souris
function ovBanner(id, dsu) {
  if (!OV.game || OV.game.id !== id || OV.open) return;
  const w = overlayWin(); const inp = settings().input || {};
  const pad = inp.type && inp.type !== 'keyboard' && inp.name ? inp.name : 'Manette';
  const b = dsu
    ? { line1: `✦  ${pad}      ⌨  Clavier`, line2: 'Les deux marchent en même temps. Échap ou Guide : menu → Manette pour calibrer, Raccourcis pour les touches.', ms: 7000 }
    : { line1: `✦  ${pad}`, line2: 'Échap ou Guide : menu Arcadia → Manette pour calibrer.', ms: 6000 };
  const show = () => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    w.setBounds(d); w.setIgnoreMouseEvents(true); w.showInactive();
    w.webContents.send('ov:banner', b);
    setTimeout(() => { if (!OV.open && OV.win && !OV.win.isDestroyed()) OV.win.hide(); }, b.ms + 500);
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show); else show();
}
function ovShow() {
  const w = overlayWin();
  const show = () => {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    w.setBounds(d);
    w.setIgnoreMouseEvents(false);
    w.webContents.send('ov:show', overlayData());
    w.show(); w.focus(); w.moveTop();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', show); else show();
}
async function openOverlay() {
  const G = OV.game;
  if (!G || OV.open) return;
  OV.open = true;
  await (helper.available ? helper.suspend(G.pid) : Proc.suspend(G.pid));
  await grabShot();
  ovKeys(true);
  ovShow();
}
async function closeOverlay(action) {
  const G = OV.game;
  if (OV.win && !OV.win.isDestroyed()) OV.win.hide();
  OV.open = false; ovKeys(false);
  if (!G) return;
  await (helper.available ? helper.resume(G.pid) : Proc.resume(G.pid));
  if (action === 'quit' || action === 'restart') {
    if (action === 'restart') OV.relaunch = G.id;
    log?.write('INFO', `menu Arcadia : ${action === 'restart' ? 'relance' : 'fermeture'} de ${G.title}`);
    closeProcess(G.pid, () => running.has(G.id));
  } else if (helper.available) helper.focus(G.pid); else Proc.focus(G.pid);
}
ipcMain.handle('ov:act', (_e, action) => closeOverlay(action));
ipcMain.handle('ov:set', (_e, key, value) => {
  const G = OV.game;
  if (G && key === 'Arcadia/lang') { // langue du jeu : même réglage que sur la page du jeu
    const gs = store.get('gameSettings') || {}; gs[G.id] = { ...(gs[G.id] || {}), lang: value || null }; store.set('gameSettings', gs);
    G.changed = true; return overlayData();
  }
  if (G && key === 'Arcadia/hud') { store.data.settings = { ...settings(), fpsHud: value === 'true' || value === true }; store.save(); return overlayData(); } // réglage commun à tous les jeux
  if (!G || !SW_OPTS.some(o => o.key === key)) return overlayData();
  const all = store.get('extOpts') || {};
  all[G.id] = { ...(all[G.id] || {}), [key]: String(value) };
  if (key === 'Arcadia/frame_gen') delete all[G.id]['Renderer/frame_gen']; // ancien réglage
  store.data.extOpts = all; store.save();
  const opt = SW_OPTS.find(o => o.key === key);
  if (opt && opt.live && G.userDir) { // appliqué tout de suite par le moteur
    try { fs.writeFileSync(path.join(G.userDir, 'arcadia-live.ini'), liveIni(G.id)); } catch (e) { log?.write('INFO', `réglages en direct : ${e.message}`); }
  } else G.changed = true;
  if (key === 'Arcadia/fps60') {
    const g = games.find(x => x.id === G.id);
    if (g) applyFps60(g, value === 'on').then(r => { if (!r.ok) log?.write('INFO', `60 images/s : ${r.why}`); if (OV.win && !OV.win.isDestroyed()) OV.win.webContents.send('ov:toast', r.ok ? (value === 'on' ? '60 images/s prêt : relance le jeu' : '60 images/s retiré : relance le jeu') : `60 images/s : ${r.why}`); }).catch(() => {});
  }
  if (((key === 'Arcadia/frame_gen' && value === 'dlss') || (key === 'Renderer/nvidia_dlss' && value === 'true')) && !streamlineReady()) installStreamline().catch(() => {});
  return overlayData();
});
ipcMain.handle('ov:ctl', (_e, patch) => {
  const G = OV.game; if (!G || !G.engine) return overlayData();
  let c = Controls.read(controlsDir(), G.consoleId);
  if (patch.reset) { const d = c.device; c = Controls.defaults(G.consoleId); c.device = d; }
  if (patch.device && Controls.DEVICES.includes(patch.device)) c.device = patch.device;
  if (patch.assign) Controls.assign(c, patch.assign.kind, patch.assign.action, patch.assign.code);
  Controls.write(controlsDir(), G.consoleId, c);
  return overlayData();
});
ipcMain.handle('ov:do', async (_e, what) => {
  const G = OV.game; if (!G) return null;
  const g = games.find(x => x.id === G.id);
  if (what === 'backup') {
    let msg;
    try {
      const r = backupFor(g, true);
      if (r.file && OV.shot) { try { fs.writeFileSync(r.file + '.png', OV.shot); } catch { /* sans miniature */ } }
      msg = r.file ? 'Sauvegarde copiée' : `Rien à copier (${r.skipped || 'aucune sauvegarde du jeu trouvée'})`;
    } catch (e) { msg = `Copie impossible : ${e.message}`; }
    return { ...overlayData(), toast: msg };
  }
  if (String(what).startsWith('load:')) {
    const items = Saves.list(gameSavesDir(g)); const b = items[Number(what.slice(5))];
    if (!b) return { ...overlayData(), toast: 'Copie introuvable' };
    OV.restore = { id: G.id, file: b.file };
    closeOverlay('restart');
    return null;
  }
  if (what === 'openSaves') { shell.openPath(gameSavesDir(g)); return { ...overlayData(), toast: 'Dossier ouvert dans l\'Explorateur' }; }
  if (what === 'calibrate') {
    if (OV.win && !OV.win.isDestroyed()) OV.win.hide();
    ovKeys(false);
    const inp = settings().input || {};
    const r = await runCalibration({ layout: inp.type && inp.type !== 'keyboard' ? inp.type : 'xbox' });
    ovKeys(true); ovShow();
    G.changed = true;
    return { ...overlayData(), toast: r.ok ? `${r.input.name} : prête (appliquée en relançant le jeu)` : 'Calibrage annulé' };
  }
  return overlayData();
});
function attachOverlay(id, pid, g, title, setup, extra = {}) {
  const sw = SWITCH_EMUS.includes(setup.emulator);
  OV.game = { id, pid, title, start: Date.now(), consoleName: (CONSOLES.find(c => c.id === g.console) || {}).name || g.console, kind: sw ? 'switch' : 'generic', changed: false, ...extra,
    note: sw ? 'Les jeux Switch gèrent leurs propres sauvegardes : sauvegarde dans le jeu, puis « Copier ma sauvegarde » pour la mettre à l\'abri.' : '' };
  if (!helper.available) { try { globalShortcut.register('Escape', () => { if (OV.open) ovNav('menu'); else openOverlay(); }); } catch { /* raccourci pris */ } }
}
function detachOverlay(id) {
  if (!OV.game || OV.game.id !== id) return;
  if (!helper.available) { try { globalShortcut.unregister('Escape'); } catch { /* */ } }
  ovKeys(false);
  if (OV.win && !OV.win.isDestroyed()) OV.win.hide();
  OV.open = false; OV.game = null;
}

function startGame(id, opts = {}) {
  const g = games.find(x => x.id === id);
  if (!g) return { ok: false, error: 'Jeu introuvable, actualise la bibliothèque.' };
  if (running.has(id)) return { ok: false, error: `${g.title} est déjà lancé.` };
  try {
    const setup = setupFor(g, opts.external);
    if (!setup) { // aucun émulateur externe pour prendre le relais
      const nb = runnerNeedsBios(g.console);
      if (nb) return { ok: false, needBios: { console: nb, label: BIOS[nb].label }, error: `${BIOS[nb].label} manquant.` };
    }
    if (setup && setup.emulator === 'rpcs3' && !ps3FirmwareOk(setup.exe)) return { ok: false, needPs3Fw: true, error: 'Firmware PS3 manquant.' };
    if (setup && setup.emulator === 'vita3k' && !vitaFirmwareOk(setup.exe)) return { ok: false, needVitaFw: true, error: 'Firmware PS Vita manquant.' };
    if (setup && setup.emulator === 'xemu') { const n = xemuNeeds(setup.exe); if (n.mcpx || n.bios || n.hdd) return { ok: false, needXbox: n, error: 'Fichiers système Xbox manquants.' }; }
    let swDir = null, branded = false, useDsu = false, engine = null;
    const t0 = Date.now();
    // Switch : sans prod.keys ni firmware, l'émulateur s'ouvrirait sur une erreur → on demande d'abord
    if (setup && SWITCH_EMUS.includes(setup.emulator)) {
      const need = switchNeeds(setup);
      if (need.keys || need.firmware) return { ok: false, needSwitch: { ...need, emulator: KNOWN_EMULATORS[setup.emulator]?.name || setup.emulator }, error: need.keys ? 'Clés Switch (prod.keys) manquantes.' : 'Firmware Switch manquant.' };
      swDir = need.dir;
      if (settings().switchProfile) { try { setSwitchProfileName(need.dir, settings().switchProfile); } catch (e) { log?.write('INFO', `profil Switch : ${e.message}`); } }
      const gsx = (store.get('gameSettings') || {})[id] || {};
      const asw = settings().switchEngine !== 'eden' && gsx.fallback !== app.getVersion() ? arcadiaSwitchExe() : null; // Switch 1 et 2
      if (asw && cpuInfo().sse42 === false) return { ok: false, error: 'Ton processeur ne prend pas en charge SSE4.2, indispensable au moteur Switch : les jeux Switch ne peuvent pas tourner sur ce PC.' };
      if (opts.switchArgs && !asw) return { ok: false, error: 'Le multijoueur en ligne passe par le moteur Switch d\'Arcadia : remets « Moteur Switch » sur Arcadia dans les Paramètres.' };
      if (asw) {
        const guid = (settings().input || {}).guid || '';
        try { SwitchCfg.prepare(need.dir, { opts: { ...Langs.switchOpts(gameLang(g)), ...swEngineOpts(id) }, arcadia: true }); } catch (e) { log?.write('INFO', `réglages Switch : ${e.message}`); }
        engine = { exe: asw, args: (opts.switchArgs ? opts.switchArgs + ' ' : '') + KNOWN_EMULATORS.edencli.args, env: { ARCADIA: '1', ARCADIA_USER_DIR: need.dir, ARCADIA_TITLE: `${decorate(g).title} — Arcadia`, ARCADIA_PAD_DB: exists(padDbPath()) ? padDbPath() : '', ARCADIA_PAD_GUID: guid, ARCADIA_CONTROLS: controlsFile(g.console), ARCADIA_STATS: statsFile(), ARCADIA_LIVE: path.join(need.dir, 'arcadia-live.ini'), ARCADIA_MOUSE: extOpts(id)['Arcadia/mouse'] || 'camera' } };
        log?.write('INFO', 'moteur Switch d\'Arcadia');
      } else if (setup.emulator !== 'lichii') {
        const inp = settings().input || {}, guid = inp.guid || '';
        const keyboard = (extOpts(id)['Arcadia/control'] || (inp.type === 'keyboard' ? 'keyboard' : 'pad')) === 'keyboard';
        // manette + clavier en même temps : Arcadia sert les deux au moteur comme une seule manette (compagnon natif)
        useDsu = helper.available && helper.dsuReady === true;
        try { const r = SwitchCfg.prepare(need.dir, { guid, mapping: padDbFor(guid), opts: { ...Langs.switchOpts(gameLang(g)), ...swEngineOpts(id) }, keyboard, dsu: useDsu }); log?.write('INFO', `moteur Switch prêt (manette ${r.pad || 'pas encore détectée : clavier pour cette fois'})`); } catch (e) { log?.write('INFO', `réglages Switch : ${e.message}`); }
      }

    }
    // émulateurs externes : copie « Arcadia » de l'exécutable (icône + nom Arcadia dans la barre des tâches,
    // le mélangeur de volume, le gestionnaire des tâches). L'original n'est jamais modifié ; exclus : Xenia (config
    // nommée d'après l'exe), Lichii (interface propre), DuckStation (licence sans œuvres dérivées).
    const brandOff = (o => (typeof o === 'object' && o) || {})(settings().brandOff);
    if (setup && !engine && !setup.runner && setup.exe && !['xenia', 'lichii', 'retroarch', 'duckstation'].includes(setup.emulator) && !brandOff[setup.emulator]) { // (l'ancien « brandOff: true » global venait d'un module défaillant : ignoré)
      const cons = (CONSOLES.find(c => c.id === g.console) || {}).name || g.console;
      const tag = setup.emulator === 'edencli' || setup.emulator === 'eden' ? 'Switch' : String(g.console).replace(/[^\w ]/g, '');
      const b = Brand.brandedExe(setup.exe, `Arcadia ${tag}.exe`, ARCADIA_ICO(), { description: `Arcadia · ${cons}` });
      if (b !== setup.exe) { setup.exe = b; branded = true; } else if (process.platform === 'win32') log?.write('INFO', `copie Arcadia impossible pour ${setup.emulator} (${Brand.lastError() || '?'}) : exécutable d'origine utilisé`);
    }
    const title = decorate(g).title;
    // moteurs externes : comme le moteur intégré, on propose de reprendre (sauvegarde actuelle ou une copie)
    if (setup && !setup.runner && !opts.skipResume && settings().resumePrompt !== false) {
      let items = [];
      try { items = Saves.list(gameSavesDir(g)); } catch { /* aucune copie */ }
      if (items.length) {
        const last = path.join(gameSavesDir(g), 'derniere-partie.png');
        let lastAt = null; try { lastAt = fs.statSync(last).mtime.toISOString(); } catch { /* jamais capturée */ }
        return { ok: false, resumePick: { last: lastAt ? thumbUrl(last, 640) : null, lastAt, items: items.slice(0, 12).map((b, i) => ({ i, file: b.file, iso: b.iso, machine: b.machine, thumb: thumbUrl(b.thumb, 420) })) } };
      }
    }
    let pad = null;
    const onExit = (seconds, error, code) => {
      hudStop();
      pad?.stop();
      detachOverlay(id);
      try { opts.onExit && opts.onExit(); } catch { /* serveur déjà arrêté */ }
      running.delete(id);
      discord.idle();
      if (settings().minimizeOnPlay && !running.size && win) { win.restore(); win.focus(); }
      // copie aux couleurs d'Arcadia qui refuse de démarrer : on revient à l'original, une fois pour toutes
      if (branded && code && Date.now() - t0 < 6000 && !OV.relaunch) {
        const bo = (o => (typeof o === 'object' && o) || {})(settings().brandOff);
        store.data.settings = { ...settings(), brandOff: { ...bo, [setup.emulator]: true } }; store.save();
        log?.write('INFO', 'moteur aux couleurs d\'Arcadia : échec au démarrage, retour à l\'exécutable d\'origine');
        setTimeout(() => startGame(id, opts), 500); return;
      }
      // moteur Arcadia qui plante au démarrage de ce jeu : on relance tout de suite sur le moteur de secours,
      // et on retient le jeu (jusqu'à la prochaine version d'Arcadia, qui retentera le moteur Arcadia)
      const early = Date.now() - t0 < 90000 && !closedByArcadia.has(pid) && !OV.relaunch;
      const engineCrash = engine ? (code !== 0 && code != null) : setup?.runner ? !!error : false;
      const byUs = closedByArcadia.has(pid);
      closedByArcadia.delete(pid);
      // partie en ligne : le moteur Switch se ferme s'il ne peut pas rejoindre le salon → message clair, jamais de moteur de secours
      if (opts.switchArgs && engineCrash && !byUs && Date.now() - t0 < 90000) {
        log?.write('MULTI', `connexion au salon impossible (code ${code})`);
        win?.webContents.send('game:error', { id, error: opts.netHost
          ? 'Mario Kart n\'a pas pu se connecter à ton propre salon : ferme le salon, puis héberge à nouveau.'
          : 'Impossible de rejoindre le salon de ton ami. Vérifie : 1) qu\'il a cliqué sur « Héberger » et que son salon est toujours ouvert, 2) que le code est le dernier qu\'il t\'a envoyé, 3) hors de chez lui, que sa box laisse passer le port UDP 24872 vers son PC (et que Windows a autorisé « arcadia-room »).' });
        return;
      }
      if (early && engineCrash) {
        const backup = engine ? setup : setupFor(g, true);
        if (backup && !(engine ? false : backup.runner)) {
          // plus de bascule silencieuse : le joueur choisit (réessayer, moteur de secours, rapport)
          log?.write('ERREUR', `moteur Arcadia : arrêt au démarrage de ${title} (${error || 'code ' + code}) ; moteur de secours possible : ${backup.emulator}`);
          win?.webContents.send('game:engineCrash', { id, title, backup: ((KNOWN_EMULATORS[backup.emulator] || {}).name || backup.emulator).replace(/ \(.*\)$/, ''), code: code ?? null, error: error || null });
          return;
        }
      }
      if (OV.relaunch === id) {
        OV.relaunch = null;
        if (OV.restore && OV.restore.id === id) { // « Reprendre depuis cette copie »
          const f = OV.restore.file; OV.restore = null;
          try { backupFor(g, true); const st = setupFor(g); Saves.restore(f, { emuId: st.emulator, ctx: saveCtx(st, g), romPath: g.path }); log?.write('INFO', `copie restaurée avant relance : ${path.basename(f)}`); } catch (e) { log?.write('ERREUR', `restauration : ${e.message}`); }
        }
        setTimeout(() => startGame(id, { ...opts, skipResume: true }), 900);
      }
      if (error) { win?.webContents.send('game:error', { id, error }); return; }
      store.recordPlay(id, seconds);
      try { Saves.logSession(gameSavesDir(g), { start: Date.now() - seconds * 1000, end: Date.now(), seconds, emulator: setup?.emulator || null }); } catch { /* disque plein ? */ }
      let backup = null;
      if (settings().autoBackup) { try { backup = backupFor(g); } catch (e) { backup = { error: e.message }; } }
      keepShot(g, backup);
      win?.webContents.send('game:exited', { id, seconds, stats: store.get('stats'), backup });
    };
    if (setup?.runner) ensureRunnerPreset(g.console);
    const langOpts = setup?.runner ? [...coreFixedOpts(setup), ...Langs.runnerOpts(g.console, gameLang(g)), ...runnerPatchOpts(g)].flatMap(o => ['--opt', o]) : [];
    const patchArgs = setup?.runner ? runnerPatchArgs(g) : [];
    const pid = setup?.runner ? launchRunner(setup, g, title, onExit, [...langOpts, ...patchArgs, ...(opts.runnerArgs || [])]) : (engine ? launch({ ...setup, exe: engine.exe, args: engine.args }, g.path, onExit, { ...padEnv(), ...engine.env }) : launch(setup, g.path, onExit, padEnv()));
    running.set(id, pid);
    hudStart(id);
    if (!setup?.runner) watchShots(id);
    if (setup?.runner && helper.available) helper.adopt(pid, '', ARCADIA_ICO(), AUMID);
    if (!setup?.runner) { // le moteur intégré a son propre menu ; pour les autres, menu Arcadia par-dessus
      attachOverlay(id, pid, g, title, setup, { userDir: swDir, dsu: useDsu, engine: !!engine, consoleId: g.console });
      const onQuit = settings().padQuit ? () => {
        log?.write('INFO', `combo manette : fermeture de ${title}`);
        win?.webContents.send('game:closing', { id });
        if (OV.open) closeOverlay('quit'); else closeProcess(pid, () => running.has(id));
      } : null;
      const onMenu = () => { if (OV.open) ovNav('menu'); else openOverlay(); };
      if (helper.available) {
        // compagnon natif : fenêtre aux couleurs d'Arcadia, manette, Échap seulement quand le jeu est devant
        helper.adopt(pid, `${title} — Arcadia`, ARCADIA_ICO(), AUMID);
        helper.watch(pid);
        if (useDsu) helper.dsu(true, exists(padDbPath()) ? padDbPath() : '', (settings().input || {}).guid || '');
        if (settings().controlsHint !== false) setTimeout(() => ovBanner(id, useDsu), 6000);
        const off = helper.on(line => {
          if (!running.has(id)) return;
          if (line === 'QUIT') onQuit && onQuit();
          else if (line === 'MENU' || line === 'KEY ESC') onMenu();
          else if (line.startsWith('NAV ')) ovNav(line.slice(4));
        });
        pad = { stop() { off(); helper.watch(0); if (useDsu) helper.dsu(false); } };
      } else {
        Proc.adopt(pid, `${title} — Arcadia`);
        pad = watchPad(onQuit, msg => log?.write('MANETTE', msg), onMenu, ovNav);
      }
    }
    if (settings().discordId) { discord.connect(settings().discordId); discord.playing(title, (CONSOLES.find(c => c.id === g.console) || {}).name || g.console); }
    win?.webContents.send('game:started', { id });
    if (settings().minimizeOnPlay) setTimeout(() => win?.minimize(), 800);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
ipcMain.handle('game:launch', (_e, id, o) => startGame(id, { skipResume: !!(o && o.skipResume) }));
// Après un arrêt du moteur Arcadia : jouer ce jeu avec le moteur de secours (jusqu'à la prochaine version d'Arcadia)
ipcMain.handle('game:useFallback', (_e, id) => {
  const all = store.get('gameSettings') || {};
  all[id] = { ...(all[id] || {}), fallback: app.getVersion() }; store.set('gameSettings', all);
  log?.write('INFO', `moteur de secours choisi pour ${id}`);
  return startGame(id, { skipResume: true });
});

// Réglages propres à un jeu : { emulator, extraArgs }
ipcMain.handle('game:settings', (_e, id, patch) => {
  const all = store.get('gameSettings') || {};
  if (patch === null) delete all[id];
  else all[id] = { ...(all[id] || {}), ...patch };
  store.set('gameSettings', all);
  return snapshot();
});

// Émulateurs installés capables de lancer la console du jeu
ipcMain.handle('game:emulators', (_e, id) => {
  const g = games.find(x => x.id === id);
  if (!g) return [];
  const dirs = [EMU_DIR(), store.get('emulatorsDir')].filter(exists);
  const found = Object.assign({}, ...dirs.map(d => detectEmulators(d)));
  const list = Object.entries(KNOWN_EMULATORS).filter(([k, e]) => e.consoles.includes(g.console) && found[k]).map(([k, e]) => ({ id: k, name: e.name }));
  if (runnerFor(g.console)) list.unshift({ id: 'arcadia', name: 'Arcadia (moteur intégré)' });
  return list;
});

// Raccourci Bureau : double-clic = le jeu se lance directement
ipcMain.handle('game:shortcut', (_e, id) => {
  const g = games.find(x => x.id === id);
  if (!g || process.platform !== 'win32') return { ok: false, error: 'Disponible sous Windows uniquement.' };
  const target = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
  const name = Saves.safe(decorate(g).title);
  const file = path.join(app.getPath('desktop'), `${name}.lnk`);
  const ok = shell.writeShortcutLink(file, 'create', { target, args: `--launch=${g.id}`, description: `${name} (${g.console}) — Arcadia`, icon: target, iconIndex: 0 });
  return ok ? { ok: true, file } : { ok: false, error: 'Création du raccourci impossible.' };
});

// Fiche détaillée : description / éditeur / date / captures (Switch : titledb ; autres : captures libretro)
ipcMain.handle('game:details', async (_e, id, force) => {
  const g = games.find(x => x.id === id);
  if (!g) return null;
  const media = store.get('media');
  const m = media[id] || (media[id] = {});
  const key = settings().sgdbKey || '';
  const fresh = d => d && d.v === 4 && (d.shots || []).every(exists) && (!d.banner || exists(d.banner))
    && (d.info || Date.now() - (d.infoTried || 0) < 6 * 3600e3)           // fiche absente : on retente au bout de 6 h
    && (d.bannerKind === 'hero' || !key || Date.now() - (d.heroTried || 0) < 864e5);
  if (!force && fresh(m.details)) return m.details;
  const prev = m.details && m.details.v >= 3 ? m.details : null;
  const det = { v: 4, desc: null, publisher: null, release: null, shots: [], banner: null, bannerKind: null, info: prev?.info || null, infoTried: prev?.infoTried || 0, heroTried: prev?.heroTried || 0 };
  const title = decorate(g).title;
  try {
    if (isSwitch(g)) {
      const titleId = m.titleId || keylessId(g) || titleIdFrom(g.file);
      const hit = titleId ? await switchDb.find({ titleId, titles: [] }) : await switchDb.find({ titleId: null, titles: [g.title, m.title].filter(Boolean) });
      const d = hit && await switchDb.details(hit.id);
      if (d) {
        det.desc = d.d || null; det.publisher = d.p || null;
        det.release = d.r ? String(d.r).replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1') : null;
        const urls = [hit.bannerUrl, ...(d.s || [])].filter(Boolean);
        for (const [i, url] of urls.entries()) {
          const dest = mediaPath('shots', `${id}-${i}`, 'jpg');
          if (!exists(dest)) await switchDb.download(url, dest);
          if (i === 0 && url === hit.bannerUrl) { det.banner = dest; det.bannerKind = 'hero'; } else det.shots.push(dest);
        }
      }
    } else if (REPOS[g.console]) {
      const titles = [g.title, m.title].filter(Boolean);
      const ext = path.extname(g.path).slice(1).toLowerCase();
      for (const [i, kind] of ['Named_Snaps', 'Named_Titles'].entries()) {
        const dest = mediaPath('shots', `${id}-${i}`);
        if (exists(dest) || await covers.fetchCover(g.console, titles, dest, ext, kind)) det.shots.push(dest);
      }
    }
  } catch { /* hors ligne : on réessaiera */ }
  // Fiche Wikipédia / Wikidata (studio, éditeur, sortie, genre, série, résumé)
  if (det.info && (det.info.uiLang || 'fr') !== I18N.lang) { det.info = null; det.desc = null; det.infoTried = 0; } // fiche dans l'autre langue de l'interface
  if (!det.info && (force || Date.now() - det.infoTried > 6 * 3600e3)) {
    det.infoTried = Date.now();
    try { det.info = await GameInfo.wikiInfo(title, g.console, { fetch: net.fetch.bind(net) }); if (det.info) det.info.uiLang = I18N.lang; if (!det.info) log?.write('INFO', `fiche ${title} : aucun jeu correspondant sur Wikidata`); }
    catch (e) { det.infoError = e.message; log?.write('INFO', `fiche ${title} : ${e.message}`); }
  }
  if (det.info) {
    det.desc = det.desc || det.info.desc;
    det.publisher = det.publisher || det.info.publisher.join(', ') || null;
    det.release = det.release || det.info.release;
  }
  // Bannière large : SteamGridDB (si clé), sinon la plus belle capture du jeu
  if (det.bannerKind !== 'hero' && key && Date.now() - det.heroTried > 864e5) {
    det.heroTried = Date.now();
    try {
      const h = await GameInfo.sgdbHero(det.info?.title || title, key, { fetch: net.fetch.bind(net) });
      if (h) {
        const dest = mediaPath('heroes', id, /\.png(\?|$)/i.test(h.url) ? 'png' : 'jpg');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const r = await net.fetch(h.url); if (r.ok) { fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); det.banner = dest; det.bannerKind = 'hero'; }
      }
    } catch (e) { log?.write('INFO', `bannière ${title} : ${e.message}`); }
  }
  if (!det.banner && prev?.bannerKind === 'hero' && exists(prev.banner)) { det.banner = prev.banner; det.bannerKind = 'hero'; }
  if (!det.banner && det.shots[0]) { det.banner = det.shots[0]; det.bannerKind = 'shot'; }
  // grande bannière seulement en bonne qualité (au moins 1920 px de large) ; sinon bannière normale
  if (det.bannerKind === 'hero') { try { const w = nativeImage.createFromPath(det.banner).getSize().width; if (!w || w < 1920) det.bannerKind = 'shot'; } catch { det.bannerKind = 'shot'; } }
  m.details = det; store.save();
  return det;
});

// ---------------------------------------------------------------- multijoueur
function lanAddrs() {
  const out = [];
  for (const list of Object.values(require('os').networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
let PUBLIC_IP = null;
async function publicIp() {
  if (PUBLIC_IP) return PUBLIC_IP;
  try { const r = await net.fetch('https://api.ipify.org?format=json'); if (r.ok) PUBLIC_IP = (await r.json()).ip; } catch { /* hors ligne */ }
  return PUBLIC_IP;
}
function azaharFiles() {
  const exe = emuCtx('azahar').exe;
  if (!exe) return null;
  const room = path.join(path.dirname(exe), process.platform === 'win32' ? 'azahar-room.exe' : 'azahar-room');
  return { exe, room: exists(room) ? room : null };
}
// Ce que le jeu propose en multi, et ce qu'Arcadia sait brancher sur CE PC
ipcMain.handle('game:multi', async (_e, id) => {
  const g = games.find(x => x.id === id);
  if (!g) return null;
  const info = Multi.lookup(g.console, decorate(g).title);
  const setup = setupFor(g);
  for (const m of info.modes) {
    if (m.engine === 'runner' && !setup?.runner) { m.ready = false; m.why = 'Le multi PSP passe par le moteur intégré : active « Jouer avec le moteur Arcadia » dans les Paramètres.'; }
    if (m.engine === 'azahar') { const a = azaharFiles(); if (!a) { m.ready = false; m.why = 'Azahar n\'est pas installé.'; } else m.canHost = !!a.room; }
  }
  return { ...info, lan: lanAddrs(), public: await publicIp() };
});
// Lancer en multi. o = { type, role: 'host'|'join', server: 'public'|'private', ip, port, password, max, nickname }
const rooms = new Map();
ipcMain.handle('game:playMulti', async (_e, id, o) => {
  const g = games.find(x => x.id === id);
  if (!g) return { ok: false, error: 'Jeu introuvable.' };
  const title = decorate(g).title;
  if (o.type === 'adhoc') {
    const opts = { ppsspp_enable_wlan: 'enabled', ppsspp_enable_upnp: 'enabled', ppsspp_enable_builtin_pro_ad_hoc_server: 'disabled' };
    let notice;
    if (o.server === 'public') { opts.ppsspp_change_pro_ad_hoc_server_address = 'socom.cc'; notice = 'Multijoueur : salle publique socom.cc. Va dans le mode multi « ad hoc » du jeu.'; }
    else if (o.role === 'host') { opts.ppsspp_enable_builtin_pro_ad_hoc_server = 'enabled'; opts.ppsspp_change_pro_ad_hoc_server_address = 'localhost'; notice = 'Tu héberges la partie. Va dans le mode multi « ad hoc » du jeu et attends tes amis.'; }
    else {
      const d = Multi.ipDigits(o.ip);
      if (!d) return { ok: false, error: 'Adresse IP invalide (ex. 82.65.10.20).' };
      Object.assign(opts, d, { ppsspp_change_pro_ad_hoc_server_address: 'IP address' });
      notice = `Connecté à la partie de ${o.ip}. Va dans le mode multi « ad hoc » du jeu.`;
    }
    const runnerArgs = [...Object.entries(opts).flatMap(([k, v]) => ['--opt', `${k}=${v}`]), '--notice', notice];
    log?.write('MULTI', `${title} : ad hoc ${o.server}/${o.role} ${o.ip || ''}`);
    return startGame(id, { runnerArgs });
  }
  if (o.type === 'wireless') {
    const a = azaharFiles();
    if (!a) return { ok: false, error: 'Azahar n\'est pas installé.' };
    const port = String(parseInt(o.port, 10) || 24872);
    let onExit = null;
    if (o.role === 'host') {
      if (!a.room) return { ok: false, error: 'Le serveur de salon d\'Azahar (azahar-room.exe) est introuvable : réinstalle Azahar.' };
      const args = ['--room-name', `Arcadia · ${title}`.slice(0, 60), '--port', port, '--max_members', String(Math.max(2, Math.min(16, parseInt(o.max, 10) || 4))), '--preferred-app', title];
      if (o.password) args.push('--password', o.password);
      const child = require('child_process').spawn(a.room, args, { cwd: path.dirname(a.room), stdio: 'ignore', windowsHide: true });
      child.on('error', e => log?.write('MULTI', `salon : ${e.message}`));
      rooms.set(id, child);
      onExit = () => { try { child.kill(); } catch { /* déjà arrêté */ } rooms.delete(id); };
    }
    // Azahar ne sait pas rejoindre un salon en ligne de commande : on pré-remplit « Connexion directe »
    const w = writeEmu('azahar', { 'Multiplayer/ip': o.role === 'host' ? '127.0.0.1' : String(o.ip || '').trim(), 'Multiplayer/port': port },
      [{ key: 'Multiplayer/ip', type: 'text', default: '' }, { key: 'Multiplayer/port', type: 'text', default: '24872' }]);
    if (!w.ok) log?.write('MULTI', `pré-remplissage Azahar : ${w.error}`);
    log?.write('MULTI', `${title} : salon 3DS ${o.role} port ${port}`);
    const r = startGame(id, { onExit, external: true }); // le salon 3DS passe par Azahar (le cœur intégré n'a pas de réseau)
    if (!r.ok && onExit) onExit();
    return { ...r, manual: true };
  }
  return { ok: false, error: 'Ce type de multijoueur n\'est pas encore branché.' };
});

// Profil de joueur des jeux Switch : Eden crée un profil « Eden » ; Arcadia le renomme avec le nom choisi
// (seul le nom change : l'identifiant du profil, donc les sauvegardes, reste le même).
const PROFILE_REL = path.join('nand', 'system', 'save', '8000000000000010', 'su', 'avators', 'profiles.dat');
function cleanProfileName(n) { return String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 10); }
function setSwitchProfileName(dir, name) {
  name = cleanProfileName(name); if (!name || !dir) return false;
  const file = path.join(dir, PROFILE_REL);
  let buf = null; try { buf = fs.readFileSync(file); } catch { /* pas encore créé */ }
  const nameBytes = () => { const b = Buffer.alloc(0x20); let s = Buffer.from(name, 'utf8'); while (s.length > 0x1f) { name = name.slice(0, -1); s = Buffer.from(name, 'utf8'); } s.copy(b); return b; };
  if (!buf || buf.length < 0x650) {
    buf = Buffer.alloc(0x650);
    const uuid = crypto.randomBytes(16); const o = 0x10;
    uuid.copy(buf, o); uuid.copy(buf, o + 0x10);
    buf.writeBigUInt64LE(BigInt(Math.floor(Date.now() / 1000)), o + 0x20);
    nameBytes().copy(buf, o + 0x28);
  } else {
    let done = false;
    for (let i = 0; i < 8 && !done; i++) {
      const o = 0x10 + i * 0xC8;
      if (buf.subarray(o, o + 16).every(b => b === 0)) continue;
      const cur = buf.subarray(o + 0x28, o + 0x48).toString('utf8').replace(/\0.*$/s, '');
      if (cur === name) return true;
      nameBytes().copy(buf, o + 0x28); done = true; // premier profil = celui que lancent les jeux
    }
    if (!done) return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf);
  return true;
}
ipcMain.handle('switch:profileName', (_e, name) => {
  const n = cleanProfileName(name);
  store.data.settings = { ...settings(), switchProfile: n }; store.save();
  let ok = 0; for (const d of switchTargets()) { try { if (setSwitchProfileName(d, n)) ok++; } catch (e) { log?.write('INFO', `profil Switch : ${e.message}`); } }
  return { ok: true, name: n, count: ok, state: snapshot() };
});

// ---------------------------------------------------------------- Switch en ligne entre amis (salon privé, gratuit, sans serveur)
// L'hôte lance le salon du moteur Switch (arcadia-room) sur son PC et ouvre le port de sa box (UPnP) ;
// ses amis le rejoignent avec un code d'invitation. Dans le jeu : mode « Sans fil local ».
const Invite = require('./src/invite');
const UPnP = require('./src/upnp');
const SW_ROOM_PORT = 24872;
const SWNET = { room: null, port: SW_ROOM_PORT, password: null, code: null, upnp: null, gameId: null };
const MK8D = '0100152000022000';
function aswRoomExe() { const e = path.join(runnerDir(), 'switch', process.platform === 'win32' ? 'arcadia-room.exe' : 'arcadia-room'); return exists(e) ? e : null; }
function netName() {
  const raw = settings().switchProfile || settings().netName || require('os').userInfo().username || 'Joueur';
  let n = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 14) || 'Joueur';
  while (n.length < 4) n += '_';
  return `${n}-${Math.floor(10 + Math.random() * 90)}`; // deux joueurs avec le même nom ne sont pas refusés
}
const isPrivateIp = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
function mainLanIp() { const l = lanAddrs(); return l.find(isPrivateIp) || l[0] || null; }
function swnetStop() {
  if (SWNET.room) { try { SWNET.room.kill(); } catch { /* déjà arrêté */ } SWNET.room = null; }
  if (SWNET.upnp?.close) SWNET.upnp.close().then(ok => { log?.write('MULTI', `port ${SWNET.port} de la box ${ok ? 'refermé' : 'non refermé (il expirera seul)'}`); if (ok && store) { delete store.data.upnpOpen; store.save(); } });
  SWNET.upnp = null; SWNET.code = null; SWNET.gameId = null;
}
// Au démarrage : port laissé ouvert par un arrêt brutal → refermé
setTimeout(() => {
  const o = store?.data?.upnpOpen; if (!o) return;
  UPnP.closePort({ fetch: (u, x) => net.fetch(u, x), port: o.port, protocol: o.protocol || 'UDP' }).then(ok => {
    log?.write('MULTI', `port ${o.port} resté ouvert après un arrêt brutal : ${ok ? 'refermé' : 'box injoignable'}`);
    if (ok) { delete store.data.upnpOpen; store.save(); }
  });
}, 8000);
app.on('will-quit', swnetStop);
// Passerelle par défaut (la box), lue dans la table de routage Windows
function defaultGateway() {
  try {
    if (process.platform !== 'win32') return null;
    const out = require('child_process').spawnSync('route', ['print', '-4', '0.0.0.0'], { encoding: 'utf8', windowsHide: true }).stdout || '';
    const m = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s/m.exec(out);
    return m ? m[1] : null;
  } catch { return null; }
}
// Pare-feu Windows : règle entrante pour le serveur de salon (une seule autorisation administrateur, la première fois)
const FW_RULE = 'Arcadia salon Switch';
function fwRuleOk(exe) {
  if (process.platform !== 'win32') return true;
  const r = require('child_process').spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FW_RULE}`, 'verbose'], { encoding: 'utf8', windowsHide: true });
  const box = require('child_process').spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FW_RULE} (box)`], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && String(r.stdout || '').toLowerCase().includes(exe.toLowerCase()) && box.status === 0;
}
function fwRuleAdd(exe) {
  return new Promise(resolve => {
    const q = s => s.replace(/'/g, "''");
    const self = app.getPath('exe');
    const cmdline = `/c netsh advfirewall firewall delete rule name="${FW_RULE}" & netsh advfirewall firewall add rule name="${FW_RULE}" dir=in action=allow program="${exe}" protocol=UDP localport=${SW_ROOM_PORT} profile=any enable=yes`
      + ` & netsh advfirewall firewall delete rule name="${FW_RULE} (box)" & netsh advfirewall firewall add rule name="${FW_RULE} (box)" dir=in action=allow program="${self}" protocol=UDP remoteip=LocalSubnet profile=any enable=yes`;
    const ps = `Start-Process -FilePath cmd.exe -ArgumentList '${q(cmdline)}' -Verb RunAs -WindowStyle Hidden -Wait`;
    const ch = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
    ch.on('exit', () => resolve(fwRuleOk(exe))); ch.on('error', () => resolve(false));
  });
}
// 1) ouvrir le salon et préparer le code (le jeu n'est pas encore lancé)
ipcMain.handle('swnet:host', async (_e, id) => {
  const g = games.find(x => x.id === id);
  if (!g) return { ok: false, error: 'Jeu introuvable.' };
  const exe = aswRoomExe();
  if (!exe) return { ok: false, error: 'Le serveur de salon du moteur Switch (arcadia-room.exe) est introuvable : réinstalle Arcadia.' };
  swnetStop();
  let firewall = fwRuleOk(exe) ? 'ok' : null;
  if (!firewall) { firewall = (await fwRuleAdd(exe)) ? 'ok' : 'refused'; log?.write('MULTI', `règle du pare-feu Windows : ${firewall}`); }
  const title = decorate(g).title, tid = String(decorate(g).titleId || titleIdFrom(g.file) || MK8D);
  SWNET.password = Invite.newPassword();
  const ban = path.join(app.getPath('userData'), 'salon-bans.json');
  const args = ['--room-name', `Arcadia · ${title}`.slice(0, 60), '--port', String(SWNET.port), '--max-members', '8', '--password', SWNET.password,
    '--preferred-game', title, '--preferred-game-id', tid, '--ban-list-file', ban];
  const child = require('child_process').spawn(exe, args, { cwd: path.dirname(exe), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  child.on('exit', code => { if (SWNET.room === child) { SWNET.room = null; log?.write('MULTI', `salon Switch fermé (code ${code}) ${out.slice(-300)}`); } });
  child.on('error', e => log?.write('MULTI', `salon Switch : ${e.message}`));
  SWNET.room = child; SWNET.gameId = id;
  await new Promise(r => setTimeout(r, 1200));
  if (!SWNET.room) return { ok: false, error: `Le salon n'a pas pu s'ouvrir (port ${SWNET.port} déjà pris ?).` };
  const lan = mainLanIp();
  SWNET.upnp = lan ? await UPnP.openPort({ fetch: (u, o) => net.fetch(u, o), port: SWNET.port, protocol: 'UDP', localIp: lan, description: 'Arcadia - salon Switch' }) : { ok: false, error: 'pas de réseau local' };
  if (!SWNET.upnp.ok && lan) { // pas d'UPnP : on tente NAT-PMP auprès de la box
    const viaPmp = await UPnP.openPortPmp({ gateway: defaultGateway(), port: SWNET.port, protocol: 'UDP' });
    log?.write('MULTI', `UPnP : ${SWNET.upnp.error} ; NAT-PMP : ${viaPmp.ok ? 'ok' : viaPmp.error}`);
    if (viaPmp.ok) SWNET.upnp = viaPmp; else SWNET.upnp.error = `UPnP : ${SWNET.upnp.error} · NAT-PMP : ${viaPmp.error}`;
  }
  if (SWNET.upnp.ok) { store.data.upnpOpen = { port: SWNET.port, protocol: 'UDP', at: Date.now(), lease: SWNET.upnp.lease }; store.save(); }
  const pub = (SWNET.upnp.ok && SWNET.upnp.externalIp && !isPrivateIp(SWNET.upnp.externalIp) ? SWNET.upnp.externalIp : null) || await publicIp();
  // box derrière une autre box ou adresse partagée de l'opérateur (CGNAT, fréquent en 4G/5G) : impossible d'héberger par Internet
  const ext = SWNET.upnp.ok ? SWNET.upnp.externalIp : null;
  const cgnat = !!ext && (isPrivateIp(ext) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ext) || (pub && ext !== pub));
  SWNET.code = Invite.encode({ publicIp: pub, lanIp: lan, port: SWNET.port, password: SWNET.password });
  log?.write('MULTI', `salon Switch ouvert pour ${title} · LAN ${lan} · public ${pub} · UPnP ${SWNET.upnp.ok ? 'ok' : SWNET.upnp.error}`);
  return { ok: true, code: SWNET.code, lan, public: pub, upnp: SWNET.upnp.ok, upnpVia: SWNET.upnp.via || 'UPnP', upnpError: SWNET.upnp.ok ? null : SWNET.upnp.error, port: SWNET.port, firewall, cgnat };
});
ipcMain.handle('swnet:stop', () => { swnetStop(); return { ok: true }; });
const inv_lan = code => (Invite.decode(code) || {}).lanIp;
// Le salon répond-il ? Demande de connexion ENet (protocole des salons) : toute réponse = joignable
function probeRoom(host, port, timeout = 3000) {
  return new Promise(resolve => {
    const sock = require('dgram').createSocket('udp4');
    let done = false;
    const end = ok => { if (done) return; done = true; try { sock.close(); } catch { /* */ } resolve(ok); };
    sock.on('message', (_m, rinfo) => { if (rinfo.port === port) end(true); });
    sock.on('error', () => end(false));
    const b = Buffer.alloc(4 + 4 + 44);
    b.writeUInt16BE(0x8000 | 0x0FFF, 0); b.writeUInt16BE(Date.now() & 0xffff, 2);        // en-tête : pas encore de pair, heure d'envoi
    b.writeUInt8(0x80 | 2, 4); b.writeUInt8(0xff, 5); b.writeUInt16BE(1, 6);             // commande CONNECT (accusé demandé)
    let o = 8;
    b.writeUInt16BE(0, o); o += 2; b.writeUInt8(0xff, o++); b.writeUInt8(0xff, o++);       // pair sortant, sessions
    for (const v of [1392, 32768, 1, 0, 0, 5000, 2, 2, (Math.random() * 0xffffffff) >>> 0, 0]) { b.writeUInt32BE(v, o); o += 4; }
    const send = () => { if (!done) sock.send(b, port, host, () => {}); };
    send(); setTimeout(send, 700); setTimeout(send, 1500);
    setTimeout(() => end(false), timeout);
  });
}
// 2) lancer le jeu de l'hôte (connecté à son propre salon) ou d'un ami (code d'invitation)
ipcMain.handle('swnet:play', async (_e, id, code) => {
  let addr, port, password;
  if (code) {
    const inv = Invite.decode(code);
    if (!inv) return { ok: false, error: 'Code d\'invitation invalide : vérifie qu\'il est complet.' };
    port = inv.port; password = inv.password;
    // on teste les deux routes (réseau local et Internet) : beaucoup de box utilisent les mêmes adresses 192.168.1.x
    const cands = [inv.lanIp, inv.publicIp].filter(Boolean);
    if (!cands.length) return { ok: false, error: 'Ce code ne contient pas d\'adresse joignable.' };
    const res = await Promise.all(cands.map(a => probeRoom(a, port).then(ok => ({ a, ok }))));
    log?.write('MULTI', `test du salon : ${res.map(r => `${r.a === inv.lanIp ? 'local' : 'Internet'} ${r.ok ? 'répond' : 'muet'}`).join(', ')}`);
    const hit = res.find(r => r.ok);
    if (!hit) return { ok: false, error: `Le salon de ton ami ne répond pas, ni en réseau local ni par Internet. S'il n'est pas chez toi : sa box doit laisser passer le port UDP ${port} vers son PC (sa fenêtre « Héberger » doit afficher « ✓ Par Internet »). Sinon, essayez dans l'autre sens : c'est toi qui héberges.` };
    addr = hit.a;
  } else {
    if (!SWNET.room || SWNET.gameId !== id) return { ok: false, error: 'Le salon est fermé : héberge à nouveau.' };
    addr = '127.0.0.1'; port = SWNET.port; password = SWNET.password;
  }
  const host = !code;
  log?.write('MULTI', `Switch en ligne : ${host ? 'hôte' : 'invité'} → ${addr}:${port}`);
  const r = startGame(id, { skipResume: true, netHost: host, switchArgs: `-m "${netName()}:${password}@${addr}:${port}"`, onExit: host ? swnetStop : null });
  if (!r.ok && host) swnetStop();
  return r;
});

// ---------------------------------------------------------------- IPC : 1.5
ipcMain.handle('app:log', (_e, level, msg) => log?.write(level, String(msg).slice(0, 4000)));
ipcMain.handle('app:openLog', () => shell.openPath(log.file));
// Rapport de plantage : journaux d'Arcadia et des moteurs dans un seul .zip sur le Bureau (rien n'est envoyé tout seul)
// Jeux d'instructions du processeur (lus par le moteur Arcadia) : diagnostic et vérification avant le moteur Switch
let CPU_INFO = null;
function cpuInfo() {
  if (CPU_INFO) return CPU_INFO;
  try {
    const exe = path.join(runnerDir(), process.platform === 'win32' ? 'arcadia-runner.exe' : 'arcadia-runner');
    const r = require('child_process').spawnSync(exe, ['--cpuinfo'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    CPU_INFO = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).pop());
  } catch { CPU_INFO = {}; }
  return CPU_INFO;
}
const sha256File = f => new Promise(res => { try { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', () => res(null)); } catch { res(null); } });
async function engineInventory() {
  const list = [];
  const add = async (label, exe) => { if (!exe || !exists(exe)) { list.push({ label, present: false }); return; } const st = fs.statSync(exe); let ver = null; try { ver = fs.readFileSync(path.join(path.dirname(exe), 'VERSION_ARCADIA.txt'), 'utf8').trim(); } catch { /* moteur livré avec Arcadia */ } list.push({ label, present: true, path: exe.replace(require('os').homedir(), '~'), size: st.size, sha256: await sha256File(exe), version: ver }); };
  await add('arcadia-runner', path.join(runnerDir(), process.platform === 'win32' ? 'arcadia-runner.exe' : 'arcadia-runner'));
  await add('arcadia-switch', arcadiaSwitchExe());
  await add('arcadia-room', aswRoomExe());
  const mapping = store.get('mapping') || {};
  for (const [c, m] of Object.entries(mapping)) if (m && m.exe) await add(`${c} → ${m.emulator}`, m.exe);
  return list;
}
ipcMain.handle('app:report', async () => {
  try {
    const entries = [];
    const add = (file, as) => { try { const st = fs.statSync(file); if (st.isFile() && st.size < 30 * 1024 * 1024) entries.push({ name: as, data: fs.readFileSync(file), mtime: st.mtime }); } catch { /* absent */ } };
    add(log.file, 'arcadia/arcadia.log'); add(log.file + '.1', 'arcadia/arcadia.log.1');
    for (const [i, d] of switchTargets().entries()) for (const f of ['eden_log.txt', 'eden_log.txt.old.txt', 'arcadia-crash.txt']) add(path.join(d, 'log', f), `switch-${i}/${f}`);
    const rd = runnerData();
    for (const sub of ['', 'log', 'logs']) { try { for (const f of fs.readdirSync(path.join(rd, sub))) if (/\.(log|txt)$/i.test(f)) add(path.join(rd, sub, f), `moteur-arcadia/${sub ? sub + '-' : ''}${f}`); } catch { /* */ } }
    const os = require('os');
    const info = { version: app.getVersion(), electron: process.versions.electron, os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, ram: Math.round(os.totalmem() / 1e9) + ' Go', date: new Date().toISOString(),
      settings: Object.fromEntries(Object.entries(settings()).filter(([k]) => !/key|token|discord|path|dir/i.test(k))) };
    try { info.cpuFeatures = cpuInfo(); } catch { /* */ }
    try { const gpu = await app.getGPUInfo('basic'); info.gpu = (gpu.gpuDevice || []).map(d => ({ vendor: d.vendorId, device: d.deviceId, active: d.active, driver: d.driverVersion })); } catch { /* */ }
    try { info.engines = await engineInventory(); } catch (e) { info.engines = String(e.message); }
    info.switchEngine = settings().switchEngine || 'arcadia';
    info.fallbacks = Object.entries(store.get('gameSettings') || {}).filter(([, v]) => v && v.fallback).map(([k, v]) => ({ game: k, fallback: v.fallback }));
    info.firewallRoom = (() => { try { const e = aswRoomExe(); return e ? fwRuleOk(e) : null; } catch { return null; } })();
    entries.unshift({ name: 'infos.json', data: Buffer.from(JSON.stringify(info, null, 2)) });
    const out = path.join(app.getPath('desktop'), `Arcadia-rapport-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`);
    require('./src/ziplite').writeZip(out, entries);
    shell.showItemInFolder(out);
    return { ok: true, file: out, count: entries.length - 1 };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('app:storeBackups', () => listStoreBackups(path.join(savesRoot(), '_arcadia')));
ipcMain.handle('app:restoreStore', (_e, file) => {
  const dir = path.join(savesRoot(), '_arcadia');
  if (!isInside(path.resolve(file), path.resolve(dir))) return { ok: false, error: 'Fichier inconnu' };
  JSON.parse(fs.readFileSync(file, 'utf8')); // valide
  fs.copyFileSync(store.file, store.file + '.avant-restauration');
  fs.copyFileSync(file, store.file);
  app.relaunch(); app.exit(0);
  return { ok: true };
});
// Captures d'écran prises pendant les sessions de ce jeu (copiées dans le cache d'Arcadia)
ipcMain.handle('game:shots', (_e, id) => {
  const g = games.find(x => x.id === id);
  const setup = g && setupFor(g);
  if (!setup?.emulator) return [];
  const ses = Saves.sessions(gameSavesDir(g));
  if (!ses.length) return [];
  const dir = path.join(MEDIA(), 'gshots', id);
  fs.mkdirSync(dir, { recursive: true });
  return sessionShots(setup.emulator, saveCtx(setup, g), g.path, ses).map(s => {
    const dest = path.join(dir, `${Math.round(s.mtime)}-${path.basename(s.path)}`);
    if (!exists(dest)) { try { fs.copyFileSync(s.path, dest); } catch { return null; } }
    return dest;
  }).filter(Boolean);
});
// Statistiques : heures par jeu / console, sessions par jour
ipcMain.handle('stats:all', () => {
  const stats = store.get('stats') || {};
  return games.filter(g => !(store.get('media')[g.id] || {}).patch).map(g => ({
    id: g.id, title: decorate(g).title, console: g.console, ...(stats[g.id] || { playtime: 0, plays: 0, lastPlayed: 0 }),
    sessions: Saves.sessions(gameSavesDir(g)).map(x => ({ start: x.start, seconds: x.seconds }))
  }));
});
// Télécommande téléphone
function remoteServer() {
  remote ||= new Remote({
    getGames: () => games.filter(g => !(store.get('media')[g.id] || {}).patch).map(decorate).sort((a, b) => a.title.localeCompare(b.title)),
    coverOf: id => { const g = games.find(x => x.id === id); const d = g && decorate(g); return d && (d.cover || d.icon); },
    launch: id => startGame(id, { skipResume: true })
  });
  return remote;
}
ipcMain.handle('remote:set', async (_e, on) => {
  store.data.settings = { ...settings(), remoteEnabled: !!on };
  store.save();
  if (!on) { remote?.stop(); return { ok: true, urls: [] }; }
  try { return { ok: true, urls: await remoteServer().start() }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('remote:urls', () => (remote?.server ? remote.urls() : []));

// ---------------------------------------------------------------- IPC : sauvegardes
ipcMain.handle('saves:list', (_e, id) => {
  const g = games.find(x => x.id === id);
  const setup = g && setupFor(g);
  if (!setup?.emulator || (!KNOWN_EMULATORS[setup.emulator] && !setup.runner)) return { items: [], root: savesRoot() };
  const dir = gameSavesDir(g);
  const host = Saves.safe(require('os').hostname());
  const ses = Saves.sessions(dir);
  return { root: savesRoot(), dir, emulator: setup.runner ? 'Arcadia (moteur intégré)' : KNOWN_EMULATORS[setup.emulator].name, runner: !!setup.runner, isolated: setup.runner || !!Saves.gameFilter(setup.emulator, gameKey(g)) || !Saves.SAVE_DIRS[setup.emulator],
    items: Saves.list(dir).map(b => ({ ...b, here: b.machine === host })),
    sessions: { count: ses.length, total: ses.reduce((a, x) => a + (x.seconds || 0), 0), last: ses.slice(-5).reverse() } };
});
ipcMain.handle('saves:backup', (_e, id) => {
  const g = games.find(x => x.id === id);
  if (!g) return { ok: false, error: 'Jeu introuvable' };
  try { const r = backupFor(g, true); return r.file ? { ok: true, ...r } : { ok: false, error: r.skipped }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('saves:restore', (_e, id, file) => {
  const g = games.find(x => x.id === id);
  if (!g) return { ok: false, error: 'Jeu introuvable' };
  if (running.size) return { ok: false, error: 'Ferme le jeu en cours avant de restaurer.' };
  const setup = setupFor(g);
  if (!isInside(path.resolve(file), path.resolve(savesRoot()))) return { ok: false, error: 'Fichier hors du dossier des sauvegardes.' };
  try {
    try { backupFor(g, true); } catch { /* rien à protéger */ } // filet de sécurité : l'état actuel est copié avant
    return { ok: true, ...Saves.restore(file, { emuId: setup.emulator, ctx: saveCtx(setup, g), romPath: g.path }) };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Avant de jouer : une copie plus récente faite sur un autre PC ? (cloud)
ipcMain.handle('saves:check', (_e, id) => {
  if (!settings().cloudPrompt) return null;
  const g = games.find(x => x.id === id);
  const setup = g && setupFor(g);
  if (!setup?.emulator || !KNOWN_EMULATORS[setup.emulator]) return null;
  const latest = Saves.list(gameSavesDir(g))[0];
  if (!latest || latest.machine === Saves.safe(require('os').hostname())) return null;
  const local = Saves.localNewest(setup.emulator, saveCtx(setup, g), g.path, gameKey(g));
  return latest.mtime > local + 60000 ? latest : null;
});
ipcMain.handle('saves:cloud', () => Saves.cloudCandidates());
// « Lier Google Drive » : via l'application officielle Google Drive pour ordinateur (synchronisation automatique)
ipcMain.handle('saves:linkDrive', () => {
  const g = Saves.cloudCandidates().find(c => c.label === 'Google Drive');
  if (!g) { shell.openExternal('https://www.google.com/drive/download/'); return { ok: false, needInstall: true }; }
  const dir = path.join(g.path, 'Arcadia', 'saves');
  fs.mkdirSync(dir, { recursive: true });
  store.data.settings = { ...settings(), savesDir: dir };
  store.save();
  return { ok: true, dir, state: snapshot() };
});
// Moteur intégré : dossier des sauvegardes rapides (emplacements) du jeu
ipcMain.handle('saves:openStates', (_e, id) => {
  const g = games.find(x => x.id === id); if (!g) return;
  const d = runnerPaths(g).states; fs.mkdirSync(d, { recursive: true }); shell.openPath(d);
});
ipcMain.handle('saves:openFolder', (_e, id) => { const g = id && games.find(x => x.id === id); const d = g ? gameSavesDir(g) : savesRoot(); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });
ipcMain.handle('saves:chooseDir', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Dossier des sauvegardes (ex. dans OneDrive)', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return snapshot();
  store.data.settings = { ...settings(), savesDir: res.filePaths[0] };
  store.save();
  return snapshot();
});

// ---------------------------------------------------------------- IPC : catégories
ipcMain.handle('cats:create', (_e, name, gameId) => {
  const cats = store.get('categories');
  const id = crypto.randomBytes(4).toString('hex');
  cats.push({ id, name: name.trim() || 'Nouvelle catégorie', collapsed: false });
  if (gameId) store.get('gameCats')[gameId] = [...(store.get('gameCats')[gameId] || []), id];
  store.save();
  return snapshot();
});

ipcMain.handle('cats:rename', (_e, id, name) => {
  const c = store.get('categories').find(x => x.id === id);
  if (c && name.trim()) c.name = name.trim();
  store.save();
  return snapshot();
});

ipcMain.handle('cats:delete', (_e, id) => {
  store.data.categories = store.get('categories').filter(x => x.id !== id);
  for (const [g, list] of Object.entries(store.get('gameCats'))) store.get('gameCats')[g] = list.filter(c => c !== id);
  store.save();
  return snapshot();
});

ipcMain.handle('cats:toggle', (_e, gameId, catId) => {
  const map = store.get('gameCats');
  const list = new Set(map[gameId] || []);
  list.has(catId) ? list.delete(catId) : list.add(catId);
  map[gameId] = [...list];
  store.save();
  return snapshot();
});

ipcMain.handle('cats:collapse', (_e, id, collapsed) => {
  const ui = store.data.ui || (store.data.ui = {});
  ui.collapsed = ui.collapsed || {};
  ui.collapsed[id] = collapsed;
  store.save();
});

ipcMain.handle('ui:get', () => store.data.ui || {});
ipcMain.handle('ui:set', (_e, patch) => { store.data.ui = { ...(store.data.ui || {}), ...patch }; store.save(); });

// ---------------------------------------------------------------- IPC : import par glisser-déposer
const askWaiters = new Map();
ipcMain.handle('import:answer', (_e, askId, consoleId) => {
  const w = askWaiters.get(askId);
  if (w) { askWaiters.delete(askId); w(consoleId); }
});

// ---------------------------------------------------------------- glisser-déposer : clés, firmware et BIOS triés et installés tout seuls
// Ce qui n'est pas un fichier système repart vers l'importation des jeux.
const SYS_ARCHIVE = /\.(zip|7z|rar)$/i;
function walkFiles(dir, depth = 3, out = []) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walkFiles(p, depth - 1, out); } else out.push(p);
    if (out.length > 5000) break;
  }
  return out;
}
function isProdKeys(f) {
  if (!/\.keys$/i.test(f)) return false;
  try { return fs.statSync(f).size < 1024 * 1024 && /^\s*header_key\s*=/m.test(fs.readFileSync(f, 'utf8')); } catch { return false; }
}
function classifyBios(f) {
  const n = path.basename(f).toLowerCase(); let size = 0;
  try { size = fs.statSync(f).size; } catch { return null; }
  if (!/\.(bin|rom0?)$/.test(n)) return null;
  if (size === 524288 && /^(scph|ps1_rom|psx|ps-)/.test(n)) return { kind: 'bios', id: 'PS1' };
  if ((size === 4194304 || size === 8388608) && /scph|ps2|bios|rom0/.test(n)) return { kind: 'bios', id: 'PS2' };
  if (n === 'dc_boot.bin' && size === 2097152) return { kind: 'bios', id: 'DREAMCAST' };
  if (size === 512 && /mcpx/.test(n)) return { kind: 'xbox', what: 'mcpx' };
  if ((size === 262144 || size === 1048576) && /xbox|complex|evox|cromwell|bios/.test(n)) return { kind: 'xbox', what: 'bios' };
  return null;
}
async function systemDrop(paths) {
  const done = [], errors = [], rest = [];
  const keys = [], fwDirs = [], fwZips = [], looseNca = [], ps3 = [], vita = [], bios = {}, xbox = [];
  for (const p of paths) {
    let st; try { st = fs.statSync(p); } catch { rest.push(p); continue; }
    if (st.isDirectory()) {
      const files = walkFiles(p);
      const ncas = files.filter(f => /\.nca$/i.test(f));
      const k = files.filter(isProdKeys);
      const pups = files.filter(f => /\.pup$/i.test(f));
      const bs = files.map(f => [f, classifyBios(f)]).filter(x => x[1]);
      if (ncas.length >= 20) fwDirs.push(p);
      keys.push(...k);
      for (const f of pups) (/^ps3updat/i.test(path.basename(f)) ? ps3 : vita).push(f);
      for (const [f, c] of bs) c.kind === 'bios' ? (bios[c.id] = bios[c.id] || []).push(f) : xbox.push([c.what, f]);
      if (ncas.length < 20) rest.push(p); // dossier de jeux : importé en plus (les fichiers système en sont écartés)
      continue;
    }
    const name = path.basename(p);
    if (isProdKeys(p)) { keys.push(p); continue; }
    if (/^title\.keys$/i.test(name)) continue; // copié avec prod.keys s'il est à côté
    if (/\.nca$/i.test(name)) { looseNca.push(p); continue; }
    if (/^ps3updat\.pup$/i.test(name)) { ps3.push(p); continue; }
    if (/^(psvupdat|psp2updat)\.pup$/i.test(name)) { vita.push(p); continue; }
    const b = classifyBios(p);
    if (b) { b.kind === 'bios' ? (bios[b.id] = bios[b.id] || []).push(p) : xbox.push([b.what, p]); continue; }
    if (/\.zip$/i.test(name)) { const names = require('./src/ziplite').zipNames(p); if (names && names.filter(n => /\.nca$/i.test(n)).length >= 20) { fwZips.push(p); continue; } }
    if (SYS_ARCHIVE.test(name) && /firmware|\bfw\b/i.test(name)) { fwZips.push(p); continue; }
    rest.push(p);
  }
  const run = async (label, fn) => { try { const r = await fn(); if (r && r.ok) done.push(r.message || `${label} : installé`); else if (r && r.error) errors.push(`${label} : ${r.error}`); } catch (e) { errors.push(`${label} : ${e.message}`); } };
  if (keys.length) await run('Clés Switch', () => switchInstall('keys', keys[0]));
  if (looseNca.length >= 20) {
    const tmp = path.join(app.getPath('temp'), 'arcadia-fw-drop'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    for (const f of looseNca) fs.copyFileSync(f, path.join(tmp, path.basename(f)));
    fwDirs.push(tmp);
  } else rest.push(...looseNca);
  for (const d of [...fwDirs, ...fwZips].slice(0, 1)) await run('Firmware Switch', () => switchInstall('firmware', d));
  if (ps3.length) await run('Firmware PS3', async () => { const r = await ps3Firmware('pick', ps3[0]); return r.ok ? { ok: true, message: r.already ? 'Firmware PS3 déjà installé' : 'Firmware PS3 installé' } : r; });
  if (vita.length) await run('Firmware PS Vita', async () => { const r = await vitaFirmware('pick', vita); return r.ok ? { ok: true, message: 'Firmware PS Vita installé' } : r; });
  for (const [id, files] of Object.entries(bios)) await run(`BIOS ${id === 'DREAMCAST' ? 'Dreamcast' : id}`, async () => { const r = await biosInstall(id, files); return r.ok ? { ok: true, message: `BIOS ${id === 'DREAMCAST' ? 'Dreamcast' : id} installé` } : r; });
  for (const [what, f] of xbox) await run(what === 'mcpx' ? 'MCPX Xbox' : 'BIOS Xbox', () => xboxInstall(what, f));
  if (done.length || errors.length) log?.write('INFO', `glisser-déposer système : ${[...done, ...errors].join(' | ')}`);
  return { done, errors, rest, state: done.length ? snapshot() : null };
}
ipcMain.handle('system:drop', (_e, paths) => systemDrop(Array.isArray(paths) ? paths : []));
ipcMain.handle('import:paths', (_e, paths) => runImport(paths));
async function runImport(paths) {
  const lib = store.get('libraryDir');
  if (!lib) return { ok: false, error: "Choisis d'abord le dossier de ta bibliothèque." };
  if (importing) return { ok: false, error: 'Une importation est déjà en cours.' };
  importing = true;
  try {
    createConsoleFolders(lib);
    const importer = new Importer({
      libraryDir: lib,
      ask: name => new Promise(resolve => {
        const askId = crypto.randomBytes(4).toString('hex');
        askWaiters.set(askId, resolve);
        win?.webContents.send('import:ask', { askId, name });
      }),
      trash: p => shell.trashItem(p),
      onProgress: s => win?.webContents.send('import:progress', s),
      games: games.map(g => ({ path: g.path, console: g.console, title: decorate(g).title, size: g.size, id: g.id })),
      onDuplicate: info => new Promise(resolve => {
        const askId = crypto.randomBytes(4).toString('hex');
        askWaiters.set(askId, resolve);
        win?.webContents.send('import:duplicate', { askId, name: info.name, same: info.same, existing: { title: info.existing.title, console: info.existing.console, file: path.basename(info.existing.path) } });
      })
    });
    const results = await importer.run(paths);
    rescan();
    return { ok: true, results: results.map(r => ({ ...r, name: path.basename(r.src) })), state: snapshot() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    importing = false;
  }
}

ipcMain.handle('import:pick', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Ajouter des ROM', properties: ['openFile', 'multiSelections'] });
  return res.canceled ? [] : res.filePaths;
});

// ---------------------------------------------------------------- IPC : réglages d'Arcadia & fenêtre
ipcMain.handle('app:settings', (_e, patch) => {
  if (patch) store.data.settings = { ...settings(), ...patch, shortcuts: { ...settings().shortcuts, ...(patch.shortcuts || {}) } };
  store.save();
  if (patch && 'coversOnline' in patch && patch.coversOnline) queueMedia();
  return snapshot();
});
ipcMain.handle('app:setFullscreen', (_e, on) => { const prev = !!win?.isFullScreen(); win?.setFullScreen(!!on); return prev; });
ipcMain.handle('app:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win?.isFullScreen(); });
ipcMain.handle('app:resetMedia', () => {
  store.data.media = {};
  store.save();
  rescan();
  return snapshot();
});

// ---------------------------------------------------------------- IPC : tri automatique de la bibliothèque
ipcMain.handle('library:loose', () => {
  loose = findLoose(store.get('libraryDir'));
  return loose.map(x => ({ name: x.name, rel: path.relative(store.get('libraryDir'), x.path), console: x.console, archive: !!x.archive, folder: !!x.folder }));
});
ipcMain.handle('library:sort', async () => {
  const items = findLoose(store.get('libraryDir'));
  if (!items.length) return { ok: true, results: [], state: snapshot() };
  return runImport(items.map(x => x.path));
});

// ---------------------------------------------------------------- IPC : réglages des émulateurs
function emuCtx(id) {
  const fromMapping = Object.values(store.get('mapping') || {}).find(m => m.emulator === id && m.exe);
  let exe = fromMapping ? fromMapping.exe : null;
  for (const d of [store.get('emulatorsDir'), EMU_DIR()]) if (!exe && d && exists(d)) exe = detectEmulators(d)[id] || null;
  return {
    exe,
    exeDir: exe ? path.dirname(exe) : path.join(app.getPath('temp'), '__arcadia_no_exe__'),
    appData: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
    documents: app.getPath('documents')
  };
}
const plain = o => JSON.parse(JSON.stringify(o)); // retire les fonctions des schémas
function emuState(id) {
  const schema = SCHEMAS.find(s => s.id === id);
  if (!schema) throw new Error('Émulateur inconnu');
  const ctx = emuCtx(id);
  const file = ctx.exe || schema.format === 'qtini' ? resolveFile(schema, ctx) : null;
  const exists = !!file && fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : '';
  const runningNow = games.some(g => running.has(g.id) && (store.get('mapping')[g.console] || {}).emulator === id);
  return { id, name: schema.name, consoles: schema.consoles, format: schema.format, note: schema.note || null, exe: ctx.exe, file, exists, running: runningNow,
    pages: plain(schema.pages), values: readValues(schema.format, text, allFields(schema)),
    presets: !!PRESETS[id], pad: !!PADS[id], unlocks: (UNLOCKS[id] || []).map(u => ({ id: u.id, label: u.label, desc: u.desc, on: sameVal(readValues(schema.format, text, unlockFields(schema, [u]))[u.key], u.on) })) };
}
const sameVal = (a, b) => String(a) === String(b);
function unlockFields(schema, list) {
  const known = allFields(schema);
  return list.map(u => known.find(f => f.key === u.key) || { key: u.key, type: 'text', ...u.extra });
}
function writeEmu(id, changes, extraFields = []) {
  const schema = SCHEMAS.find(s => s.id === id);
  const st = emuState(id);
  if (!st.file) return { ok: false, error: `Indique d'abord l'exécutable de ${schema.name} (Émulateurs).` };
  if (st.running) return { ok: false, error: `${schema.name} est en cours d'utilisation : ferme le jeu avant de modifier ses réglages.` };
  const text = st.exists ? fs.readFileSync(st.file, 'utf8') : '';
  try {
    saveFile(st.file, writeValues(schema.format, text, [...allFields(schema), ...extraFields], changes));
    return { ok: true, state: emuState(id) };
  } catch (e) { return { ok: false, error: e.message }; }
}
// ---------------------------------------------------------------- qualité graphique : Minimal / Moyenne / Maximum / Auto
const LEVEL_KEY = { minimal: 'perf', moyenne: 'balanced', maximum: 'quality' };
// Moteur intégré : options des cœurs par profil
const RUNNER_PRESETS = {
  PSP: { minimal: { ppsspp_internal_resolution: '480x272' }, moyenne: { ppsspp_internal_resolution: '960x544' }, maximum: { ppsspp_internal_resolution: '1920x1088' } },
  '3DS': { minimal: { citra_resolution_factor: '1' }, moyenne: { citra_resolution_factor: '2' }, maximum: { citra_resolution_factor: '4' } },
  DS: { minimal: { melonds_opengl_renderer: 'disabled', melonds_opengl_resolution: '1x native (256x192)' },
        moyenne: { melonds_opengl_renderer: 'enabled', melonds_opengl_resolution: '2x native (512x384)' },
        maximum: { melonds_opengl_renderer: 'enabled', melonds_opengl_resolution: '4x native (1024x768)' } },
  N64: { minimal: { 'mupen64plus-EnableNativeResFactor': '1' }, moyenne: { 'mupen64plus-EnableNativeResFactor': '2' }, maximum: { 'mupen64plus-EnableNativeResFactor': '4' } },
  PS1: { minimal: { swanstation_GPU_ResolutionScale: '1' }, moyenne: { swanstation_GPU_ResolutionScale: '3' }, maximum: { swanstation_GPU_ResolutionScale: '5' } },
  DREAMCAST: { minimal: { reicast_internal_resolution: '640x480' }, moyenne: { reicast_internal_resolution: '1280x960' }, maximum: { reicast_internal_resolution: '2560x1920' } },
  GAMECUBE: { minimal: { dolphin_efb_scale: '1' }, moyenne: { dolphin_efb_scale: '2' }, maximum: { dolphin_efb_scale: '4' } },
  WII: { minimal: { dolphin_efb_scale: '1' }, moyenne: { dolphin_efb_scale: '2' }, maximum: { dolphin_efb_scale: '4' } },
  PS2: { minimal: { pcsx2_upscale_multiplier: '1x (Native)' }, moyenne: { pcsx2_upscale_multiplier: '2x' }, maximum: { pcsx2_upscale_multiplier: '4x' } }
};
// Console ajoutée après le choix du profil : on lui applique le profil retenu au premier lancement
function ensureRunnerPreset(consoleId) {
  const p = RUNNER_PRESETS[consoleId]; if (!p) return;
  const file = path.join(runnerData(), 'config', `${Saves.safe(consoleId)}.ini`);
  if (exists(file)) return;
  const lvl = settings().perfLevel === 'auto' ? (HW_CACHE?.level || 'moyenne') : (settings().perfLevel || 'moyenne');
  try { writeRunnerConfig(consoleId, p[lvl] || p.moyenne); } catch { /* lecture seule ? */ }
}
// Options imposées par Arcadia selon le cœur (BIOS PS1 : SwanStation n'accepte que certains noms de fichier)
const SWAN_BIOS = { NTSCJ: ['scph5500.bin'], NTSCU: ['scph5501.bin'], PAL: ['scph5502.bin'] };
const SWAN_ANY = ['scph5500.bin', 'scph5501.bin', 'scph5502.bin', 'ps1_rom.bin'];
function coreFixedOpts(setup) {
  // le moteur intégré dessine en OpenGL : « Auto » pourrait choisir Direct3D sous Windows
  if (setup?.coreName === 'pcsx2_libretro') return ['pcsx2_renderer=OpenGL'];
  if (setup?.coreName !== 'swanstation_libretro') return [];
  const have = biosFiles('PS1').map(n => n.toLowerCase()).filter(n => SWAN_ANY.includes(n));
  if (!have.length) return [];
  return Object.entries(SWAN_BIOS).map(([r, pref]) => `swanstation_BIOS_Path${r}=${have.find(n => pref.includes(n)) || (have.includes('ps1_rom.bin') ? 'ps1_rom.bin' : have[0])}`)
    .concat(['swanstation_CDROM_RegionCheck=false', 'swanstation_GPU_Renderer=OpenGL']);
}
let HW_CACHE = null;
async function detectHardware() {
  if (HW_CACHE) return HW_CACHE;
  const os = require('os');
  const cpus = os.cpus() || [];
  const hw = { cpu: (cpus[0]?.model || '').replace(/\s+/g, ' ').trim(), threads: cpus.length, ramGb: Math.round(os.totalmem() / 2 ** 30), gpus: [] };
  if (process.platform === 'win32') {
    try {
      const out = await new Promise(res => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }'], { windowsHide: true, timeout: 15000 }, (e, so) => res(e ? '' : so)));
      hw.gpus = out.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    } catch { /* WMI indisponible */ }
  }
  if (!hw.gpus.length) {
    try { const i = await app.getGPUInfo('complete'); hw.gpus = (i.gpuDevice || []).map(d => d.deviceString || d.driverVendor || '').filter(Boolean); } catch { /* rien */ }
  }
  // Note : carte graphique d'abord (c'est elle qui fait la résolution), puis mémoire et processeur
  const tierOf = n => {
    if (/RTX\s?(20[6-8]0\s?S|30[6-9]0|40[6-9]0|50\d0)|RX\s?(6[7-9]\d\d|7[7-9]\d\d|9\d\d\d)|Arc\s?B5|Radeon\s?Pro\s?W7/i.test(n)) return 2;
    if (/RTX|GTX\s?(10[6-8]0|16\d0)|RX\s?(5[5-7]00|6[4-6]\d\d|7[6]\d\d|5[89]0)|Arc\s?A[57]|Vega\s?(56|64)/i.test(n)) return 1;
    return 0; // graphique intégré ou ancien
  };
  let tier = Math.max(0, ...hw.gpus.map(tierOf));
  if (hw.ramGb && hw.ramGb < 8) tier = Math.min(tier, 0); else if (hw.ramGb && hw.ramGb < 16) tier = Math.min(tier, 1);
  if (hw.threads && hw.threads < 6) tier = Math.min(tier, 0); else if (hw.threads && hw.threads < 12) tier = Math.min(tier, 1);
  hw.level = ['minimal', 'moyenne', 'maximum'][tier];
  hw.gpu = hw.gpus.find(n => tierOf(n) === Math.max(...hw.gpus.map(tierOf))) || hw.gpus[0] || 'inconnue';
  HW_CACHE = hw;
  return hw;
}
function writeRunnerConfig(consoleId, opts) {
  const file = path.join(runnerData(), 'config', `${Saves.safe(consoleId)}.ini`);
  const kv = {};
  try { for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0 && line[0] !== '#') kv[line.slice(0, i)] = line.slice(i + 1); } } catch { /* nouveau fichier */ }
  for (const [k, v] of Object.entries(opts)) kv[`core:${k}`] = v;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Arcadia runner\n' + Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}
// Applique un profil à tous les émulateurs installés + au moteur intégré
async function applyPerfLevel(level, onlyEmu) {
  const hw = await detectHardware();
  const lvl = level === 'auto' ? hw.level : level;
  const key = LEVEL_KEY[lvl];
  if (!key) return { ok: false, error: 'Profil inconnu' };
  const dirs = [EMU_DIR(), store.get('emulatorsDir')].filter(exists);
  const found = Object.assign({}, ...dirs.map(d => detectEmulators(d)), ...Object.values(store.get('mapping') || {}).filter(m => m.emulator && exists(m.exe)).map(m => ({ [m.emulator]: m.exe })));
  const done = [], failed = [];
  for (const id of Object.keys(PRESETS)) {
    if (onlyEmu && id !== onlyEmu) continue;
    if (!found[id] || !PRESETS[id][key]) continue;
    try { const r = writeEmu(id, PRESETS[id][key]); (r.ok ? done : failed).push(KNOWN_EMULATORS[id]?.name || id); } catch { failed.push(KNOWN_EMULATORS[id]?.name || id); }
  }
  if (!onlyEmu) {
    for (const [c, p] of Object.entries(RUNNER_PRESETS)) { try { writeRunnerConfig(c, p[lvl]); done.push(`Moteur intégré ${c}`); } catch { failed.push(`Moteur intégré ${c}`); } }
    store.data.settings = { ...settings(), perfLevel: level }; store.save();
  }
  return { ok: true, level: lvl, done, failed, hardware: hw, state: snapshot() };
}
ipcMain.handle('perf:detect', () => detectHardware());
ipcMain.handle('perf:apply', (_e, level, onlyEmu) => applyPerfLevel(level, onlyEmu));

ipcMain.handle('emus:preset', (_e, id, level) => {
  const p = PRESETS[id] && PRESETS[id][level];
  if (!p) return { ok: false, error: 'Préréglage inconnu' };
  return writeEmu(id, p);
});
ipcMain.handle('emus:pad', (_e, id) => {
  const p = PADS[id];
  if (!p) return { ok: false, error: 'Configuration automatique non disponible pour cet émulateur' };
  return writeEmu(id, p, Object.keys(p).map(k => ({ key: k, type: 'text' })));
});
ipcMain.handle('emus:unlock', (_e, id, uid, on) => {
  const u = (UNLOCKS[id] || []).find(x => x.id === uid);
  if (!u) return { ok: false, error: 'Option inconnue' };
  const schema = SCHEMAS.find(s => s.id === id);
  return writeEmu(id, { [u.key]: on ? u.on : u.off }, unlockFields(schema, [u]).filter(f => !allFields(schema).some(k => k.key === f.key)));
});
// Mises à jour disponibles (une vérification toutes les 6 h au plus)
let updCache = null;
ipcMain.handle('emus:updates', async (_e, force) => {
  if (!force && updCache && Date.now() - updCache.t < 6 * 3600e3) return updCache.data;
  const dirs = [EMU_DIR(), store.get('emulatorsDir')].filter(exists);
  const found = Object.assign({}, ...dirs.map(d => detectEmulators(d)));
  const data = {};
  await Promise.all(Object.keys(found).filter(id => SOURCES[id]?.repo).map(async id => {
    const vf = path.join(path.dirname(found[id]), 'VERSION_ARCADIA.txt');
    const local = exists(vf) ? (fs.readFileSync(vf, 'utf8').split(/\r?\n/)[0].split(' ').pop() || '') : '';
    try { const a = await latestAsset(id); data[id] = { local: local || null, latest: a.version, update: !!local && local !== a.version }; } catch { /* hors ligne */ }
  }));
  updCache = { t: Date.now(), data };
  return data;
});
ipcMain.handle('emus:list', () => SCHEMAS.map(s => {
  const ctx = emuCtx(s.id);
  const file = ctx.exe || s.format === 'qtini' ? resolveFile(s, ctx) : null;
  return { id: s.id, name: s.name, consoles: s.consoles, installed: !!ctx.exe && fs.existsSync(ctx.exe), file, exists: !!file && fs.existsSync(file) };
}));
ipcMain.handle('emus:read', (_e, id) => emuState(id));
ipcMain.handle('emus:write', (_e, id, changes) => writeEmu(id, changes));

function edenDataDir(id) {
  const schema = SCHEMAS.find(s => s.id === id);
  return schema.dataDir ? schema.dataDir(emuCtx(id)) : null;
}
function listFiles(dir, ext) {
  const out = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.toLowerCase().endsWith(ext)) out.push(p); } };
  walk(dir);
  return out;
}
ipcMain.handle('emus:tool', async (_e, id, tool) => {
  const schema = SCHEMAS.find(s => s.id === id);
  const ctx = emuCtx(id);
  const data = edenDataDir(id);
  try {
    if (tool === 'openEmu') {
      if (!ctx.exe) return { ok: false, error: `Exécutable de ${schema.name} introuvable.` };
      require('child_process').spawn(ctx.exe, [], { cwd: ctx.exeDir, detached: true, stdio: 'ignore' }).unref();
      return { ok: true, message: `${schema.name} ouvert.` };
    }
    if (tool === 'openData') { fs.mkdirSync(data, { recursive: true }); shell.openPath(data); return { ok: true }; }
    if (tool === 'keys') {
      const res = await dialog.showOpenDialog(win, { title: 'Choisis prod.keys', properties: ['openFile'], filters: [{ name: 'Clés', extensions: ['keys'] }] });
      if (res.canceled) return { ok: false };
      const src = res.filePaths[0];
      if (path.basename(src).toLowerCase() !== 'prod.keys') return { ok: false, error: 'Choisis le fichier prod.keys.' };
      const keysDir = path.join(data, 'keys');
      fs.mkdirSync(keysDir, { recursive: true });
      const copied = [];
      for (const n of ['prod.keys', 'title.keys', 'key_retail.bin']) {
        const p = path.join(path.dirname(src), n);
        if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(keysDir, n)); copied.push(n); }
      }
      return { ok: true, message: `Clés installées : ${copied.join(', ')}.` };
    }
    if (tool === 'firmware') {
      const pick = await dialog.showMessageBox(win, { type: 'question', title: 'Installer le firmware', message: 'Le firmware est dans…', buttons: ['Un dossier', 'Un fichier .zip', 'Annuler'], cancelId: 2 });
      if (pick.response === 2) return { ok: false };
      const res = await dialog.showOpenDialog(win, pick.response === 0
        ? { title: 'Dossier du firmware (.nca)', properties: ['openDirectory'] }
        : { title: 'Firmware .zip', properties: ['openFile'], filters: [{ name: 'Archive', extensions: ['zip', '7z'] }] });
      if (res.canceled) return { ok: false };
      let srcDir = res.filePaths[0], tmp = null;
      if (pick.response === 1) {
        tmp = path.join(data, '_arcadia_fw');
        fs.rmSync(tmp, { recursive: true, force: true });
        const { extractArchive } = require('./src/importer');
        await extractArchive(srcDir, tmp, () => {});
        srcDir = tmp;
      }
      const ncas = listFiles(srcDir, '.nca');
      if (!ncas.length) { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); return { ok: false, error: 'Aucun fichier .nca trouvé.' }; }
      const reg = path.join(data, 'nand', 'system', 'Contents', 'registered');
      if (fs.existsSync(reg)) {
        fs.rmSync(reg + '.old', { recursive: true, force: true });
        fs.renameSync(reg, reg + '.old');
      }
      fs.mkdirSync(reg, { recursive: true });
      for (const f of ncas) fs.copyFileSync(f, path.join(reg, path.basename(f)));
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: true, message: `Firmware installé (${ncas.length} fichiers).` };
    }
    return { ok: false, error: 'Outil inconnu' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
