// Construit une NSP et une XCI synthétiques (chiffrées avec des clés de test) puis vérifie
// que switchmeta en ressort le titre français et l'icône.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { switchInfo, switchIdNoKeys, parseKeys, LANGS } = require('../src/switchmeta');
const { titleIdFrom } = require('../src/switchdb');

const rnd = n => crypto.randomBytes(n);
const K = { header_key: rnd(32), key_area_key_application_04: rnd(16), titlekek_04: rnd(16) };
const keysText = Object.entries(K).map(([k, v]) => `${k} = ${v.toString('hex')}`).join('\n');
const keys = { prod: parseKeys(keysText), title: {} };
const align = (n, a) => Math.ceil(n / a) * a;

function enc(alg, key, iv, data) { const c = crypto.createCipheriv(alg, key, iv); c.setAutoPadding(false); return Buffer.concat([c.update(data), c.final()]); }
// XTS maison (le Node d'Electron n'a pas aes-128-xts) : même code que l'application
const { xtsCrypt } = require('../src/switchmeta');
function xts(key, data) {
  const out = Buffer.alloc(data.length);
  for (let s = 0; s * 0x200 < data.length; s++) {
    const t = Buffer.alloc(16); t.writeBigUInt64BE(BigInt(s), 8);
    xtsCrypt(true, key, data.subarray(s * 0x200, (s + 1) * 0x200), s).copy(out, s * 0x200);
  }
  return out;
}

function romfs(files) {
  const names = Object.keys(files);
  let meta = Buffer.alloc(0), data = Buffer.alloc(0);
  for (const n of names) {
    const nb = Buffer.from(n);
    const e = Buffer.alloc(0x20 + align(nb.length, 4));
    e.writeBigUInt64LE(BigInt(data.length), 8); e.writeBigUInt64LE(BigInt(files[n].length), 0x10);
    e.writeUInt32LE(nb.length, 0x1C); nb.copy(e, 0x20);
    meta = Buffer.concat([meta, e]);
    data = Buffer.concat([data, files[n], Buffer.alloc(align(files[n].length, 16) - files[n].length)]);
  }
  const h = Buffer.alloc(0x50);
  h.writeBigUInt64LE(0x50n, 0);
  h.writeBigUInt64LE(0x50n, 0x38); h.writeBigUInt64LE(BigInt(meta.length), 0x40);
  const dataOff = align(0x50 + meta.length, 16);
  h.writeBigUInt64LE(BigInt(dataOff), 0x48);
  return Buffer.concat([h, meta, Buffer.alloc(dataOff - 0x50 - meta.length), data]);
}

// NCA de type Control. withRights = jeu eShop (clé de titre dans le ticket).
function controlNca(titleId, nacp, icon, withRights) {
  const rf = romfs({ 'control.nacp': nacp, 'icon_French.dat': icon });
  const ivfcData = 0x200; // les niveaux de hash ne sont pas lus : données à 0x200 dans la section
  const section = Buffer.concat([Buffer.alloc(ivfcData), rf]);
  const secLen = align(section.length, 0x200);
  const secStart = 0xC00;
  const hdr = Buffer.alloc(0xC00);
  hdr.write('NCA3', 0x200, 'ascii'); hdr[0x205] = 2; hdr[0x206] = 2; hdr[0x220] = 5; // génération 5 -> clés _04
  hdr.writeBigUInt64LE(BigInt('0x' + titleId), 0x210);
  hdr.writeUInt32LE(secStart / 0x200, 0x240); hdr.writeUInt32LE((secStart + secLen) / 0x200, 0x244);
  const ctrKey = rnd(16);
  const rid = Buffer.alloc(16); Buffer.from(titleId, 'hex').copy(rid, 0); rid[15] = 5;
  let ticket = null;
  if (withRights) {
    rid.copy(hdr, 0x230);
    ticket = Buffer.alloc(0x2C0);
    enc('aes-128-ecb', K.titlekek_04, null, ctrKey).copy(ticket, 0x180);
    rid.copy(ticket, 0x2A0);
  } else {
    const area = Buffer.concat([rnd(32), ctrKey, rnd(16)]);
    enc('aes-128-ecb', K.key_area_key_application_04, null, area).copy(hdr, 0x300);
  }
  const fsh = hdr.subarray(0x400, 0x600);
  fsh[2] = 0; fsh[3] = 3; fsh[4] = 3; fsh.write('IVFC', 8, 'ascii');
  fsh.writeBigUInt64LE(BigInt(ivfcData), 0x8 + 0x10 + 5 * 0x18);
  const gen = rnd(8); gen.copy(fsh, 0x140);
  const iv = Buffer.alloc(16); Buffer.from(gen).reverse().copy(iv, 0); iv.writeBigUInt64BE(BigInt(secStart) >> 4n, 8);
  const body = enc('aes-128-ctr', ctrKey, iv, Buffer.concat([section, Buffer.alloc(secLen - section.length)]));
  return { nca: Buffer.concat([xts(K.header_key, hdr), body]), ticket };
}

