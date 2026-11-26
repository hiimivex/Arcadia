// Contrôles par console : périphérique (les deux / clavier seul / manette seule / stick arcade) et touches réattribuées.
// Fichier lu par le moteur intégré et par le moteur Switch : <données Arcadia>/controls/<console>.ini
//   device=both|keyboard|pad|stick
//   kb.<action>=<codes de touche SDL séparés par des virgules>   (position physique : AZERTY = QWERTY)
//   pad.<action>=<boutons SDL séparés par des virgules>
const fs = require('fs');
const path = require('path');

// Actions, avec les noms de boutons de la Switch (position : A = droite, B = bas, X = haut, Y = gauche)
const ACTIONS = ['a', 'b', 'x', 'y', 'l', 'r', 'zl', 'zr', 'plus', 'minus', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home',
  'ls_up', 'ls_down', 'ls_left', 'ls_right', 'rs_up', 'rs_down', 'rs_left', 'rs_right'];
const PAD_BUTTONS = ['south', 'east', 'west', 'north', 'back', 'guide', 'start', 'ls', 'rs', 'lb', 'rb', 'up', 'down', 'left', 'right', 'misc1', 'lt', 'rt'];
const DEVICES = ['both', 'keyboard', 'pad', 'stick'];

// Codes SDL (positions physiques)
const SC = { A: 4, B: 5, C: 6, D: 7, E: 8, F: 9, G: 10, H: 11, I: 12, J: 13, K: 14, L: 15, M: 16, N: 17, O: 18, P: 19, Q: 20, R: 21, S: 22, T: 23,
  U: 24, V: 25, W: 26, X: 27, Y: 28, Z: 29, 1: 30, 2: 31, 3: 32, 4: 33, 5: 34, 6: 35, 7: 36, 8: 37, 9: 38, 0: 39,
  RETURN: 40, ESCAPE: 41, BACKSPACE: 42, TAB: 43, SPACE: 44, HOME: 74, RIGHT: 79, LEFT: 80, DOWN: 81, UP: 82, LSHIFT: 225, RSHIFT: 229, LCTRL: 224, RCTRL: 228 };

const PAD_DEFAULT = {
  a: ['east'], b: ['south'], x: ['north'], y: ['west'], l: ['lb'], r: ['rb'], zl: ['lt'], zr: ['rt'], plus: ['start'], minus: ['back'],
  l3: ['ls'], r3: ['rs'], up: ['up'], down: ['down'], left: ['left'], right: ['right'], home: []
};
// Clavier par défaut : moteur Switch (beaucoup de boutons) / moteur intégré (consoles rétro : touches historiques)
const KB_SWITCH = {
  a: [SC.L], b: [SC.K], x: [SC.I], y: [SC.J], l: [SC.Q], r: [SC.E], zl: [SC[1]], zr: [SC[3]], plus: [SC.RETURN], minus: [SC.BACKSPACE],
  l3: [SC.LSHIFT], r3: [SC.B], up: [SC.UP], down: [SC.DOWN], left: [SC.LEFT], right: [SC.RIGHT], home: [SC.HOME],
  ls_up: [SC.W], ls_down: [SC.S], ls_left: [SC.A], ls_right: [SC.D], rs_up: [SC.T], rs_down: [SC.G], rs_left: [SC.F], rs_right: [SC.H]
};
const KB_RUNNER = {
  a: [SC.X], b: [SC.Z], x: [SC.S], y: [SC.A], l: [SC.Q], r: [SC.W], zl: [SC[1]], zr: [SC[3]], plus: [SC.RETURN], minus: [SC.RSHIFT, SC.BACKSPACE],
  up: [SC.UP], down: [SC.DOWN], left: [SC.LEFT], right: [SC.RIGHT]
};
const isSwitch = c => c === 'SWITCH' || c === 'SWITCH 2';

