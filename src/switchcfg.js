// Moteur Switch sans interface (eden-cli / lichii-cmd) : réglages écrits avant chaque lancement.
//   - plein écran « fenêtré sans bordure » (le menu Arcadia peut s'afficher par-dessus)
//   - mode TV (docké) : meilleure définition
//   - manette : mappage SDL de la manette détectée lors de la dernière session (identifiant lu dans le journal du moteur)
const fs = require('fs');
const path = require('path');
const { qtGet, qtSet, iniSet } = require('./configfiles');

// Identifiant SDL de la manette (port 0) tel qu'écrit par le moteur dans son journal
function padGuidFromLog(userDir) {
  for (const f of ['eden_log.txt', 'eden_log.txt.old.txt', 'lichii_log.txt']) {
    try {
      const txt = fs.readFileSync(path.join(userDir, 'log', f), 'utf8');
      const m = [...txt.matchAll(/connected on port 0 [^\n]*\n[^\n]*SDL GUID ([0-9a-f]{32})/gi)].pop()
        || [...txt.matchAll(/SDL GUID ([0-9a-f]{32})/gi)].pop();
      if (m) return m[1].toLowerCase();
    } catch { /* journal absent */ }
  }
  return null;
}

// Eden (comme yuzu) efface la somme de contrôle du nom (octets 2-3) des GUID SDL avant de les comparer :
// le GUID du journal « 0300fa67… » doit être écrit « 03000000… » sinon la manette n'est jamais reconnue.
const edenGuid = g => (g && g.length === 32 ? g.slice(0, 4) + '0000' + g.slice(8) : g || '').toLowerCase();

// Disposition « par position » façon Nintendo : le bouton du bas = B, celui de droite = A…
function xboxMapping(rawGuid) {
  const guid = edenGuid(rawGuid);
  const b = n => `"engine:sdl,port:0,guid:${guid},button:${n}"`;
  const h = d => `"engine:sdl,port:0,guid:${guid},hat:0,direction:${d}"`;
  const t = a => `"engine:sdl,port:0,guid:${guid},axis:${a},threshold:0.500000,invert:+"`;
  const s = (x, y) => `"engine:sdl,port:0,guid:${guid},axis_x:${x},axis_y:${y},deadzone:0.150000,range:1.000000,invert_x:+,invert_y:+,offset_x:0.000000,offset_y:0.000000"`;
  return {
    player_0_button_a: b(1), player_0_button_b: b(0), player_0_button_x: b(3), player_0_button_y: b(2),
    player_0_button_l: b(4), player_0_button_r: b(5), player_0_button_zl: t(2), player_0_button_zr: t(5),
    player_0_button_minus: b(6), player_0_button_plus: b(7), player_0_button_lstick: b(8), player_0_button_rstick: b(9),
    player_0_button_home: b(10),
    player_0_button_dup: h('up'), player_0_button_ddown: h('down'), player_0_button_dleft: h('left'), player_0_button_dright: h('right'),
    player_0_lstick: s(0, 1), player_0_rstick: s(3, 4)
  };
}

// Correspondance SDL de la manette (ligne gamecontrollerdb) vue par le moteur dans son journal
function padMappingFromLog(userDir, guid) {
  for (const f of ['eden_log.txt', 'eden_log.txt.old.txt']) {
    try {
      const txt = fs.readFileSync(path.join(userDir, 'log', f), 'utf8');
      const m = [...txt.matchAll(/SDL GUID ([0-9a-f]{32})[^\n]*mapping: ([^\n]+)/gi)].filter(x => !guid || x[1].toLowerCase() === guid).pop();
      if (m) return m[2].trim();
    } catch { /* journal absent */ }
  }
  return '';
}