function partition(kind, files) {
  const names = Object.keys(files);
  const esz = kind === 'PFS0' ? 0x18 : 0x40;
  const strs = Buffer.from(names.map(n => n + '\0').join(''));
  const h = Buffer.alloc(0x10 + names.length * esz);
  h.write(kind, 0, 'ascii'); h.writeUInt32LE(names.length, 4); h.writeUInt32LE(strs.length, 8);
  let off = 0, nOff = 0;
  names.forEach((n, i) => {
    const e = 0x10 + i * esz;
    h.writeBigUInt64LE(BigInt(off), e); h.writeBigUInt64LE(BigInt(files[n].length), e + 8); h.writeUInt32LE(nOff, e + 0x10);
    off += files[n].length; nOff += Buffer.byteLength(n) + 1;
  });
  return Buffer.concat([h, strs, ...names.map(n => files[n])]);
}

const nacp = Buffer.alloc(0x4000);
nacp.write('Mario Golf: Super Rush', 0 * 0x300);
nacp.write('Mario Golf : Super Rush (FR)', LANGS.indexOf('French') * 0x300);
const icon = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), rnd(5000)]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadia-sw-'));

// NSP eShop : clé dans le ticket
{
  const { nca, ticket } = controlNca('0100C9C00E25C000', nacp, icon, true);
  const f = path.join(tmp, 'game.nsp');
  fs.writeFileSync(f, partition('PFS0', { 'abc.cnmt.nca': rnd(0x200), 'aaa.nca': rnd(0xC00), 'ctl.nca': nca, 'x.tik': ticket }));
  const r = switchInfo(f, keys);
  assert.strictEqual(r.title, 'Mario Golf : Super Rush (FR)');
  assert.strictEqual(r.titleId, '0100C9C00E25C000');
  assert.ok(r.icon.equals(icon), 'icône NSP');
  // sans ticket ni title.keys -> on sait juste qu'il manque la clé
  fs.writeFileSync(f, partition('PFS0', { 'ctl.nca': nca }));
  assert.deepStrictEqual(switchInfo(f, keys), { titleId: '0100C9C00E25C000', needKeys: 'titlekey' });
}

// XCI : key area, partition secure
{
  const { nca } = controlNca('0100152000022000', nacp, icon, false);
  const secure = partition('HFS0', { 'ctl.nca': nca });
  const root = partition('HFS0', { update: partition('HFS0', {}), secure });
  const head = Buffer.alloc(0x200); head.write('HEAD', 0x100, 'ascii'); head.writeBigUInt64LE(0x200n, 0x130);
  const f = path.join(tmp, 'game.xci');
  fs.writeFileSync(f, Buffer.concat([head, root]));
  const r = switchInfo(f, keys);
  assert.strictEqual(r.titleId, '0100152000022000');
  assert.ok(r.icon.equals(icon), 'icône XCI');
}

assert.strictEqual(switchInfo(path.join(tmp, 'game.xci'), null), null);
assert.strictEqual(titleIdFrom('Mario Golf Super Rush [0100C9C00E25C000][v0](site).nsp'), '0100C9C00E25C000');
assert.strictEqual(titleIdFrom('Update [0100C9C00E25C800][v65536].nsp'), '0100C9C00E25C000');
assert.strictEqual(titleIdFrom('Animal Crossing New Horizons.xci'), null);
{
  const f = path.join(tmp, 'xml.nsp');
  fs.writeFileSync(f, partition('PFS0', { 'a.cnmt.xml': Buffer.from('<ContentMeta><Type>Application</Type><Id>0x0100f43008c44000</Id></ContentMeta>'), 'b.nca': rnd(64) }));
  assert.deepStrictEqual(switchIdNoKeys(f), { titleId: '0100F43008C44000', patch: false });
  fs.writeFileSync(f, partition('PFS0', { '0100fd8022daa8000000000000000012.tik': rnd(0x2C0) }));
  assert.deepStrictEqual(switchIdNoKeys(f), { titleId: '0100FD8022DAA000', patch: true });
}
console.log('switch: OK');

