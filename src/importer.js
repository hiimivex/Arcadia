// Glisser-déposer : détecte la console, extrait les archives, déplace dans Games/<CONSOLE>/.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { detectFile, detectFolder, companions, ARCHIVES, ROM_EXTS } = require('./detect');

const extOf = p => path.extname(p).slice(1).toLowerCase();

async function sizeOf(p) {
  const st = await fsp.stat(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of await fsp.readdir(p, { withFileTypes: true })) total += await sizeOf(path.join(p, e.name));
  return total;
}

async function uniqueDest(dest) {
  if (!fs.existsSync(dest)) return dest;
  const dir = path.dirname(dest), ext = path.extname(dest), base = path.basename(dest, ext);
  for (let i = 2; ; i++) {
    const c = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
}

// Déplacement : renommage instantané si même disque, sinon copie avec progression puis suppression.
async function move(src, dest, onBytes) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(src, dest);
    onBytes(await sizeOf(dest));
    return;
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
  }
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await fsp.mkdir(dest, { recursive: true });
    for (const e of await fsp.readdir(src)) await move(path.join(src, e), path.join(dest, e), onBytes);
    await fsp.rmdir(src);
    return;
  }
  await new Promise((resolve, reject) => {
    const r = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 });
    const w = fs.createWriteStream(dest);
    r.on('data', c => onBytes(c.length));
    r.on('error', reject); w.on('error', reject); w.on('finish', resolve);
    r.pipe(w);
  });
  await fsp.unlink(src);
}

function sevenZipPath() {
  const p = require('7zip-bin').path7za;
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

async function extract(archive, outDir, onPct) {
  await fsp.mkdir(outDir, { recursive: true });
  if (extOf(archive) === 'rar') {
    const { createExtractorFromFile } = require('node-unrar-js');
    const ex = await createExtractorFromFile({ filepath: archive, targetPath: outDir });
    const { files } = ex.extract();
    for (const _ of files) { /* extraction fichier par fichier */ }
    onPct(100);
    return;
  }
  await new Promise((resolve, reject) => {
    const p = spawn(sevenZipPath(), ['x', archive, '-o' + outDir, '-y', '-bsp1', '-bb0'], { windowsHide: true });
    p.stdout.on('data', d => { const m = String(d).match(/(\d+)%/g); if (m) onPct(parseInt(m[m.length - 1], 10)); });
    p.on('error', reject);
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`7-Zip a échoué (code ${code})`))));
  });
}

class Importer {
  // ask(fileName) -> Promise<consoleId|null> ; trash(path) -> Promise ; onProgress(state)
  // games : jeux déjà dans la bibliothèque [{ path, console, title, size }] ; onDuplicate({ name, existing }) -> { action: 'skip'|'copy'|'replace', name }
  constructor({ libraryDir, ask, trash, onProgress, games, onDuplicate }) {
    this.lib = libraryDir; this.ask = ask; this.trash = trash; this.onProgress = onProgress;
    this.games = games || []; this.onDuplicate = onDuplicate;
    this.results = [];
  }

  // Même fichier (taille + début + fin identiques) ou même jeu (titre) déjà présent sur cette console ?
  async findDuplicate(src, consoleId) {
    let size; try { size = (await fsp.stat(src)).size; } catch { return null; }
    const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const srcAbs = path.resolve(src).toLowerCase();
    const others = this.games.filter(g => path.resolve(g.path).toLowerCase() !== srcAbs);
    const fp = async p => {
      const fd = await fsp.open(p, 'r');
      try {
        const st = await fd.stat(); const h = crypto.createHash('sha1'); const b = Buffer.alloc(Math.min(1 << 20, st.size));
        await fd.read(b, 0, b.length, 0); h.update(b);
        await fd.read(b, 0, b.length, Math.max(0, st.size - b.length)); h.update(b);
        return h.digest('hex');
      } finally { await fd.close(); }
    };
    let mine = null;
    for (const g of others.filter(g => g.size === size)) {
      try { mine ||= await fp(src); if (await fp(g.path) === mine) return { game: g, same: true }; } catch { /* illisible */ }
    }
    const t = norm(path.basename(src, path.extname(src)));
    const byTitle = t.length >= 4 && others.find(g => g.console === consoleId && (norm(g.title) === t || norm(path.basename(g.path, path.extname(g.path))) === t));
    return byTitle ? { game: byTitle, same: false } : null;
  }

  // Transforme les chemins déposés en tâches.
  async plan(paths, depth = 0) {
    const jobs = [], taken = new Set();
    for (const p of paths) {
      let st;
      try { st = await fsp.stat(p); } catch { this.results.push({ src: p, ok: false, error: 'introuvable' }); continue; }
      if (st.isDirectory()) {
        const c = detectFolder(p);
        if (c) { jobs.push({ kind: 'folder', src: p, console: c }); continue; }
        if (depth < 3) {
          const inner = (await fsp.readdir(p)).map(e => path.join(p, e));
          jobs.push(...await this.plan(inner, depth + 1));
        }
        continue;
      }
      const ext = extOf(p);
      // fichiers système (installés à part par Arcadia) : jamais rangés comme des jeux
      if (/^(prod|title)\.keys$|\.(nca|pup)$|^(scph[^\\/]*|ps1_rom|dc_boot|mcpx[^\\/]*)\.bin$/i.test(path.basename(p))) continue;
      if (ARCHIVES.has(ext)) { jobs.push({ kind: 'archive', src: p }); continue; }
      if (!ROM_EXTS.has(ext)) { if (depth === 0) this.results.push({ src: p, ok: false, unknown: true, error: 'pas un fichier ROM reconnu' }); continue; }
      jobs.push({ kind: 'file', src: p, extra: companions(p) });
    }
    // Les pistes d'un .cue / .gdi / .m3u voyagent avec lui, pas toutes seules.
    for (const j of jobs) (j.extra || []).forEach(e => taken.add(path.resolve(e).toLowerCase()));
    return jobs.filter(j => !(j.kind === 'file' && taken.has(path.resolve(j.src).toLowerCase())));
  }