// Touches Switch (par position) déduites d'une ligne SDL : marche pour n'importe quelle manette, calibrée ou non
function sdlToSwitch(guid, mapping) {
  const map = {};
  for (const part of String(mapping || '').split(',').slice(2)) { const i = part.indexOf(':'); if (i > 0) map[part.slice(0, i)] = part.slice(i + 1); }
  if (!map.a || !map.b) return null;
  const base = `engine:sdl,port:0,guid:${edenGuid(guid)}`;
  const DIR = { 1: 'up', 2: 'right', 4: 'down', 8: 'left' };
  const btn = tok => {
    if (!tok) return '"engine:keyboard,code:0,toggle:0"';
    let m;
    if ((m = /^b(\d+)$/.exec(tok))) return `"${base},button:${m[1]}"`;
    if ((m = /^h(\d+)\.(\d+)$/.exec(tok))) return `"${base},hat:${m[1]},direction:${DIR[m[2]] || 'up'}"`;
    if ((m = /^([+-]?)a(\d+)~?$/.exec(tok))) return `"${base},axis:${m[2]},threshold:0.500000,invert:${m[1] === '-' ? '-' : '+'}"`;
    return '"engine:keyboard,code:0,toggle:0"';
  };
  const ax = t => { const m = /^a(\d+)(~?)$/.exec(t || ''); return m ? { n: m[1], inv: m[2] ? '-' : '+' } : null; };
  const stick = (x, y) => {
    const X = ax(map[x]), Y = ax(map[y]);
    if (!X || !Y) return null;
    return `"${base},axis_x:${X.n},axis_y:${Y.n},deadzone:0.150000,range:1.000000,invert_x:${X.inv},invert_y:${Y.inv},offset_x:0.000000,offset_y:0.000000"`;
  };
  const out = {
    player_0_button_a: btn(map.b), player_0_button_b: btn(map.a), player_0_button_x: btn(map.y), player_0_button_y: btn(map.x),
    player_0_button_l: btn(map.leftshoulder), player_0_button_r: btn(map.rightshoulder),
    player_0_button_zl: btn(map.lefttrigger), player_0_button_zr: btn(map.righttrigger),
    player_0_button_minus: btn(map.back), player_0_button_plus: btn(map.start),
    player_0_button_lstick: btn(map.leftstick), player_0_button_rstick: btn(map.rightstick), player_0_button_home: btn(map.guide),
    player_0_button_dup: btn(map.dpup), player_0_button_ddown: btn(map.dpdown), player_0_button_dleft: btn(map.dpleft), player_0_button_dright: btn(map.dpright)
  };
  const ls = stick('leftx', 'lefty'), rs = stick('rightx', 'righty');
  if (ls) out.player_0_lstick = ls;
  if (rs) out.player_0_rstick = rs;
  return out;
}

// Manette réseau Arcadia (protocole DSU, 127.0.0.1:26760) : fusionne la vraie manette ET le clavier.
// Identifiant du serveur selon le moteur : 00000000-0000-0000-0000-0000{IPv4 en hexa}.
const DSU = 'engine:cemuhookudp,guid:0000000000000000000000007f000001,port:26760,pad:0';
function dsuMapping() {
  const b = id => `"${DSU},button:${id}"`;
  const st = (x, y) => `"${DSU},axis_x:${x},axis_y:${y},deadzone:0.150000,range:1.000000,invert_x:+,invert_y:+,offset_x:0.000000,offset_y:0.000000"`;
  return {
    player_0_button_a: b(0x2000), player_0_button_b: b(0x4000), player_0_button_x: b(0x1000), player_0_button_y: b(0x8000),
    player_0_button_l: b(0x0400), player_0_button_r: b(0x0800), player_0_button_zl: b(0x0100), player_0_button_zr: b(0x0200),
    player_0_button_plus: b(0x0008), player_0_button_minus: b(0x0001), player_0_button_lstick: b(0x0002), player_0_button_rstick: b(0x0004),
    player_0_button_dup: b(0x0010), player_0_button_dright: b(0x0020), player_0_button_ddown: b(0x0040), player_0_button_dleft: b(0x0080),
    player_0_button_home: b(0x40000),
    player_0_lstick: st(0, 1), player_0_rstick: st(2, 3)
  };
}

