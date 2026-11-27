// Identifiants Switch, patchs PS1
const assert = require('assert');
const { titleIdFrom } = require('../src/switchdb');
const P = require('../src/patches');

assert.strictEqual(titleIdFrom('Mario Kart 8 Deluxe [0100152000022000][v0].nsp'), '0100152000022000');
assert.strictEqual(titleIdFrom('MK8 [0100152000022800][v1].nsp'), '0100152000022000');
assert.strictEqual(titleIdFrom('Mario Kart World [0400C3F00006E000][v0].nup'), '0400C3F00006E000');
assert.strictEqual(titleIdFrom('Zelda.xci'), null);

const cht = '[Widescreen 16:9]\nType = Gameshark\n8006C2F8 0C00\n[60 FPS]\nType = Gameshark\n80000000 0001\n';
assert.deepStrictEqual(P.ps1Wide(cht), ['# Widescreen 16:9', '8006C2F8 0C00']);
assert.deepStrictEqual(P.ps1Sixty(cht), ['# 60 FPS', '80000000 0001']);
console.log('identifiants Switch, patchs PS1 : OK');
