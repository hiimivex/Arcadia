// Région et langues lues dans l'en-tête des ROMs (fichiers fabriqués : aucune vraie ROM)
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const R = require('../src/romlangs');
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
const mk = (name, size, at) => { const b = Buffer.alloc(size); for (const [o, v] of at) (Buffer.isBuffer(v) ? v : Buffer.from(v, 'latin1')).copy(b, o); const p = path.join(d, name); fs.writeFileSync(p, b); return p; };
const det = (console, p, info) => R.detect({ console, path: p }, info);

let r = det('DS', mk('a.nds', 0x200, [[0x0c, 'ABCF']]));
assert.deepStrictEqual([r.region, r.langs], ['FRA', ['fr']]);
r = det('DS', mk('b.nds', 0x200, [[0x0c, 'ABCP']]));
assert.strictEqual(r.region, 'EUR'); assert(r.langs.includes('fr') && r.langs.includes('de') && !r.langs.includes('nl')); // nl absent de la DS
r = det('GAMECUBE', mk('c.iso', 0x100, [[0, 'GALE01']]));
assert.deepStrictEqual([r.region, r.langs], ['USA', ['en']]);
r = det('WII', mk('d.wbfs', 0x400, [[0, 'WBFS'], [8, Buffer.from([9])], [0x200, 'RMCP01']]));
assert.strictEqual(r.region, 'EUR'); assert(r.langs.includes('nl'));
r = det('WII', mk('e.rvz', 0x100, [[0, 'RVZ\x01'], [0x58, 'RSBJ01']]));
assert.deepStrictEqual(r.langs, ['ja']);
// N64 en ordre d'octets inversé (.v64)
const z = Buffer.alloc(0x40); z.writeUInt32BE(0x80371240, 0); z.write('NSMF', 0x3b, 'latin1');
const v = Buffer.from(z); for (let i = 0; i < v.length; i += 2) [v[i], v[i + 1]] = [v[i + 1], v[i]];
r = det('N64', mk('f.v64', 0x40, [[0, v]]));
assert.strictEqual(r.region, 'FRA');
r = det('PSP', mk('g.iso', 0x10, []), { serial: 'ULES-01213' });
assert.strictEqual(r.region, 'EUR');
assert.strictEqual(R.sonyRegion('SLUS_209.46'), 'USA');
assert.strictEqual(R.sonyRegion('SCES-50490'), 'EUR');
assert.strictEqual(R.sonyRegion('SLPM-65115'), 'JPN');
assert.strictEqual(det('GBA', mk('h.gba', 0x10, [])), null); // en-tête illisible : rien d'inventé
console.log('langues lues dans l\'en-tête des ROMs : OK');