function defaults(consoleId) {
  const kb = isSwitch(consoleId) ? KB_SWITCH : KB_RUNNER;
  const out = { device: 'both', kb: {}, pad: {} };
  for (const a of ACTIONS) { out.kb[a] = [...(kb[a] || [])]; out.pad[a] = [...(PAD_DEFAULT[a] || [])]; }
  return out;
}

// Noms affichés selon la famille de la console
const LABELS = {
  nintendo: { a: 'A', b: 'B', x: 'X', y: 'Y', l: 'L', r: 'R', zl: 'ZL', zr: 'ZR', plus: '+ (Start)', minus: '− (Select)' },
  sony: { a: 'Rond', b: 'Croix', x: 'Triangle', y: 'Carré', l: 'L1', r: 'R1', zl: 'L2', zr: 'R2', plus: 'Start', minus: 'Select' },
  sega: { a: 'B', b: 'A', x: 'Y', y: 'X', l: 'L', r: 'R', zl: 'Gâchette G', zr: 'Gâchette D', plus: 'Start', minus: 'Select' }
};
const COMMON = { l3: 'Clic stick gauche', r3: 'Clic stick droit', up: 'Croix ↑', down: 'Croix ↓', left: 'Croix ←', right: 'Croix →', home: 'Home',
  ls_up: 'Stick gauche ↑', ls_down: 'Stick gauche ↓', ls_left: 'Stick gauche ←', ls_right: 'Stick gauche →',
  rs_up: 'Stick droit ↑', rs_down: 'Stick droit ↓', rs_left: 'Stick droit ←', rs_right: 'Stick droit →' };
function labels(consoleId) {
  const fam = /^PS|PSP|PSVITA/.test(consoleId) ? 'sony' : consoleId === 'DREAMCAST' ? 'sega' : 'nintendo';
  return { ...COMMON, ...LABELS[fam] };
}

const fileName = consoleId => String(consoleId).replace(/[^\w-]+/g, '_') + '.ini';

function parse(text, consoleId) {
  const c = defaults(consoleId);
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/.exec(line); if (!m) continue;
    const [k, v] = [m[1], m[2]];
    if (k === 'device') { if (DEVICES.includes(v)) c.device = v; continue; }
    const [kind, action] = k.split('.');
    if (!ACTIONS.includes(action)) continue;
    const list = v ? v.split(',').map(x => x.trim()).filter(Boolean) : [];
    if (kind === 'kb') c.kb[action] = list.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 512);
    else if (kind === 'pad') c.pad[action] = list.filter(b => PAD_BUTTONS.includes(b));
  }
  return c;
}
function serialize(c) {
  const lines = ['# Contrôles Arcadia (écrit par Arcadia)', `device=${c.device}`];
  for (const a of ACTIONS) lines.push(`kb.${a}=${(c.kb[a] || []).join(',')}`);
  for (const a of ACTIONS) lines.push(`pad.${a}=${(c.pad[a] || []).join(',')}`);
  return lines.join('\n') + '\n';
}

function read(dir, consoleId) {
  try { return parse(fs.readFileSync(path.join(dir, fileName(consoleId)), 'utf8'), consoleId); } catch { return defaults(consoleId); }
}
function write(dir, consoleId, c) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, fileName(consoleId));
  fs.writeFileSync(f, serialize(c));
  return f;
}
// Réattribue une action : une touche ou un bouton ne sert qu'à une action à la fois (on la retire ailleurs)
function assign(c, kind, action, code) {
  const map = kind === 'kb' ? c.kb : c.pad;
  if (!ACTIONS.includes(action)) return c;
  for (const a of ACTIONS) map[a] = (map[a] || []).filter(x => x !== code);
  map[action] = [code];
  return c;
}
function ensure(dir, consoleId) {
  const f = path.join(dir, fileName(consoleId));
  if (!fs.existsSync(f)) write(dir, consoleId, defaults(consoleId));
  return f;
}

module.exports = { ACTIONS, PAD_BUTTONS, DEVICES, SC, defaults, labels, parse, serialize, read, write, assign, ensure, fileName };
