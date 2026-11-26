// Jaquettes Switch en ligne, sans clés : base libre blawar/titledb (GitHub), images du CDN eShop.
// Le fichier complet (~90 Mo) est téléchargé une fois par mois puis réduit à un petit index local.
const fs = require('fs');
const path = require('path');

const SRC = 'https://raw.githubusercontent.com/blawar/titledb/master/FR.fr.json';

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ').toLowerCase()
  .replace(/\b(nsp|xci|nsz|xcz|update|dlc|v\d+)\b/g, ' ').replace(/&|\band\b/g, ' ').replace(/[^a-z0-9]+/g, '');

// "Mario Golf Super Rush [0100C9C00E25C000][v0].nsp" -> "0100C9C00E25C000"
function titleIdFrom(name) {
  const m = X;
  if (!m) return null;
  const id = m[1].toUpperCase();
  return id.slice(0, 13) + '000'; // mise à jour (…800) ou DLC -> jeu de base
}

// Téléchargement + analyse du gros fichier dans un thread à part : l'interface ne se fige pas.
const WORKER = `
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
(async () => {
  const res = await fetch(workerData.src, { headers: { 'User-Agent': 'Arcadia' } });
  if (!res.ok) throw new Error('titledb: HTTP ' + res.status);
  const full = JSON.parse(await res.text());
  const db = {}, det = {};
  for (const e of Object.values(full)) {
    if (!e || !e.id || !e.name || !/000$/.test(e.id)) continue;
    const id = e.id.toUpperCase();
    if (db[id] && db[id][1]) continue;
    db[id] = [e.name, e.iconUrl || null, e.bannerUrl || null];
    det[id] = { d: (e.description || '').slice(0, 1500), p: e.publisher || null, r: e.releaseDate || null, s: (e.screenshots || []).slice(0, 4) };
  }
  fs.writeFileSync(workerData.details, JSON.stringify(det));
  fs.writeFileSync(workerData.file, JSON.stringify(db));
  parentPort.postMessage('ok');
})().catch(e => parentPort.postMessage('ERR ' + e.message));
`;
function buildInWorker(file, details) {
  const { Worker } = require('worker_threads');
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { eval: true, workerData: { src: SRC, file, details } });
    w.once('message', m => (m === 'ok' ? resolve() : reject(new Error(m.slice(4)))));
    w.once('error', reject);
  });
}

class SwitchDb {
  constructor(dir) {
    this.file = path.join(dir, 'switch-titledb.json');
    this.detailsFile = path.join(dir, 'switch-details.json');
    fs.mkdirSync(dir, { recursive: true });
    this.db = null;
    this.loading = null;
  }

  async load() {
    if (this.db) return this.db;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        if (Date.now() - fs.statSync(this.file).mtimeMs < 30 * 864e5) return (this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch { /* pas encore en cache */ }
      await buildInWorker(this.file, this.detailsFile);
      return (this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')));
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  // Description, éditeur, date, captures (chargé à la demande)
  async details(id) {
    await this.load();
    if (!this.det) { try { this.det = JSON.parse(fs.readFileSync(this.detailsFile, 'utf8')); } catch { this.det = {}; } }
    return this.det[id] || null;
  }

  // -> { id, name, iconUrl, bannerUrl } | null
  async find({ titleId, titles }) {
    const db = await this.load();
    const hit = id => db[id] && { id, name: db[id][0], iconUrl: db[id][1], bannerUrl: db[id][2] };
    if (titleId && db[titleId]) return hit(titleId);
    const wanted = (titles || []).map(norm).filter(t => t.length >= 3);
    if (!wanted.length) return null;
    let best = null;
    for (const [id, [name, icon]] of Object.entries(db)) {
      if (!icon) continue;
      const n = norm(name);
      for (const w of wanted) {
        const score = n === w ? 0 : (n.startsWith(w) || w.startsWith(n)) ? 1 + Math.abs(n.length - w.length) : null;
        if (score !== null && (!best || score < best.score)) best = { id, score };
      }
    }
    return best && best.score < 12 ? hit(best.id) : null;
  }

  async download(url, dest) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Arcadia' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest + '.part', buf);
    fs.renameSync(dest + '.part', dest);
    return dest;
  }
}

module.exports = { SwitchDb, titleIdFrom, norm };
