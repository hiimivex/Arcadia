// Code d'invitation d'un salon privé : IP publique + IP locale + port + mot de passe, en un code court
// à envoyer à ses amis (ex. « MK-7Q2KD-H8W3N-0XF4P-AZ9C1 »). Aucun serveur : le code suffit pour se connecter.
const crypto = require('crypto');
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base 32 de Crockford (sans I, L, O, U)

const ip4 = s => { const p = String(s || '').split('.').map(Number); return p.length === 4 && p.every(n => n >= 0 && n <= 255) ? p : null; };

function b32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += ALPHA[(val << (5 - bits)) & 31];
  return out;
}
function unb32(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of s) { const i = ALPHA.indexOf(ch); if (i < 0) return null; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

// 4 (IP publique) + 4 (IP locale) + 2 (port) + 4 (mot de passe) + 1 (contrôle) = 15 octets → 24 caractères
function encode({ publicIp, lanIp, port, password }) {
  const pub = ip4(publicIp) || [0, 0, 0, 0], lan = ip4(lanIp) || [0, 0, 0, 0];
  const pw = Buffer.from(password, 'hex');
  const buf = Buffer.from([...pub, ...lan, (port >> 8) & 255, port & 255, ...pw.subarray(0, 4)]);
  const sum = buf.reduce((a, b) => (a + b) & 255, 0) ^ 0x5a;
  const s = b32(Buffer.concat([buf, Buffer.from([sum])]));
  return 'MK-' + s.match(/.{1,6}/g).join('-');
}
function decode(code) {
  const s = String(code || '').toUpperCase().replace(/^MK-?/, '').replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const buf = unb32(s);
  if (!buf || buf.length < 15) return null;
  const data = buf.subarray(0, 14), sum = data.reduce((a, b) => (a + b) & 255, 0) ^ 0x5a;
  if (sum !== buf[14]) return null;
  const pub = [...data.subarray(0, 4)].join('.'), lan = [...data.subarray(4, 8)].join('.');
  return { publicIp: pub === '0.0.0.0' ? null : pub, lanIp: lan === '0.0.0.0' ? null : lan, port: (data[8] << 8) | data[9], password: data.subarray(10, 14).toString('hex') };
}
const newPassword = () => crypto.randomBytes(4).toString('hex');

module.exports = { encode, decode, newPassword };
