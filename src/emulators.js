const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Émulateurs connus : noms d'exécutables à chercher et arguments par défaut.
// {rom} est remplacé par le chemin du jeu, {core} par le core RetroArch.
const KNOWN_EMULATORS = {
  eden:      { name: 'Eden',      exe: ['eden.exe', 'eden'],                        args: '-f -g "{rom}"', consoles: ['SWITCH'] },
  // Switch 2 : Lichii (fork expérimental d'Eden, gère aussi la Switch 1, mais Eden reste prioritaire pour la Switch 1).
  edencli:   { name: 'Eden (moteur, interface Arcadia)', exe: ['eden-cli.exe', 'eden-cli'], args: '-f -g "{rom}"', consoles: ['SWITCH', 'SWITCH 2'] }, // cœur d'Eden fourni avec Lichii
  lichii:    { name: 'Lichii (avec son interface)',    exe: ['lichii.exe', 'lichii'],                    args: '-f -g "{rom}"', consoles: ['SWITCH 2', 'SWITCH'] }, // Switch : relais si Eden absent
  ppsspp:    { name: 'PPSSPP',    exe: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe', 'PPSSPPSDL', 'ppsspp'], args: '--fullscreen "{rom}"', consoles: ['PSP'] },
  azahar:    { name: 'Azahar',    exe: ['azahar.exe', 'azahar'],                    args: '-f "{rom}"',   consoles: ['3DS'] },
  melonds:   { name: 'melonDS',   exe: ['melonDS.exe', 'melonDS'],                  args: '-f "{rom}"',   consoles: ['DS'] },
  pcsx2:     { name: 'PCSX2',     exe: ['pcsx2-qt.exe', 'pcsx2-qtx64.exe', 'pcsx2-qt', 'pcsx2'], args: '-fullscreen -- "{rom}"', consoles: ['PS2'] },
  duckstation: { name: 'DuckStation', exe: ['duckstation-qt-x64-ReleaseLTCG.exe', 'duckstation-qt'], args: '-fullscreen "{rom}"', consoles: ['PS1'] },
  dolphin:   { name: 'Dolphin',   exe: ['Dolphin.exe', 'dolphin-emu'],              args: '-b -e "{rom}"', consoles: ['GAMECUBE', 'WII'] },
  rpcs3:     { name: 'RPCS3',     exe: ['rpcs3.exe', 'rpcs3'],                      args: '--no-gui "{rom}"', consoles: ['PS3'] },
  cemu:      { name: 'Cemu',      exe: ['Cemu.exe', 'cemu'],                        args: '-f -g "{rom}"', consoles: ['WIIU'] },
  xenia:     { name: 'Xenia Canary', exe: ['xenia_canary.exe'],                     args: '--fullscreen "{rom}"', consoles: ['XBOX360'] },
  xemu:      { name: 'xemu',      exe: ['xemu.exe', 'xemu'],                        args: '-full-screen -dvd_path "{rom}"', consoles: ['XBOX'] },
  vita3k:    { name: 'Vita3K',    exe: ['Vita3K.exe', 'Vita3K'],                    args: '-F "{rom}"',   consoles: ['PSVITA'] },
  shadps4:   { name: 'shadPS4',   exe: ['shadPS4.exe', 'shadps4'],                  args: '-f true -g "{rom}"', consoles: ['PS4'] },
  flycast:   { name: 'Flycast',   exe: ['flycast.exe', 'flycast'],                  args: '"{rom}"',      consoles: ['DREAMCAST'] },
  mgba:      { name: 'mGBA',      exe: ['mGBA.exe', 'mgba-qt', 'mgba'],             args: '-f "{rom}"',   consoles: ['GBA', 'GB'] },
  // Placés avant ares : prioritaires pour leur console.
  gopher64:  { name: 'gopher64',  exe: ['gopher64.exe', 'gopher64'],                args: '-f "{rom}"',   consoles: ['N64'] },
  mesen:     { name: 'MesenCE',   exe: ['Mesen.exe', 'Mesen'],                      args: '"{rom}" --fullscreen', consoles: ['NES'] },
  ares:      { name: 'ares',      exe: ['ares.exe', 'ares'],                        args: '--fullscreen "{rom}"', consoles: ['N64', 'SNES', 'NES', 'MEGADRIVE'],
               argsByConsole: {
                 N64: '--fullscreen --system "Nintendo 64" "{rom}"',
                 SNES: '--fullscreen --system "Super Famicom" "{rom}"',
                 NES: '--fullscreen --system "Famicom" "{rom}"',
                 MEGADRIVE: '--fullscreen --system "Mega Drive" "{rom}"'
               } },
  retroarch: { name: 'RetroArch', exe: ['retroarch.exe', 'retroarch'],              args: '-f -L "{core}" "{rom}"', consoles: [] }
};

// Core RetroArch par défaut pour les consoles rétro.
const RETROARCH_CORES = {
  N64: 'mupen64plus_next_libretro',
  GBA: 'mgba_libretro',
  GB: 'gambatte_libretro',
  SNES: 'snes9x_libretro',
  NES: 'mesen_libretro',
  MEGADRIVE: 'genesis_plus_gx_libretro',
  PS1: 'swanstation_libretro'
};

// Cherche les exécutables connus dans un dossier (jusqu'à 3 niveaux).
function detectEmulators(rootDir) {
  const found = {};
  const wanted = new Map();
  for (const [key, emu] of Object.entries(KNOWN_EMULATORS)) {
    for (const exe of emu.exe) wanted.set(exe.toLowerCase(), key);
  }
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else {
        const key = wanted.get(e.name.toLowerCase());
        if (key && !found[key]) found[key] = full;
      }
    }
  };
  walk(rootDir, 0);
  return found;
}