// manette choisie dans Arcadia : utilisée quand le moteur n'a pas encore de journal
{
  const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
  const SC = require('../src/switchcfg');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const r = SC.prepare(d, { guid: '030000005e0400008e02000000007801' });
  assert.strictEqual(r.pad, '030000005e0400008e02000000007801');
  const t = fs.readFileSync(path.join(d, 'config', 'sdl2-config.ini'), 'utf8');
  assert(t.includes('guid:030000005e0400008e02000000007801'));
  assert.strictEqual(SC.edenGuid('0300fa675e0400008e02000001067801'), '030000005e0400008e02000001067801');
  assert(SC.xboxMapping('0300fa675e0400008e02000001067801').player_0_button_a.includes('guid:030000005e0400008e02000001067801,'));
  const r2 = SC.prepare(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), {});
  assert(!r2.pad);
  console.log('switch (manette choisie): OK');
}

{
  const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
  const SC = require('../src/switchcfg');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  SC.prepare(d, { guid: '030000005e0400008e02000000007801' });
  SC.prepare(d, { keyboard: true });
  const t = fs.readFileSync(path.join(d, 'config', 'sdl2-config.ini'), 'utf8');
  assert(!t.includes('engine:sdl') && !/player_0_button_a/.test(t) && t.includes('fullscreen_mode'));
  console.log('switch (clavier): OK');
}

{
  const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
  const SC = require('../src/switchcfg');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  SC.prepare(d, { guid: '030000005e0400008e02000000007801' });
  const r = SC.prepare(d, { dsu: true, guid: '030000005e0400008e02000000007801' });
  const t = fs.readFileSync(path.join(d, 'config', 'sdl2-config.ini'), 'utf8');
  assert.strictEqual(r.pad, 'arcadia');
  assert(t.includes('player_0_button_a="engine:cemuhookudp,guid:0000000000000000000000007f000001,port:26760,pad:0,button:8192"'));
  assert(t.includes('enable_udp_controller=true'));
  assert(t.includes('player_0_button_dright="engine:sdl,port:0,guid:030000005e0400008e02000000007801,hat:0,direction:right"'));
  console.log('switch (manette + clavier via Arcadia): OK');
}

{
  const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
  const SC = require('../src/switchcfg');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')); fs.mkdirSync(path.join(d, 'config'));
  fs.writeFileSync(path.join(d, 'config', 'qt-config.ini'), '[Renderer]\nresolution_setup\\default=false\nresolution_setup=6\nfullscreen_mode=1\n[Controls]\nplayer_0_button_a=x\n');
  SC.prepare(d, { opts: { 'Audio/volume': '80' } });
  const t = fs.readFileSync(path.join(d, 'config', 'sdl2-config.ini'), 'utf8');
  assert(/resolution_setup=6/.test(t) && /resolution_setup\\default=false/.test(t) && /fullscreen_mode=0/.test(t) && !/player_0_button_a=x/.test(t) && /volume=80/.test(t));
  console.log('switch (réglages Arcadia recopiés vers le moteur): OK');
}
{
  const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
  const SC = require('../src/switchcfg');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')); fs.mkdirSync(path.join(d, 'config'));
  fs.writeFileSync(path.join(d, 'config', 'sdl2-config.ini'), '[Controls]\nenable_udp_controller=true\nplayer_0_button_a="engine:cemuhookudp,port:0,pad:0,button:8192"\n');
  const r = SC.prepare(d, { arcadia: true, dsu: true });
  const t = fs.readFileSync(path.join(d, 'config', 'sdl2-config.ini'), 'utf8');
  assert(r.pad === 'arcadia' && /player_0_button_a="engine:virtual_gamepad,port:0,button:0"/.test(t) && /enable_udp_controller=false/.test(t) && !/cemuhookudp/.test(t) && /player_0_vibration_enabled=true/.test(t));
  console.log('switch (moteur Arcadia, manette virtuelle): OK');
}
