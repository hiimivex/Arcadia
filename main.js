const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, globalShortcut, screen, desktopCapturer, nativeImage } = require('electron');
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
const Multi = require('./src/multiplayer');
const SwitchCfg = require('./src/switchcfg');
const Proc = require('./src/proctl');
const Brand = require('./src/brand');
const { Helper } = require('./src/helper');
const Langs = require('./src/langs');
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
const { watchPad, closeProcess } = require('./src/padwatch');
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
  accentByConsole: false,    // lueur à la couleur de la console
  bigPictureOnStart: false,  // démarrer en mode TV
  autoBackup: true,          // copie des sauvegardes à la fermeture d'un jeu
  savesDir: '',              // '' = <Arcadia>\saves
  cloudPrompt: true,         // proposer une sauvegarde plus récente venant d'un autre PC
  discordId: '',             // Application ID Discord (Rich Presence)
  remoteEnabled: false,      // lancer les jeux depuis son téléphone (même Wi-Fi)
  padQuit: true,             // Back + Start maintenus 1,5 s = quitter le jeu
  useRunner: true,
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
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
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
    backgroundColor: '#171d25',
    title: 'Arcadia',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.once('ready-to-show', () => win.show());
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

app.whenReady().then(() => { if (helper.available) helper.start(); });
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
    langs: m.langs || Langs.CONSOLE_LANGS[g.console] || null, // langues proposées (lues dans la ROM, sinon celles de la console)
    langsFromRom: !!m.langs,
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
    hardware: HW_CACHE,
    status: Object.fromEntries(CONSOLES.map(c => [c.id, checkSetup(mapping[c.id])]))
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
      const sig = `${g.size}:${Math.round(g.mtime || 0)}` + (isSwitch(g) && keys ? ':k' : '') + ':L1'; // L1 : relit les langues de la ROM
      const m = media[g.id] || {};
      if (m.sig === sig && 'broken' in m && !(isSwitch(g) && !('titleId' in m))) continue;
      let info = null;
      let idInfo = null;
      if (isSwitch(g)) { try { info = switchInfo(g.path, keys); } catch { info = null; } try { idInfo = switchIdNoKeys(g.path); } catch { /* */ } }
      else info = extractInfo(g);
      const next = { ...m, sig, broken: looksEmpty(g.path), patch: !!(idInfo?.patch || /\[v[1-9]\d{3,}\]|0100[0-9A-F]{9}800\b/i.test(g.file)), title: info?.title || null, pixel: !!info?.pixel, icon: null, serial: info?.serial || null, langs: info?.langs && info.langs.length ? info.langs : null, titleId: info?.titleId || keylessId(g) || titleIdFrom(g.file) };
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
  for (const id of ['eden', 'lichii']) {
    const ctx = emuCtx(id);
    dirs.push(path.join(ctx.exeDir, 'user', 'keys'), path.join(ctx.appData, id, 'keys'));
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
  const dirs = [path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe')), ROOT, lib, lib && path.dirname(lib)].filter(exists);
  let best = null;
  for (const d of new Set(dirs)) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      const m = n.match(/^Arcadia-Setup-(\d+\.\d+\.\d+)\.exe$/i);
      if (m && verNum(m[1]) > verNum(app.getVersion()) && (!best || verNum(m[1]) > verNum(best.version))) best = { version: m[1], file: path.join(d, n) };
    }
  }
  return best;
}
ipcMain.handle('app:checkUpdate', () => (app.isPackaged && process.platform === 'win32' ? findUpdate() : null));
ipcMain.handle('app:installUpdate', (_e, file) => {
  const u = findUpdate();
  if (!u || path.resolve(u.file) !== path.resolve(file)) return { ok: false, error: 'Mise à jour introuvable' };
  const exeDir = path.dirname(app.getPath('exe'));
  const installDir = path.basename(exeDir).toLowerCase() === 'app' ? path.dirname(exeDir) : exeDir;
  require('child_process').spawn(u.file, ['/S', `/D=${installDir}`], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
  return { ok: true };
});

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
const RUNNER_CORES = {
  PSP: 'ppsspp_libretro', DS: 'melonds_libretro', '3DS': 'azahar_libretro',
  PS1: 'pcsx_rearmed_libretro', NES: 'mesen_libretro', SNES: 'bsnes_libretro', GBA: 'mgba_libretro', GB: 'mgba_libretro'
};
function runnerDir() { return app.isPackaged ? path.join(process.resourcesPath, 'runner') : path.join(__dirname, 'runner'); }
function runnerFor(consoleId) {
  const core = RUNNER_CORES[consoleId];
  if (!core) return null;
  const dir = runnerDir();
  const exe = path.join(dir, process.platform === 'win32' ? 'arcadia-runner.exe' : 'arcadia-runner');
  const lib = path.join(dir, 'cores', core + (process.platform === 'win32' ? '.dll' : '.so'));
  return exists(exe) && exists(lib) ? { exe, core: lib, system: path.join(dir, 'system') } : null;
}
function runnerData() {
  const emu = EMU_DIR();
  return emu ? path.join(emu, 'Arcadia') : path.join(app.getPath('userData'), 'runner');
}
// ---------------------------------------------------------------- Manettes (calibrage partagé par tous les moteurs)
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
    '--data', p.data, '--system', setup.system, '--saves', p.saves, '--states', p.states, '--shots', p.shots, '--config', p.config, ...padRunnerArgs(), ...extra];
  const start = Date.now();
  let seconds = null, error = null, buf = '';
  const child = require('child_process').spawn(setup.exe, args, { cwd: path.dirname(setup.exe), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
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
  if (rn && !external && (gs.emulator === 'arcadia' || (!gs.emulator && settings().useRunner !== false))) return { emulator: 'arcadia', runner: true, ...rn };
  let setup = base ? { ...base } : null;
  if (gs.emulator && gs.emulator !== (base && base.emulator)) {
    const e = KNOWN_EMULATORS[gs.emulator];
    const dirs = [EMU_DIR(), store.get('emulatorsDir')].filter(exists);
    const exe = Object.values(store.get('mapping') || {}).find(m => m.emulator === gs.emulator && exists(m.exe))?.exe
      || dirs.map(d => detectEmulators(d)[gs.emulator]).find(Boolean);
    if (e && exe) setup = { emulator: gs.emulator, exe, args: (e.argsByConsole || {})[g.console] || e.args };
  }
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
  for (const d of [EMU_DIR(), store.get('emulatorsDir')].filter(exists)) { const e = path.join(d, 'Eden', 'user'); if (exists(path.dirname(e))) dirs.add(e); } // Eden à venir
  return [...dirs];
}
ipcMain.handle('switch:install', async (_e, what) => {
  const targets = switchTargets();
  if (!targets.length) return { ok: false, error: 'Aucun émulateur Switch installé.' };
  try {
    if (what === 'keys') {
      const res = await dialog.showOpenDialog(win, { title: 'Choisis ton prod.keys', properties: ['openFile'], filters: [{ name: 'Clés Switch', extensions: ['keys'] }] });
      if (res.canceled) return { ok: false };
      const src = res.filePaths[0];
      if (!/^\s*header_key\s*=/m.test(fs.readFileSync(src, 'utf8'))) return { ok: false, error: 'Ce fichier ne contient pas de header_key : ce n\'est pas un prod.keys valide.' };
      for (const t of targets) {
        fs.mkdirSync(path.join(t, 'keys'), { recursive: true });
        fs.copyFileSync(src, path.join(t, 'keys', 'prod.keys'));
        const tk = path.join(path.dirname(src), 'title.keys'); if (exists(tk)) fs.copyFileSync(tk, path.join(t, 'keys', 'title.keys'));
      }
      return { ok: true, message: `Clés installées pour ${targets.length} émulateur(s) Switch.` };
    }
    if (what === 'firmware') {
      const res = await dialog.showOpenDialog(win, { title: 'Choisis ton firmware (.zip ou dossier de .nca)', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Firmware', extensions: ['zip', '7z'] }] });
      if (res.canceled) return { ok: false };
      let srcDir = res.filePaths[0], tmp = null;
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
});

// ---------------------------------------------------------------- menu Arcadia par-dessus un émulateur externe
// Échap, Guide ou Back+Start bref : le jeu est mis en pause (processus suspendu) et le menu Arcadia s'affiche.
const OV = { win: null, game: null, open: false, relaunch: null };
// Réglages proposés dans le menu Arcadia des moteurs Switch (appliqués au prochain lancement du jeu)
const SW_OPTS = [
  { sec: 'image', key: 'Renderer/resolution_setup', label: 'Résolution', values: [['1', '0,5x · 540p'], ['3', '1x · 1080p'], ['5', '1,5x · 1620p'], ['6', '2x · 4K'], ['7', '3x · 6K']], def: '3' },
  { sec: 'image', key: 'System/use_docked_mode', label: 'Mode de la console', values: [['1', 'TV · meilleure image'], ['0', 'Portable · plus léger']], def: '1' },
  { sec: 'image', key: 'Renderer/frame_gen', label: 'Génération d\'images', values: [['false', 'Désactivée'], ['true', '×2 · plus fluide']], def: 'false', hint: 'Double les images affichées par seconde. Peut ajouter un peu de latence.' },
  { sec: 'image', key: 'Renderer/use_vsync', label: 'Synchronisation verticale', values: [['2', 'Activée'], ['1', 'Mailbox · faible latence'], ['0', 'Désactivée']], def: '2' },
  { sec: 'image', key: 'Renderer/anti_aliasing', label: 'Anticrénelage', values: [['0', 'Aucun'], ['1', 'FXAA'], ['2', 'SMAA']], def: '1' },
  { sec: 'image', key: 'Renderer/scaling_filter', label: 'Filtre d\'agrandissement', values: [['1', 'Bilinéaire'], ['5', 'ScaleForce'], ['6', 'AMD FSR']], def: '6' },
  { sec: 'image', key: 'Renderer/aspect_ratio', label: 'Format', values: [['0', '16:9'], ['4', 'Étirer à l\'écran']], def: '0' },
  { sec: 'son', key: 'Audio/volume', label: 'Volume', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => [String(v), v + ' %']), def: '100' },
  { sec: 'son', key: 'Audio/audio_muted', label: 'Couper le son', values: [['false', 'Non'], ['true', 'Oui']], def: 'false' },
  { sec: 'manette', key: 'Arcadia/control', label: 'Jouer avec', values: [['pad', 'Ma manette'], ['keyboard', 'Le clavier']], def: 'pad', hint: 'Le moteur Switch n\'accepte qu\'une commande par touche : manette OU clavier.' },
  { sec: 'manette', key: 'Controls/vibration_enabled', label: 'Vibrations', values: [['true', 'Activées'], ['false', 'Désactivées']], def: 'true' }
];
// Langue retenue pour un jeu : choix du joueur, sinon le français s'il est dans la ROM
function gameLang(g) {
  const gs = (store.get('gameSettings') || {})[g.id] || {};
  return Langs.pick(gs.lang || null, decorate(g).langs);
}
function extOpts(id) { return ((store.get('extOpts') || {})[id]) || {}; }
function overlayData() {
  const G = OV.game; if (!G) return null;
  const g = games.find(x => x.id === G.id);
  const d = { title: G.title, console: G.consoleName, seconds: Math.round((Date.now() - G.start) / 1000), note: G.note, kind: G.kind };
  const inp = settings().input;
  d.pad = { name: inp && inp.type !== 'keyboard' ? inp.name : (G.padName || 'Clavier & souris'), type: inp ? inp.type : 'keyboard' };
  d.shortcuts = [['Échap', 'Ouvrir / fermer ce menu'], ['Guide (Xbox)', 'Ouvrir / fermer ce menu'], ['Back + Start', 'Ouvrir ce menu'], ['Back + Start (1,5 s)', 'Quitter le jeu'], ['F11', 'Plein écran / fenêtré']];
  if (G.kind === 'switch') {
    const inp0 = settings().input;
    const cur = { 'Arcadia/control': inp0 && inp0.type === 'keyboard' ? 'keyboard' : 'pad', ...SwitchCfg.readOpts(G.userDir, SW_OPTS.map(o => o.key)), ...extOpts(G.id) };
    d.opts = SW_OPTS.filter(o => !(G.dsu && o.key === 'Arcadia/control')).map(o => ({ ...o, value: String(cur[o.key] ?? o.def) }));
    d.dsu = !!G.dsu;
    const dg = g && decorate(g);
    if (dg && dg.langs && dg.langs.length) {
      const LN = Langs.LANGS, chosen = ((store.get('gameSettings') || {})[G.id] || {}).lang || '';
      d.opts.unshift({ sec: 'langue', key: 'Arcadia/lang', label: 'Langue du jeu', hint: dg.langsFromRom ? 'Langues présentes dans ce jeu' : 'Le jeu l\'utilise s\'il la propose', values: [['', dg.langs.includes('fr') ? 'Automatique (français)' : 'Automatique'], ...dg.langs.map(c => [c, LN[c] || c])], value: chosen });
    }
    d.pending = !!G.changed;
  }
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
async function grabShot() {
  OV.shot = null;
  if (!desktopCapturer) return;
  try {
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: Math.round(960 * disp.size.height / disp.size.width) } });
    const src = srcs.find(x => String(x.display_id) === String(disp.id)) || srcs[0];
    if (src && !src.thumbnail.isEmpty()) OV.shot = src.thumbnail.toPNG();
  } catch (e) { log?.write('INFO', `capture du menu : ${e.message}`); }
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
  if (!G || !SW_OPTS.some(o => o.key === key)) return overlayData();
  const all = store.get('extOpts') || {};
  all[G.id] = { ...(all[G.id] || {}), [key]: String(value) };
  store.data.extOpts = all; store.save();
  G.changed = true;
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
    let swDir = null, branded = false, useDsu = false;
    const t0 = Date.now();
    // Switch : sans prod.keys ni firmware, l'émulateur s'ouvrirait sur une erreur → on demande d'abord
    if (setup && SWITCH_EMUS.includes(setup.emulator)) {
      const need = switchNeeds(setup);
      if (need.keys || need.firmware) return { ok: false, needSwitch: { ...need, emulator: KNOWN_EMULATORS[setup.emulator]?.name || setup.emulator }, error: need.keys ? 'Clés Switch (prod.keys) manquantes.' : 'Firmware Switch manquant.' };
      swDir = need.dir;
      if (setup.emulator !== 'lichii') {
        const inp = settings().input || {}, guid = inp.guid || '';
        const keyboard = (extOpts(id)['Arcadia/control'] || (inp.type === 'keyboard' ? 'keyboard' : 'pad')) === 'keyboard';
        // manette + clavier en même temps : Arcadia sert les deux au moteur comme une seule manette (compagnon natif)
        useDsu = helper.available && helper.dsuReady === true;
        try { const r = SwitchCfg.prepare(need.dir, { guid, mapping: padDbFor(guid), opts: { ...Langs.switchOpts(gameLang(g)), ...extOpts(id) }, keyboard, dsu: useDsu }); log?.write('INFO', `moteur Switch prêt (manette ${r.pad || 'pas encore détectée : clavier pour cette fois'})`); } catch (e) { log?.write('INFO', `réglages Switch : ${e.message}`); }
      }

    }
    // émulateurs externes : copie « Arcadia » de l'exécutable (icône + nom Arcadia dans la barre des tâches,
    // le mélangeur de volume, le gestionnaire des tâches). L'original n'est jamais modifié ; certains
    // émulateurs nomment leur configuration d'après l'exe (Xenia) ou ont leur propre interface (Lichii) : exclus.
    const brandOff = (o => (typeof o === 'object' && o) || {})(settings().brandOff);
    if (setup && !setup.runner && setup.exe && !['xenia', 'lichii', 'retroarch'].includes(setup.emulator) && !brandOff[setup.emulator] && settings().brandOff !== true) {
      const cons = (CONSOLES.find(c => c.id === g.console) || {}).name || g.console;
      const tag = setup.emulator === 'edencli' || setup.emulator === 'eden' ? 'Switch' : String(g.console).replace(/[^\w ]/g, '');
      const b = Brand.brandedExe(setup.exe, `Arcadia ${tag}.exe`, ARCADIA_ICO(), { description: `Arcadia · ${cons}` });
      if (b !== setup.exe) { setup.exe = b; branded = true; } else if (process.platform === 'win32') log?.write('INFO', `copie Arcadia impossible pour ${setup.emulator} : exécutable d'origine utilisé`);
    }
    const title = decorate(g).title;
    // moteurs externes : comme le moteur intégré, on propose de reprendre (sauvegarde actuelle ou une copie)
    if (setup && !setup.runner && !opts.skipResume && settings().resumePrompt !== false) {
      let items = [];
      try { items = Saves.list(gameSavesDir(g)); } catch { /* aucune copie */ }
      if (items.length) return { ok: false, resumePick: { items: items.slice(0, 9).map((b, i) => ({ i, file: b.file, iso: b.iso, machine: b.machine, thumb: thumbUrl(b.thumb, 420) })) } };
    }
    let pad = null;
    const onExit = (seconds, error, code) => {
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
      win?.webContents.send('game:exited', { id, seconds, stats: store.get('stats'), backup });
    };
    const langOpts = setup?.runner ? Langs.runnerOpts(g.console, gameLang(g)).flatMap(o => ['--opt', o]) : [];
    const pid = setup?.runner ? launchRunner(setup, g, title, onExit, [...langOpts, ...(opts.runnerArgs || [])]) : launch(setup, g.path, onExit, padEnv());
    running.set(id, pid);
    if (setup?.runner && helper.available) helper.adopt(pid, '', ARCADIA_ICO(), AUMID);
    if (!setup?.runner) { // le moteur intégré a son propre menu ; pour les autres, menu Arcadia par-dessus
      attachOverlay(id, pid, g, title, setup, { userDir: swDir, dsu: useDsu });
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
  const fresh = d => d && d.v === 3 && (d.shots || []).every(exists) && (!d.banner || exists(d.banner))
    && (d.info || Date.now() - (d.infoTried || 0) < 6 * 3600e3)           // fiche absente : on retente au bout de 6 h
    && (d.bannerKind === 'hero' || !key || Date.now() - (d.heroTried || 0) < 864e5);
  if (!force && fresh(m.details)) return m.details;
  const prev = m.details && m.details.v === 3 ? m.details : null;
  const det = { v: 3, desc: null, publisher: null, release: null, shots: [], banner: null, bannerKind: null, info: prev?.info || null, infoTried: prev?.infoTried || 0, heroTried: prev?.heroTried || 0 };
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
  if (!det.info && (force || Date.now() - det.infoTried > 6 * 3600e3)) {
    det.infoTried = Date.now();
    try { det.info = await GameInfo.wikiInfo(title, g.console, { fetch: net.fetch.bind(net) }); if (!det.info) log?.write('INFO', `fiche ${title} : aucun jeu correspondant sur Wikidata`); }
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

// ---------------------------------------------------------------- IPC : 1.5
ipcMain.handle('app:log', (_e, level, msg) => log?.write(level, String(msg).slice(0, 4000)));
ipcMain.handle('app:openLog', () => shell.openPath(log.file));
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
  if (!exe && store.get('emulatorsDir')) exe = detectEmulators(store.get('emulatorsDir'))[id] || null;
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
        maximum: { melonds_opengl_renderer: 'enabled', melonds_opengl_resolution: '4x native (1024x768)' } }
};
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
