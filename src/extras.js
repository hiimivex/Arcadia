// 1.5 : journal d'erreurs, copies des réglages d'Arcadia, intégrité des ROM, captures d'écran, télécommande téléphone.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------- journal
class Log {
  constructor(dir) { this.file = path.join(dir, 'arcadia.log'); fs.mkdirSync(dir, { recursive: true }); }
  write(level, msg) {
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 1024 * 1024) fs.renameSync(this.file, this.file + '.1');
      fs.appendFileSync(this.file, `${new Date().toISOString()} [${level}] ${msg}\n`);
    } catch { /* tant pis */ }
  }
}

// ---------------------------------------------------------------- copies des réglages (1 par jour, 14 gardées)
function backupStore(storeFile, dir) {
  try {
    if (!fs.existsSync(storeFile)) return null;
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `arcadia-${day}.json`);
    fs.copyFileSync(storeFile, dest);
    const all = fs.readdirSync(dir).filter(n => /^arcadia-\d{4}-\d\d-\d\d\.json$/.test(n)).sort().reverse();
    for (const old of all.slice(14)) fs.unlinkSync(path.join(dir, old));
    return dest;
  } catch { return null; }
}
function listStoreBackups(dir) {
  try { return fs.readdirSync(dir).filter(n => /^arcadia-\d{4}-\d\d-\d\d\.json$/.test(n)).sort().reverse().map(n => ({ file: path.join(dir, n), day: n.slice(8, 18) })); } catch { return []; }
}

// ---------------------------------------------------------------- intégrité : fichier vide / écrasé ?
// 32 échantillons de 64 Ko répartis dans le fichier : s'ils sont tous à zéro, la ROM est vide (récupération ratée, copie interrompue…)
function looksEmpty(file) {
  try {
    const size = fs.statSync(file).size;
    if (size < 64 * 1024) return false;
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(65536);
    let empty = true;
    for (let i = 0; i < 32 && empty; i++) {
      const n = fs.readSync(fd, b, 0, b.length, Math.floor((size - b.length) * i / 31));
      for (let k = 0; k < n; k++) if (b[k] !== 0) { empty = false; break; }
    }
    fs.closeSync(fd);
    return empty;
  } catch { return false; }
}

// ---------------------------------------------------------------- captures d'écran des émulateurs
const SHOT_DIRS = {
  eden: c => [path.join(c.exeDir, 'user', 'screenshots'), path.join(c.appData, 'eden', 'screenshots')],
  lichii: c => [path.join(c.exeDir, 'user', 'screenshots'), path.join(c.appData, 'lichii', 'screenshots')],
  edencli: c => [path.join(c.exeDir, 'user', 'screenshots'), path.join(c.appData, 'eden', 'screenshots')],
  azahar: c => [path.join(c.exeDir, 'user', 'screenshots'), path.join(c.appData, 'Azahar', 'screenshots')],
  ppsspp: c => [path.join(c.exeDir, 'memstick', 'PSP', 'SCREENSHOT'), path.join(c.documents, 'PPSSPP', 'PSP', 'SCREENSHOT')],
  pcsx2: c => [path.join(c.exeDir, 'snaps'), path.join(c.documents, 'PCSX2', 'snaps')],
  duckstation: c => [path.join(c.exeDir, 'screenshots'), path.join(c.documents, 'DuckStation', 'screenshots'), path.join(c.localAppData, 'DuckStation', 'screenshots')],
  dolphin: c => [path.join(c.exeDir, 'User', 'ScreenShots'), path.join(c.documents, 'Dolphin Emulator', 'ScreenShots'), path.join(c.appData, 'Dolphin Emulator', 'ScreenShots')],
  rpcs3: c => [path.join(c.exeDir, 'screenshots')],
  cemu: c => [path.join(c.exeDir, 'screenshots'), path.join(c.exeDir, 'portable', 'screenshots')],
  mesen: c => [path.join(c.exeDir, 'Screenshots'), path.join(c.documents, 'Mesen2', 'Screenshots')],
  ares: c => [path.join(c.exeDir, 'Screenshots')],
  xemu: c => [path.join(c.exeDir, 'screenshots')],
  flycast: c => [path.join(c.exeDir, 'data')],
  vita3k: c => [path.join(c.exeDir, 'screenshots')],
  arcadia: c => [c.shots].filter(Boolean)
};
const IMG = /\.(png|jpe?g|bmp|webp)$/i;
// Captures prises PENDANT les sessions de ce jeu (± 1 min)
function sessionShots(emuId, ctx, romPath, sessions) {
  const dirs = [...(SHOT_DIRS[emuId] ? SHOT_DIRS[emuId](ctx) : []), romPath && path.dirname(romPath)].filter(d => d && fs.existsSync(d));
  const out = [];
  const walk = (d, depth) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      if (!IMG.test(e.name)) continue;
      const t = fs.statSync(p).mtimeMs;
      if (sessions.some(s => t >= s.start - 60000 && t <= s.end + 60000)) out.push({ path: p, mtime: t });
    }
  };
  for (const d of new Set(dirs)) walk(d, 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 48);
}