// Moteur Switch d'Arcadia (arcadia-switch) : il lit lui-même manette + clavier et les fusionne dans sa manette
// virtuelle (port 0) ; les vibrations repartent de là vers la vraie manette.
function virtualMapping(n = 0) {
  const V = `engine:virtual_gamepad,port:${n}`, P = `player_${n}_`;
  const b = id => `"${V},button:${id}"`;
  const st = (x, y) => `"${V},axis_x:${x},axis_y:${y},deadzone:0.000000,range:1.000000"`;
  const m = {
    button_a: b(0), button_b: b(1), button_x: b(2), button_y: b(3),
    button_lstick: b(4), button_rstick: b(5), button_l: b(6), button_r: b(7),
    button_zl: b(8), button_zr: b(9), button_plus: b(10), button_minus: b(11),
    button_dleft: b(12), button_dup: b(13), button_dright: b(14), button_ddown: b(15),
    button_home: b(18), button_screenshot: b(19),
    lstick: st(0, 1), rstick: st(2, 3)
  };
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [P + k, v]));
}

// Réglages généraux choisis dans Arcadia (page de l'émulateur Switch, qualité graphique) : ils sont écrits dans
// qt-config.ini, mais le moteur sans interface lit sdl2-config.ini → on les recopie avant chaque lancement.
const SYNC_SECTIONS = ['Renderer', 'Core', 'Cpu', 'Audio', 'System'];
const SYNC_SKIP = new Set(['fullscreen_mode', 'use_docked_mode']);
function syncFromQt(userDir, t) {
  let q = '';
  try { q = fs.readFileSync(path.join(userDir, 'config', 'qt-config.ini'), 'utf8'); } catch { return t; }
  let sec = null;
  for (const line of q.split(/\r?\n/)) {
    const h = /^\[(.+)\]\s*$/.exec(line); if (h) { sec = h[1]; continue; }
    if (!sec || !SYNC_SECTIONS.includes(sec)) continue;
    const m = /^([^=\\]+?)(\\default)?=(.*)$/.exec(line); if (!m) continue;
    if (SYNC_SKIP.has(m[1])) continue;
    t = iniSet(t, sec, m[1] + (m[2] || ''), m[3]);
  }
  return t;
}

