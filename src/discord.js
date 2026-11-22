// Discord Rich Presence (« Joue à … ») par le canal local de l'application Discord. Aucun compte requis côté Arcadia :
// il faut seulement l'« Application ID » d'une application créée sur discord.com/developers (gratuit).
const net = require('net');

class Discord {
  constructor() { this.sock = null; this.ready = false; this.clientId = null; this.pending = null; }

  connect(clientId) {
    if (!clientId || process.platform !== 'win32') return;
    if (this.sock && this.clientId === clientId) return;
    this.close();
    this.clientId = clientId;
    const tryPipe = i => {
      if (i > 9) return;
      const s = net.createConnection(`\\\\?\\pipe\\discord-ipc-${i}`);
      s.once('error', () => tryPipe(i + 1));
      s.once('connect', () => {
        s.removeAllListeners('error');
        s.on('error', () => this.close());
        s.on('close', () => { this.sock = null; this.ready = false; });
        s.on('data', d => { if (!this.ready && d.length >= 8 && d.readInt32LE(0) === 1) { this.ready = true; if (this.pending) this.send(this.pending); } });
        this.sock = s;
        this.frame(0, { v: 1, client_id: clientId });
      });
    };
    tryPipe(0);
  }

  frame(op, obj) {
    if (!this.sock) return;
    const body = Buffer.from(JSON.stringify(obj));
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0); head.writeInt32LE(body.length, 4);
    this.sock.write(Buffer.concat([head, body]));
  }

  send(activity) {
    this.pending = activity;
    if (!this.ready) return;
    this.frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) });
  }

  playing(title, consoleName) {
    this.send({ details: title, state: consoleName, timestamps: { start: Date.now() }, assets: { large_text: 'Arcadia' } });
  }
  idle() { if (this.ready) this.frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: String(Date.now()) }); this.pending = null; }
  close() { try { this.sock?.destroy(); } catch { /* */ } this.sock = null; this.ready = false; }
}

module.exports = { Discord };
