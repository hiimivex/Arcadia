// Définition des consoles : nom du dossier créé dans la bibliothèque,
// extensions reconnues et couleur d'accent pour l'interface.
// Ajouter une console = ajouter une entrée ici. C'est tout.
// files : noms de fichiers exacts à chercher (jeux en dossier, ex. EBOOT.BIN PS3/PS4)
// titleFromFolder : le titre vient du dossier du jeu, pas du nom de fichier.

const CONSOLES = [
  { id: 'SWITCH',    name: 'Nintendo Switch',   ext: ['nsp', 'xci', 'nsz', 'xcz', 'nup', 'nca', 'nro', 'nso'], color: '#e60012' },
  { id: 'SWITCH 2',  name: 'Nintendo Switch 2', ext: ['nsp', 'xci', 'nsz', 'xcz', 'nup'], color: '#ff4d5a' },
  { id: '3DS',       name: 'Nintendo 3DS',      ext: ['3ds', 'cci', 'cxi', 'cia', '3dsx', 'app'], color: '#d12228' },
  { id: 'DS',        name: 'Nintendo DS',       ext: ['nds', 'dsi', 'ids'],               color: '#9aa0a6' },
  { id: 'WIIU',      name: 'Wii U',             ext: ['wua', 'wud', 'wux', 'rpx'],        color: '#009ac7' },
  { id: 'PS4',       name: 'PlayStation 4',     ext: [], files: ['eboot.bin'], titleFromFolder: true, color: '#1f3a93' },
  { id: 'PS3',       name: 'PlayStation 3',     ext: ['iso'], files: ['eboot.bin'], titleFromFolder: true, color: '#111111' },
  { id: 'PSVITA',    name: 'PlayStation Vita',  ext: ['vpk'],                             color: '#2c4fd6' },
  { id: 'XBOX360',   name: 'Xbox 360',          ext: ['iso', 'xex', 'zar'],               color: '#5dc21e' },
  { id: 'XBOX',      name: 'Xbox',              ext: ['iso', 'xiso'],                     color: '#107c10' },
  { id: 'PSP',       name: 'PlayStation Portable', ext: ['iso', 'cso', 'chd', 'pbp', 'elf', 'prx'], color: '#3d5afe' },
  { id: 'PS2',       name: 'PlayStation 2',     ext: ['iso', 'chd', 'cso', 'bin', 'gz', 'elf'], color: '#2a3bb5' },
  { id: 'PS1',       name: 'PlayStation',       ext: ['cue', 'chd', 'pbp', 'bin', 'img', 'm3u', 'ccd', 'mds', 'ecm'], color: '#8e99a8' },
  { id: 'GAMECUBE',  name: 'GameCube',          ext: ['iso', 'gcm', 'rvz', 'gcz', 'ciso', 'wia', 'dol'], color: '#6a4cff' },
  { id: 'WII',       name: 'Wii',               ext: ['iso', 'wbfs', 'rvz', 'gcz', 'wad', 'wia'], color: '#00b2ff' },
  { id: 'N64',       name: 'Nintendo 64',       ext: ['n64', 'z64', 'v64'],               color: '#1fa34a' },
  { id: 'GBA',       name: 'Game Boy Advance',  ext: ['gba'],                             color: '#5b2fbf' },
  { id: 'GB',        name: 'Game Boy / Color',  ext: ['gb', 'gbc', 'sgb'],                color: '#7a8b2c' },
  { id: 'SNES',      name: 'Super Nintendo',    ext: ['sfc', 'smc', 'fig', 'swc'],        color: '#7e57c2' },
  { id: 'NES',       name: 'NES',               ext: ['nes', 'fds', 'unf', 'unif'],      color: '#c62828' },
  { id: 'MEGADRIVE', name: 'Mega Drive',        ext: ['md', 'gen', 'smd', 'bin', '32x'],  color: '#202020' },
  { id: 'DREAMCAST', name: 'Dreamcast',         ext: ['gdi', 'cdi', 'chd'],               color: '#f26b21' }
];

function getConsole(id) {
  return CONSOLES.find(c => c.id === id) || null;
}

module.exports = { CONSOLES, getConsole };