  async run(paths) {
    const jobs = await this.plan(paths);
    let total = 0;
    for (const j of jobs) {
      j.size = (await sizeOf(j.src)) + (j.extra ? (await Promise.all(j.extra.map(sizeOf))).reduce((a, b) => a + b, 0) : 0);
      total += j.size;
    }
    this.state = { count: jobs.length, index: 0, bytesDone: 0, bytesTotal: total, current: '', phase: 'move' };
    for (const j of jobs) {
      this.state.index++;
      this.state.current = path.basename(j.src);
      this.emit();
      try {
        if (j.kind === 'archive') await this.doArchive(j);
        else await this.doMove(j);
      } catch (e) {
        this.results.push({ src: j.src, ok: false, error: e.message });
      }
    }
    this.state.phase = 'done';
    this.emit();
    return this.results;
  }

  emit() { this.onProgress && this.onProgress({ ...this.state }); }

  async doMove(j) {
    const consoleId = j.console || detectFile(j.src) || await this.ask(path.basename(j.src));
    if (!consoleId) { this.results.push({ src: j.src, ok: false, error: 'console non choisie' }); this.state.bytesDone += j.size; return; }
    const consoleDir = path.join(this.lib, consoleId);
    if (path.resolve(path.dirname(j.src)).toLowerCase() === path.resolve(consoleDir).toLowerCase()) {
      this.results.push({ src: j.src, ok: true, console: consoleId, dest: j.src, already: true });
      this.state.bytesDone += j.size; this.emit(); return;
    }
    const onBytes = j.noCount ? () => {} : n => { this.state.bytesDone += n; this.emitThrottled(); };
    // Jeu déjà dans la bibliothèque ?
    const dup = this.onDuplicate && !(j.extra && j.extra.length) ? await this.findDuplicate(j.src, consoleId) : null;
    if (dup) {
      const ans = await this.onDuplicate({ name: path.basename(j.src), existing: dup.game, same: dup.same });
      if (!ans || ans.action === 'skip') { this.results.push({ src: j.src, ok: true, console: consoleId, skipped: true, already: true }); this.state.bytesDone += j.size; this.emit(); return; }
      if (ans.action === 'replace') {
        await this.trash(dup.game.path); // l'ancienne part dans la corbeille Windows
        const dest = await uniqueDest(path.join(path.dirname(dup.game.path), path.basename(j.src)));
        await move(j.src, dest, onBytes);
        this.results.push({ src: j.src, ok: true, console: consoleId, dest, replaced: true });
        return;
      }
      // copie sous un autre nom (le fichier d'origine reste où il est)
      const base = (ans.name || '').trim().replace(/[<>:"/\\|?*]+/g, ' ') || path.basename(j.src, path.extname(j.src)) + ' (copie)';
      const dest = await uniqueDest(path.join(consoleDir, base + path.extname(j.src)));
      await fsp.mkdir(consoleDir, { recursive: true });
      await fsp.copyFile(j.src, dest);
      this.state.bytesDone += j.size; this.emit();
      this.results.push({ src: j.src, ok: true, console: consoleId, dest, copied: true });
      return;
    }
    let dest;
    if (j.extra && j.extra.length) {
      // jeu multi-fichiers (.cue + .bin…) : un sous-dossier à son nom
      const folder = await uniqueDest(path.join(consoleDir, path.basename(j.src, path.extname(j.src))));
      dest = path.join(folder, path.basename(j.src));
      await move(j.src, dest, onBytes);
      for (const e of j.extra) if (fs.existsSync(e)) await move(e, path.join(folder, path.basename(e)), onBytes);
    } else {
      dest = await uniqueDest(path.join(consoleDir, path.basename(j.src)));
      await move(j.src, dest, onBytes);
    }
    this.results.push({ src: j.src, ok: true, console: consoleId, dest });
  }

  async doArchive(j) {
    const tmp = path.join(this.lib, '_import', crypto.randomBytes(4).toString('hex'));
    this.state.phase = 'extract'; this.emit();
    const base = this.state.bytesDone;
    try {
      await extract(j.src, tmp, pct => { this.state.bytesDone = base + j.size * pct / 100; this.emitThrottled(); });
    } catch (e) {
      await fsp.rm(tmp, { recursive: true, force: true });
      try { await fsp.rmdir(path.dirname(tmp)); } catch { /* */ }
      throw e;
    }
    this.state.bytesDone = base + j.size;
    this.state.phase = 'move';
    const inner = await this.plan((await fsp.readdir(tmp)).map(e => path.join(tmp, e)), 1);
    if (!inner.length) this.results.push({ src: j.src, ok: false, error: "aucune ROM dans l'archive" });
    const before = this.results.filter(r => r.ok).length;
    for (const x of inner) {
      if (x.kind === 'archive') await this.doArchive({ ...x, size: 0 });
      else await this.doMove({ ...x, size: 0, noCount: true });
    }
    await fsp.rm(tmp, { recursive: true, force: true });
    try { await fsp.rmdir(path.dirname(tmp)); } catch { /* _import pas vide */ }
    // L'archive d'origine part à la corbeille seulement si au moins une ROM a été rangée.
    if (this.results.filter(r => r.ok).length > before) await this.trash(j.src);
  }

  emitThrottled() {
    const now = Date.now();
    if (!this.last || now - this.last > 120) { this.last = now; this.emit(); }
  }
}

module.exports = { Importer, move, uniqueDest, extractArchive: extract };
