// Test sans Electron : crée une fausse bibliothèque + faux émulateurs et vérifie scan, détection, arguments.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createConsoleFolders, scanLibrary, cleanTitle } = require('../src/library');
const { detectEmulators, buildDefaultMapping, parseArgs, checkSetup } = require('../src/emulators');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadia-'));
const lib = path.join(tmp, 'Library');
const emus = path.join(tmp, 'Soft');
fs.mkdirSync(lib);

const created = createConsoleFolders(lib);
assert(created.includes('PSP') && created.includes('SWITCH 2'), 'dossiers consoles créés');

const touch = p => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
touch(path.join(lib, 'PSP', 'God of War - Chains of Olympus (Europe).iso'));
touch(path.join(lib, 'PSP', 'covers', 'God of War - Chains of Olympus (Europe).png'));
touch(path.join(lib, 'SWITCH', 'Mario Kart 8 Deluxe [0100152000022000][v0].nsp'));
touch(path.join(lib, 'DS', 'Pokemon Platine (France).nds'));
touch(path.join(lib, 'DS', 'notes.txt'));
touch(path.join(lib, 'PS1', 'Crash Bandicoot', 'Crash Bandicoot (Europe).cue'));
touch(path.join(lib, 'PS1', 'Crash Bandicoot', 'Crash Bandicoot (Europe).bin'));
touch(path.join(lib, 'PS3', 'Demon\'s Souls [BLES00932]', 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'));
touch(path.join(lib, 'PS3', 'Demon\'s Souls [BLES00932]', 'PS3_GAME', 'USRDIR', 'data.bin'));
touch(path.join(lib, 'PS3', 'covers', 'Demon\'s Souls [BLES00932].jpg'));
touch(path.join(lib, 'WIIU', 'Mario Kart 8.wua'));

const games = scanLibrary(lib);
const titles = games.map(g => `${g.console}:${g.title}`).sort();
console.log(titles);
assert.deepStrictEqual(titles, [
  'DS:Pokemon Platine',
  'PS1:Crash Bandicoot',
  "PS3:Demon's Souls",
  'PSP:God of War - Chains of Olympus',
  'SWITCH:Mario Kart 8 Deluxe',
  'WIIU:Mario Kart 8'
]);
assert(games.find(g => g.console === 'PS3').cover, 'jaquette PS3 (jeu en dossier) trouvée');
assert(games.find(g => g.console === 'PSP').cover, 'jaquette trouvée');
assert.strictEqual(cleanTitle('Zelda (USA) [!].gba'), 'Zelda');

touch(path.join(emus, 'Eden', 'eden.exe'));
touch(path.join(emus, 'PPSSPP', 'PPSSPPWindows64.exe'));
touch(path.join(emus, 'melonDS.exe'));
touch(path.join(emus, 'azahar.exe'));
touch(path.join(emus, 'RetroArch', 'retroarch.exe'));
touch(path.join(emus, 'ares', 'ares.exe'));
touch(path.join(emus, 'RPCS3', 'rpcs3.exe'));
touch(path.join(emus, 'Lichii', 'lichii.exe'));
const found = detectEmulators(emus);
assert.deepStrictEqual(Object.keys(found).sort(), ['ares', 'azahar', 'eden', 'lichii', 'melonds', 'ppsspp', 'retroarch', 'rpcs3']);
assert.strictEqual(buildDefaultMapping(found)['SWITCH 2'].emulator, 'lichii', 'Lichii pour la Switch 2');
const mapping = buildDefaultMapping(found);
assert.strictEqual(mapping.N64.emulator, 'ares');
assert(mapping.N64.args.includes('Nintendo 64'));
touch(path.join(emus, 'gopher64', 'gopher64.exe'));
touch(path.join(emus, 'MesenCE', 'Mesen.exe'));
const m2 = buildDefaultMapping(detectEmulators(emus));
assert.strictEqual(m2.N64.emulator, 'gopher64', 'gopher64 prioritaire sur ares');
assert.strictEqual(m2.NES.emulator, 'mesen', 'Mesen prioritaire sur ares');
assert.strictEqual(m2.SNES.emulator, 'ares');
assert.strictEqual(mapping.PS3.emulator, 'rpcs3');
assert.strictEqual(mapping.SWITCH.emulator, 'eden');
assert.strictEqual(mapping.PSP.emulator, 'ppsspp');
assert.strictEqual(mapping.GBA.emulator, 'retroarch');
assert.strictEqual(checkSetup(mapping.SWITCH), null);
assert(/Core RetroArch manquant/.test(checkSetup(mapping.GBA)), 'core manquant signalé');
assert(checkSetup(undefined), 'console sans émulateur signalée');

const rom = 'D:\\Jeux\\SWITCH\\Mario Kart 8.nsp';
assert.deepStrictEqual(parseArgs('-f -g "{rom}"', { rom }), ['-f', '-g', rom]);
assert.deepStrictEqual(parseArgs('-f -L "{core}" "{rom}"', { rom, core: 'C:\\RA\\cores\\mgba_libretro.dll' }),
  ['-f', '-L', 'C:\\RA\\cores\\mgba_libretro.dll', rom]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK — tous les tests passent.');

// ---- détection du désordre
{
  const { findLoose } = require('../src/library');
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'arcadia-loose-'));
  createConsoleFolders(t2);
  touch(path.join(t2, 'PSP', 'deja range.iso'));
  touch(path.join(t2, 'Mario Kart DS.nds'));
  touch(path.join(t2, 'vrac', 'sous', 'pack.zip'));
  touch(path.join(t2, 'vrac', 'Crash.cue'));
  touch(path.join(t2, 'vrac', 'Crash.bin'));
  touch(path.join(t2, 'vrac', 'notes.txt'));
  const l = findLoose(t2).map(x => path.relative(t2, x.path).split(path.sep).join('/') + '=' + (x.archive ? 'archive' : x.console)).sort();
  assert.deepStrictEqual(l, ['Mario Kart DS.nds=DS', 'vrac/Crash.cue=PS1', 'vrac/sous/pack.zip=archive']);
  fs.rmSync(t2, { recursive: true, force: true });
  console.log('OK — détection du désordre.');
}
