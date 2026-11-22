// Base multijoueur d'Arcadia : pour chaque jeu connu, le type de multi et le « branchement » qu'Arcadia sait faire.
// Les jeux sont reconnus par leur titre (et la console) : pas besoin d'avoir la ROM pour qu'ils soient prêts.
//
// Types de multi :
//   couch    : plusieurs manettes sur le même PC (écran partagé / même écran)
//   adhoc    : PSP « ad hoc » (plusieurs consoles) → serveur PRO Ad Hoc de PPSSPP (moteur intégré)
//   wireless : 3DS « local sans fil » → salon Azahar (azahar-room)
//   ldn      : Switch « local sans fil » → salons d'Eden
//   dswifi   : DS sans fil → pas encore de branchement
//   dead     : en ligne uniquement, serveurs officiels fermés
const { norm } = require('./gameinfo');

// Branchements disponibles par type
const BRANCH = {
  couch: { ready: true, label: 'Sur ce PC', how: 'Branche une manette par joueur : chaque manette est un joueur.' },
  adhoc: { ready: true, label: 'En ligne (ad hoc PSP)', engine: 'runner' },
  wireless: { ready: true, label: 'En ligne (salon 3DS)', engine: 'azahar' },
  ldn: { ready: false, label: 'En ligne (salon Switch)', why: 'Le salon Switch passe par Eden, pas encore branché dans Arcadia.' },
  dswifi: { ready: false, label: 'Sans fil DS', why: 'Le multi sans fil DS n\'est pas encore branché dans Arcadia.' },
  dead: { ready: false, label: 'En ligne', why: 'Ce jeu ne se jouait qu\'en ligne et les serveurs officiels sont fermés.' }
};

// [console, motif du titre (normalisé), { type: joueurs max }, remarque]
const GAMES = [
  // ---------------- PSP (ad hoc)
  ['PSP', /^monster hunter freedom unite\b/, { adhoc: 4 }],
  ['PSP', /^monster hunter freedom 2\b/, { adhoc: 4 }],
  ['PSP', /^monster hunter freedom\b/, { adhoc: 4 }],
  ['PSP', /^monster hunter portable 3rd\b/, { adhoc: 4 }],
  ['PSP', /^medal of honor heroes 2\b/, { adhoc: 16 }],
  ['PSP', /^medal of honor heroes\b/, { adhoc: 16 }],
  ['PSP', /^naruto shippuden ultimate ninja impact\b/, { adhoc: 2 }],
  ['PSP', /^need for speed carbon own the city\b/, { adhoc: 4 }],
  ['PSP', /^syphon filter logan s shadow\b/, { adhoc: 8 }],
  ['PSP', /^syphon filter dark mirror\b/, { adhoc: 8 }],
  ['PSP', /^tekken 6\b/, { adhoc: 2 }],
  ['PSP', /^tekken dark resurrection\b/, { adhoc: 2 }],
  ['PSP', /^phantasy star portable 2\b/, { adhoc: 4 }],
  ['PSP', /^phantasy star portable\b/, { adhoc: 4 }],
  ['PSP', /^dissidia (012|duodecim)\b/, { adhoc: 2 }],
  ['PSP', /^dissidia final fantasy\b/, { adhoc: 2 }],
  ['PSP', /^god eater burst\b/, { adhoc: 4 }],
  ['PSP', /^grand theft auto (liberty city|vice city) stories\b/, { adhoc: 6 }],
  ['PSP', /^ridge racer 2\b/, { adhoc: 8 }],
  ['PSP', /^ridge racer\b/, { adhoc: 8 }],
  ['PSP', /^(pro evolution soccer|pes) \d{4}\b/, { adhoc: 2 }],
  ['PSP', /^fifa \d\d\b/, { adhoc: 2 }],
  ['PSP', /^soulcalibur broken destiny\b/, { adhoc: 2 }],
  ['PSP', /^street fighter alpha 3 max\b/, { adhoc: 2 }],
  ['PSP', /^daxter\b/, {}],
  ['PSP', /^socom\b/, { adhoc: 16 }],
  ['PSP', /^killzone liberation\b/, { adhoc: 6 }],
  ['PSP', /^lumines\b/, { adhoc: 2 }],
  ['PSP', /^worms open warfare\b/, { adhoc: 4 }],
  ['PSP', /^patapon (2|3)\b/, { adhoc: 4 }],
  ['PSP', /^crash tag team racing\b/, { adhoc: 4 }],
  ['PSP', /^wipeout (pure|pulse)\b/, { adhoc: 8 }],
  ['PSP', /^burnout (legends|dominator)\b/, { adhoc: 6 }],

  // ---------------- 3DS (local sans fil)
  ['3DS', /^mario kart 7\b/, { wireless: 8 }],
  ['3DS', /^super smash bros\b/, { wireless: 4 }],
  ['3DS', /^monster hunter (4 ultimate|generations|3 ultimate|stories)\b/, { wireless: 4 }],
  ['3DS', /^monster hunter\b/, { wireless: 4 }],
  ['3DS', /^pokemon (x|y|omega ruby|alpha sapphire|sun|moon|ultra sun|ultra moon)\b/, { wireless: 4 }],
  ['3DS', /^fantasy life\b/, { wireless: 3 }],
  ['3DS', /^donkey kong country returns 3d\b/, { wireless: 2 }],
  ['3DS', /^ridge racer 3d\b/, { wireless: 4 }],
  ['3DS', /^asphalt 3d\b/, { wireless: 6 }],
  ['3DS', /^mario party (island tour|the top 100|star rush)\b/, { wireless: 4 }],
  ['3DS', /^kid icarus uprising\b/, { wireless: 6 }],
  ['3DS', /^new super mario bros 2\b/, { wireless: 2 }],
  ['3DS', /^super mario 3d land\b/, {}],
  ['3DS', /^animal crossing new leaf\b/, { wireless: 4 }],
  ['3DS', /^luigi s mansion (2|dark moon)\b/, { wireless: 4 }],
  ['3DS', /^the legend of zelda tri force heroes\b/, { wireless: 3 }],
  ['3DS', /^tetris ultimate\b/, { wireless: 4 }],
  ['3DS', /^mario tennis open\b/, { wireless: 4 }],
  ['3DS', /^mario golf world tour\b/, { wireless: 4 }],

  // ---------------- Switch (même PC + local sans fil)
  ['SWITCH', /^mario kart 8 deluxe\b/, { couch: 4, ldn: 8 }],
  ['SWITCH', /^super smash bros ultimate\b/, { couch: 8, ldn: 8 }],
  ['SWITCH', /^animal crossing new horizons\b/, { couch: 4, ldn: 8 }],
  ['SWITCH', /^mario party (superstars|jamboree)\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^super mario party\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^mario golf super rush\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^mario strikers battle league\b/, { couch: 4, ldn: 8 }],
  ['SWITCH', /^mario tennis aces\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^new super mario bros u deluxe\b/, { couch: 4 }],
  ['SWITCH', /^super mario 3d world\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^super mario bros wonder\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^super mario galaxy\b/, { couch: 2 }],
  ['SWITCH', /^super mario odyssey\b/, { couch: 2 }],
  ['SWITCH', /^super mario bros 35\b/, { dead: 35 }],
  ['SWITCH', /^luigi s mansion 3\b/, { couch: 2, ldn: 8 }],
  ['SWITCH', /^luigi s mansion 2 hd\b/, { ldn: 4 }],
  ['SWITCH', /^cult of the lamb\b/, { couch: 2 }],
  ['SWITCH', /^overcooked\b/, { couch: 4, ldn: 4 }],
  ['SWITCH', /^pokemon (sword|shield|epee|bouclier|scarlet|violet|ecarlate|brilliant diamond|shining pearl|diamant etincelant|perle scintillante|let s go)\b/, { ldn: 4 }],
  ['SWITCH', /^monster hunter (rise|generations ultimate)\b/, { ldn: 4 }],
  ['SWITCH', /^splatoon\b/, { ldn: 8 }],
  ['SWITCH', /^kirby and the forgotten land\b/, { couch: 2 }],
  ['SWITCH', /^kirby star allies\b/, { couch: 4 }],
  ['SWITCH', /^donkey kong country (tropical freeze|returns hd)\b/, { couch: 2 }],
  ['SWITCH', /^captain toad\b/, { couch: 2 }],
  ['SWITCH', /^it takes two\b/, { couch: 2 }],
  ['SWITCH', /^minecraft\b/, { couch: 4, ldn: 8 }],
  ['SWITCH', /^tomodachi life\b/, {}],

  // ---------------- DS (sans fil : pas encore branché)
  ['DS', /^call of duty black ops\b/, { dswifi: 6 }],
  ['DS', /^inazuma eleven\b/, { dswifi: 2 }],
  ['DS', /^mario kart ds\b/, { dswifi: 8 }],
  ['DS', /^new super mario bros\b/, { dswifi: 4 }],
  ['DS', /^pokemon\b/, { dswifi: 4 }],
  ['DS', /^tetris ds\b/, { dswifi: 10 }]
];

