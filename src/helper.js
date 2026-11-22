// Pilote d'arcadia-helper.exe (Windows) : pause/reprise, premier plan, fenêtre aux couleurs d'Arcadia,
// manette (Guide, Back+Start, navigation) et Échap seulement quand le jeu est au premier plan.
const { spawn } = require('child_process');
const fs = require('fs');

class Helper {
  constructor(exe, log) { this.exe = exe; this.log = log; this.p = null; this.handlers = new Set(); this.waiting = []; }
  get available() { return process.platform === 'win32' && !!this.exe && fs.existsSync(this.exe); }
  start() {
    if (this.p || !this.available) return !!this.p;
    try {
      this.p = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (e) { this.log?.(`compagnon : ${e.message}`); this.p = null; return false; }
    let buf = '';
    this.p.stdout.on('data', d => {
      buf += d.toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'DSU READY') { this.dsuReady = true; continue; }
        if (line === 'DSU BUSY') { this.dsuReady = false; this.log?.('manette réseau : le port 26760 est déjà pris (DS4Windows ?) : manette seule pour la Switch'); continue; }
        if (line.startsWith('OK ')) { const cmd = line.slice(3).split(' ')[0]; const w = this.waiting.findIndex(x => x.cmd === cmd); if (w >= 0) this.waiting.splice(w, 1)[0].res(line); continue; }
        for (const h of this.handlers) { try { h(line); } catch { /* */ } }
      }
    });
    this.p.on('exit', () => { this.p = null; for (const w of this.waiting.splice(0)) w.res(null); });
    this.p.on('error', e => { this.log?.(`compagnon : ${e.message}`); this.p = null; });
    return true;
  }
  send(line, cmd, timeout = 1500) {
    if (!this.start()) return Promise.resolve(null);
    return new Promise(res => {
      if (cmd) { this.waiting.push({ cmd, res }); setTimeout(() => { const i = this.waiting.findIndex(x => x.res === res); if (i >= 0) { this.waiting.splice(i, 1); res(null); } }, timeout); }
      try { this.p.stdin.write(line.replace(/[\r\n]/g, ' ') + '\n'); } catch { res(null); }
      if (!cmd) res(true);
    });
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  suspend(pid) { return this.send(`suspend ${Number(pid)}`, 'suspend'); }
  resume(pid) { return this.send(`resume ${Number(pid)}`, 'resume'); }
  focus(pid) { return this.send(`front ${Number(pid)}`, 'front'); }
  dsu(on, padDb, prefer) { if (padDb) this.send(`pads ${padDb}`, 'pads'); this.send(`prefer ${prefer || ''}`, 'prefer'); return this.send(`dsu ${on ? 'on' : 'off'}`, 'dsu'); }
  watch(pid) { return this.send(`watch ${Number(pid) || 0}`, 'watch'); }
  adopt(pid, title, icon, aumid) { return this.send(`adopt ${Number(pid)}\t${String(title || '').replace(/\t/g, ' ')}\t${icon || ''}\t${aumid || ''}`); }
  stop() { try { this.p?.stdin.write('quit\n'); } catch { /* */ } }
}
module.exports = { Helper };