// ---------------------------------------------------------------- télécommande (téléphone, même Wi-Fi)
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
class Remote {
  constructor({ getGames, coverOf, launch, port = 7788 }) {
    Object.assign(this, { getGames, coverOf, launch, port });
    this.token = crypto.randomBytes(9).toString('base64url');
    this.server = null;
  }
  urls() { return lanAddresses().map(ip => `http://${ip}:${this.port}/?t=${this.token}`); }
  start() {
    if (this.server) return Promise.resolve(this.urls());
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.once('error', e => { this.server = null; reject(e); });
      this.server.listen(this.port, '0.0.0.0', () => resolve(this.urls()));
    });
  }
  stop() { try { this.server?.close(); } catch { /* */ } this.server = null; }
  handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (u.searchParams.get('t') !== this.token) { res.writeHead(403); res.end('Accès refusé'); return; }
    if (u.pathname.startsWith('/cover/')) {
      const f = this.coverOf(decodeURIComponent(u.pathname.slice(7)));
      if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': /\.png$/i.test(f) ? 'image/png' : 'image/jpeg', 'Cache-Control': 'max-age=3600' });
      fs.createReadStream(f).pipe(res); return;
    }
    if (u.pathname.startsWith('/play/') && req.method === 'POST') {
      const r = this.launch(decodeURIComponent(u.pathname.slice(6)));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); return;
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const t = encodeURIComponent(this.token);
    const cards = this.getGames().map(g => `<button class="c" onclick="play('${esc(g.id)}',this)">${g.cover ? `<img loading="lazy" src="/cover/${encodeURIComponent(g.id)}?t=${t}">` : `<div class="ph">${esc(g.title.slice(0, 2))}</div>`}<b>${esc(g.title)}</b><i>${esc(g.console)}</i></button>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arcadia</title>
<style>body{margin:0;background:#050505;color:#fff;font:15px system-ui;padding:16px}h1{letter-spacing:6px;font-size:20px;text-shadow:0 0 20px #fff8}
input{width:100%;box-sizing:border-box;padding:12px 16px;border-radius:999px;border:1px solid #333;background:#111;color:#fff;font-size:15px;margin-bottom:14px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}.c{background:#111;border:1px solid #222;border-radius:16px;padding:8px;color:#fff;text-align:left;font:inherit}
.c img,.ph{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:#1a1a1a;display:grid;place-items:center;font-size:30px;font-weight:800}
.c b{display:block;margin-top:6px;font-size:13px}.c i{font-style:normal;font-size:11px;opacity:.6}.c.on{border-color:#fff;box-shadow:0 0 22px #fff6}</style>
<h1>ARCADIA</h1><input placeholder="Rechercher" oninput="for(const c of document.querySelectorAll('.c'))c.style.display=c.textContent.toLowerCase().includes(this.value.toLowerCase())?'':'none'">
<div class="g">${cards}</div>
<script>async function play(id,b){b.classList.add('on');const r=await (await fetch('/play/'+encodeURIComponent(id)+'?t=${t}',{method:'POST'})).json();if(!r.ok)alert(r.error);setTimeout(()=>b.classList.remove('on'),1500)}</script></html>`);
  }
}

module.exports = { Log, backupStore, listStoreBackups, looksEmpty, sessionShots, Remote, lanAddresses };