// Jeux solo connus (pour ne pas afficher « contacte-moi » à tort)
const SOLO = [
  /^god of war\b/, /^assassin s creed\b/, /^the 3rd birthday\b/, /^crisis core\b/, /^professor layton\b/, /^metroid dread\b/,
  /^the legend of zelda (link s awakening|skyward sword|tears of the kingdom|breath of the wild|a link between worlds|ocarina|majora)\b/,
  /^fire emblem\b/, /^detective pikachu\b/, /^etrian odyssey\b/, /^hyrule warriors\b/, /^thor\b/, /^gardening mama\b/,
  /^avatar\b/, /^pirates of the caribbean\b/, /^shadow of the colossus\b/, /^story of seasons\b/, /^rise of the guardians\b/, /^pursuit force\b/
];

function lookup(consoleId, title) {
  const c = String(consoleId || '').toUpperCase(), t = norm(title);
  if (!t) return null;
  const hit = GAMES.find(([gc, re]) => gc === c && re.test(t));
  if (hit) {
    const modes = Object.entries(hit[2]).map(([type, players]) => ({ type, players, ...BRANCH[type] }));
    return { known: true, solo: !modes.length, modes };
  }
  if (SOLO.some(re => re.test(t))) return { known: true, solo: true, modes: [] };
  return { known: false, solo: false, modes: [] };
}

// Adresse IPv4 → 12 chiffres pour les options du cœur PPSSPP (ppsspp_pro_ad_hoc_server_address01..12)
function ipDigits(ip) {
  const parts = String(ip || '').trim().split('.').map(n => parseInt(n, 10));
  if (parts.length !== 4 || parts.some(n => !(n >= 0 && n <= 255))) return null;
  const s = parts.map(n => String(n).padStart(3, '0')).join('');
  const out = {};
  for (let i = 0; i < 12; i++) out[`ppsspp_pro_ad_hoc_server_address${String(i + 1).padStart(2, '0')}`] = s[i];
  return out;
}

module.exports = { lookup, ipDigits, BRANCH, GAMES };
