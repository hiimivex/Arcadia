const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const C = require('../src/controls');
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
let c = C.read(d, 'SWITCH');
assert.strictEqual(c.device, 'both'); assert.deepStrictEqual(c.kb.a, [C.SC.L]); assert.deepStrictEqual(c.pad.a, ['east']);
C.assign(c, 'kb', 'a', C.SC.J); // J était Y : il n'appartient plus qu'à A
assert.deepStrictEqual(c.kb.a, [C.SC.J]); assert.deepStrictEqual(c.kb.y, []);
C.assign(c, 'pad', 'b', 'east'); assert.deepStrictEqual(c.pad.b, ['east']); assert.deepStrictEqual(c.pad.a, []);
c.device = 'stick'; C.write(d, 'SWITCH', c);
const r = C.read(d, 'SWITCH'); assert.strictEqual(r.device, 'stick'); assert.deepStrictEqual(r.kb.a, [C.SC.J]); assert.deepStrictEqual(r.pad.b, ['east']);
assert.deepStrictEqual(C.read(d, 'PS1').kb.b, [C.SC.Z]); assert.strictEqual(C.labels('PS1').a, 'Rond');
assert.strictEqual(C.fileName('SWITCH 2'), 'SWITCH_2.ini');
console.log('contrôles (périphérique + touches réattribuées) : OK');