// Prépare sdl2-config.ini. Renvoie { pad: guid|null }
function prepare(userDir, { docked = true, guid: chosen = '', mapping: chosenMap = '', opts = {}, keyboard = false, dsu = false, arcadia = false } = {}) {
  const file = path.join(userDir, 'config', 'sdl2-config.ini');
  let t = '';
  try { t = fs.readFileSync(file, 'utf8'); } catch { /* le moteur le créera, on écrit le minimum */ }
  t = syncFromQt(userDir, t);
  t = qtSet(t, 'Renderer', 'fullscreen_mode', '0', '0');          // sans bordure
  t = qtSet(t, 'System', 'use_docked_mode', docked ? '1' : '0', '0'); // défaut du moteur : portable
  if (arcadia) { // moteur Arcadia : tout passe par sa manette virtuelle
    for (const [k, v] of Object.entries(virtualMapping())) t = qtSet(t, 'Controls', k, v, '');
    t = qtSet(t, 'Controls', 'player_0_connected', 'true', 'true');
    t = qtSet(t, 'Controls', 'player_0_type', '0', '0');
    t = qtSet(t, 'Controls', 'player_0_vibration_enabled', 'true', 'true');
    t = qtSet(t, 'Controls', 'vibration_enabled', 'true', 'true');
    t = qtSet(t, 'Controls', 'enable_udp_controller', 'false', 'false');
    // joueurs 2 à 4 : les autres manettes branchées ; le moteur les connecte au jeu quand elles sont là
    for (let n = 1; n <= 3; n++) {
      for (const [k, v] of Object.entries(virtualMapping(n))) t = qtSet(t, 'Controls', k, v, '');
      t = qtSet(t, 'Controls', `player_${n}_connected`, 'false', 'false');
      t = qtSet(t, 'Controls', `player_${n}_type`, '0', '0');
      t = qtSet(t, 'Controls', `player_${n}_vibration_enabled`, 'true', 'true');
    }
  }
  // la manette vue par le moteur lui-même (GUID SDL exact), sinon celle choisie dans Arcadia
  if (arcadia) { /* rien d'autre */ } else if (dsu) { // manette + clavier en même temps, via Arcadia
    for (const [k, v] of Object.entries(dsuMapping())) t = qtSet(t, 'Controls', k, v, '');
    t = qtSet(t, 'Controls', 'player_0_connected', 'true', 'true');
    t = qtSet(t, 'Controls', 'player_0_type', '0', '0');
    t = qtSet(t, 'Controls', 'udp_input_servers', '127.0.0.1:26760', '127.0.0.1:26760');
    // sans ça, le moteur ne lit que le gyroscope des manettes réseau et ignore boutons et sticks
    t = qtSet(t, 'Controls', 'enable_udp_controller', 'true', 'false');
    // vibrations : le moteur les envoie à l'appareil relié à « croix droite » (côté gauche) et « A » (côté droit).
    // La manette réseau ne vibre pas : on relie « croix droite » directement à la vraie manette.
    const vg = padGuidFromLog(userDir) || chosen;
    if (vg) {
      const sdl = (vg === padGuidFromLog(userDir) ? padMappingFromLog(userDir, vg) : '') || (vg === chosen ? chosenMap : '');
      const direct = sdlToSwitch(vg, sdl) || xboxMapping(vg);
      t = qtSet(t, 'Controls', 'player_0_button_dright', direct.player_0_button_dright, '');
      t = qtSet(t, 'Controls', 'player_0_vibration_enabled', 'true', 'true');
    }
  }
  const logGuid = keyboard || dsu || arcadia ? null : padGuidFromLog(userDir);
  const guid = keyboard || dsu || arcadia ? null : logGuid || chosen;
  if (dsu || arcadia) { /* déjà fait */ } else if (keyboard) {
    // clavier : on retire les touches manette écrites par Arcadia → le moteur reprend ses touches clavier par défaut
    const lines = t.split(/\r?\n/);
    const sdlKeys = new Set(lines.map(l => /^(player_0_(?:button_\w+|lstick|rstick))="?engine:sdl/.exec(l)).filter(Boolean).map(m => m[1]));
    t = lines.filter(l => { const m = /^(player_0_\w+?)(\\default)?=/.exec(l); return !(m && sdlKeys.has(m[1])); }).join('\n');
  } else if (guid) {
    const sdl = (logGuid ? padMappingFromLog(userDir, logGuid) : '') || (guid === chosen ? chosenMap : '');
    const keys = sdlToSwitch(guid, sdl) || xboxMapping(guid);
    for (const [k, v] of Object.entries(keys)) t = qtSet(t, 'Controls', k, v, '');
    t = qtSet(t, 'Controls', 'player_0_connected', 'true', 'true');
    t = qtSet(t, 'Controls', 'player_0_type', '0', '0');           // manette Pro
  }
  // réglages choisis dans le menu Arcadia (Image, Son, Manette) : « Section/clé » → valeur
  for (const [k, v] of Object.entries(opts || {})) {
    const [sec, key] = k.split('/');
    if (sec && key && sec !== 'Arcadia' && v !== undefined && v !== null) t = qtSet(t, sec, key, String(v), '');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, t);
  return { pad: dsu || arcadia ? 'arcadia' : guid };
}

// Valeurs actuelles de quelques réglages (pour le menu Arcadia)
function readOpts(userDir, keys) {
  let t = '';
  try { t = fs.readFileSync(path.join(userDir, 'config', 'sdl2-config.ini'), 'utf8'); } catch { /* pas encore créé */ }
  const out = {};
  for (const k of keys) { const [sec, key] = k.split('/'); out[k] = qtGet(t, sec, key, null); }
  return out;
}

module.exports = { syncFromQt, virtualMapping, dsuMapping, edenGuid, prepare, readOpts, padGuidFromLog, padMappingFromLog, sdlToSwitch, xboxMapping };
