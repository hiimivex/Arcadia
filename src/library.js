const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONSOLES } = require('./consoles');

const COVER_EXT = ['png', 'jpg', 'jpeg', 'webp'];

// Crée un dossier par console dans la bibliothèque (+ un sous-dossier covers).
function createConsoleFolders(libraryDir) {
  const created = [];
  for (const c of CONSOLES) {
    const dir = path.join(libraryDir, c.id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(path.join(dir, 'covers'), { recursive: true });
      created.push(c.id);
    } else if (!fs.existsSync(path.join(dir, 'covers'))) {
      fs.mkdirSync(path.join(dir, 'covers'), { recursive: true });
    }
  }
  return created;
}

// "Mario Kart 8 Deluxe (Europe) [v1.2] [!]" -> "Mario Kart 8 Deluxe"
function cleanTitle(fileName) {
  let t = fileName.replace(/\.[^.]+$/, '');
  t = t.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
  t = t.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t || fileName;
}

function findCover(consoleDir, romPath) {
  const base = path.basename(romPath).replace(/\.[^.]+$/, '');
  const candidates = [path.join(consoleDir, 'covers'), path.dirname(romPath)];
  for (const dir of candidates) {
    for (const ext of COVER_EXT) {
      const p = path.join(dir, `${base}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

// Parcourt un dossier console. Un jeu dans un sous-dossier compte aussi
// (pratique pour les jeux PS1 en plusieurs fichiers : on prend le .m3u/.cue).
function scanConsole(libraryDir, consoleDef) {
  const consoleDir = path.join(libraryDir, consoleDef.id);
  const games = [];
  const exts = new Set(consoleDef.ext);
  const names = new Set((consoleDef.files || []).map(f => f.toLowerCase()));
  const maxDepth = names.size ? 4 : 2; // PS3 : Jeu/PS3_GAME/USRDIR/EBOOT.BIN
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    const lower = files.map(f => f.toLowerCase());
    // Si un .cue ou .m3u existe, on ignore les .bin/.img du même dossier.
    const hasPlaylist = lower.some(f => f.endsWith('.cue') || f.endsWith('.m3u'));
    for (const f of files) {
      const ext = f.split('.').pop().toLowerCase();
      const byName = names.has(f.toLowerCase());
      if (!byName && !exts.has(ext)) continue;
      if (hasPlaylist && (ext === 'bin' || ext === 'img')) continue;
      const full = path.join(dir, f);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      // Jeu en dossier : le titre est le premier dossier sous celui de la console.
      const gameFolder = path.relative(consoleDir, full).split(path.sep)[0];
      const folderTitle = byName && consoleDef.titleFromFolder && gameFolder !== f;
      games.push({
        // id stable = chemin relatif à la bibliothèque (survit à un changement de lettre de lecteur)
        id: gameId(libraryDir, full),
        title: folderTitle ? cleanTitle(gameFolder + '.x') : cleanTitle(f),
        file: f,
        path: full,
        console: consoleDef.id,
        size: stat.size,
        added: stat.birthtimeMs || stat.mtimeMs,
        mtime: stat.mtimeMs,
        cover: findCover(consoleDir, folderTitle ? path.join(consoleDir, gameFolder + '.x') : full)
      });
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name.toLowerCase() !== 'covers') walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(consoleDir, 0);
  return games;
}

function gameId(libraryDir, full) {
  const rel = path.relative(libraryDir, full).split(path.sep).join('/').toLowerCase();
  return crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);
}

function scanLibrary(libraryDir) {
  if (!libraryDir || !fs.existsSync(libraryDir)) return [];
  return CONSOLES.flatMap(c => scanConsole(libraryDir, c));
}

// Fichiers « en vrac » : ROM, archives ou dossiers de jeu qui ne sont PAS dans un dossier de console.
function findLoose(libraryDir) {
  if (!libraryDir || !fs.existsSync(libraryDir)) return [];
  const { detectFile, detectFolder, ARCHIVES, ROM_EXTS } = require('./detect');
  const consoleDirs = new Set(CONSOLES.map(c => c.id.toLowerCase()));
  const skip = new Set(['_import', 'covers', '$recycle.bin', 'system volume information']);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || out.length > 5000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const lower = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (depth === 0 && consoleDirs.has(lower)) continue;
        if (skip.has(lower) || lower.startsWith('.') || lower.startsWith('_')) continue; // _MISES A JOUR, _A CONVERTIR…
        const c = detectFolder(full);
        if (c) out.push({ path: full, name: e.name, console: c, folder: true });
        else walk(full, depth + 1);
        continue;
      }
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (ARCHIVES.has(ext)) out.push({ path: full, name: e.name, console: null, archive: true });
      else if (ROM_EXTS.has(ext)) {
        // les pistes .bin d'un .cue voisin ne comptent pas séparément
        if ((ext === 'bin' || ext === 'img') && entries.some(x => /\.(cue|gdi|m3u)$/i.test(x.name))) continue;
        let c = null;
        try { c = detectFile(full); } catch { /* */ }
        out.push({ path: full, name: e.name, console: c });
      }
    }
  };
  walk(libraryDir, 0);
  return out;
}

module.exports = { createConsoleFolders, cleanTitle, scanLibrary, scanConsole, gameId, findLoose };