// Construit une config console -> émulateur à partir des exécutables trouvés.
function buildDefaultMapping(found) {
  const mapping = {};
  // Parcours dans l'ordre de KNOWN_EMULATORS : le premier émulateur d'une console gagne.
  for (const [key, emu] of Object.entries(KNOWN_EMULATORS)) {
    const exePath = found[key];
    if (!exePath) continue;
    for (const consoleId of emu.consoles) {
      if (mapping[consoleId]) continue;
      const args = (emu.argsByConsole && emu.argsByConsole[consoleId]) || emu.args;
      mapping[consoleId] = { emulator: key, exe: exePath, args };
    }
  }
  if (found.retroarch) {
    const coresDir = path.join(path.dirname(found.retroarch), 'cores');
    const ext = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so';
    for (const [consoleId, core] of Object.entries(RETROARCH_CORES)) {
      if (mapping[consoleId]) continue; // un émulateur dédié passe avant
      mapping[consoleId] = {
        emulator: 'retroarch',
        exe: found.retroarch,
        args: KNOWN_EMULATORS.retroarch.args,
        core: path.join(coresDir, core + ext)
      };
    }
  }
  return mapping;
}

// Découpe une chaîne d'arguments en respectant les guillemets.
function parseArgs(template, vars) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    out.push(raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : /^(nup|nsp|xci|xcz|nsz|iso|game|file|path)$/i.test(k) ? (vars.rom || '') : '')));
  }
  return out;
}

function checkSetup(setup) {
  if (!setup || !setup.exe) return 'Aucun émulateur configuré pour cette console.';
  if (!fs.existsSync(setup.exe)) return `Émulateur introuvable : ${setup.exe}`;
  if (setup.emulator === 'retroarch' && setup.core && !fs.existsSync(setup.core)) {
    return `Core RetroArch manquant : ${path.basename(setup.core)} (installe-le depuis RetroArch > Mise à jour en ligne).`;
  }
  return null;
}

// Lance le jeu. onExit(durationSec) est appelé à la fermeture de l'émulateur.
function launch(setup, romPath, onExit, env) {
  const err = checkSetup(setup);
  if (err) throw new Error(err);
  const args = parseArgs(setup.args || '"{rom}"', { rom: romPath, core: setup.core || '' });
  const start = Date.now();
  const child = spawn(setup.exe, args, {
    cwd: path.dirname(setup.exe),
    detached: false,
    stdio: 'ignore',
    env: env || process.env,
    windowsHide: false
  });
  child.on('error', e => onExit && onExit(0, e.message));
  child.on('exit', code => onExit && onExit(Math.round((Date.now() - start) / 1000), null, code));
  return child.pid;
}

module.exports = { KNOWN_EMULATORS, RETROARCH_CORES, detectEmulators, buildDefaultMapping, parseArgs, checkSetup, launch };
