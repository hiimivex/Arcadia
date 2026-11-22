// Installation propre des émulateurs dans <Arcadia>\emu\<Nom>, depuis leurs pages officielles GitHub.
// Toujours la dernière version stable (pas de version de test).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// asset : nom du fichier Windows 64 bits dans la release. page : site officiel si pas de téléchargement direct.
const SOURCES = {
  eden:        { page: 'https://eden-emu.dev', why: 'téléchargement uniquement sur le site officiel' },
  lichii:      { repo: 'zortos293/Lichii', asset: /^lichii-windows-x86_64\.zip$/i },
  ppsspp:      { repo: 'hrydgard/ppsspp', asset: /-Windows-x64\.zip$/i },
  azahar:      { repo: 'azahar-emu/azahar', asset: /^azahar-windows-msvc-[\d.]+\.zip$/i },
  melonds:     { repo: 'melonDS-emu/melonDS', asset: /windows-x86_64\.zip$/i },
  pcsx2:       { repo: 'PCSX2/pcsx2', asset: /windows-x64-Qt\.7z$/i },
  duckstation: { repo: 'stenzek/duckstation', asset: /^duckstation-windows-x64-release\.zip$/i },
  dolphin:     { page: 'https://dolphin-emu.org/download/', why: 'téléchargement uniquement sur le site officiel' },
  rpcs3:       { repo: 'RPCS3/rpcs3-binaries-win', asset: /_win64.*\.7z$/i },
  cemu:        { repo: 'cemu-project/Cemu', asset: /windows-x64\.zip$/i },
  xenia:       { repo: 'xenia-canary/xenia-canary-releases', asset: /windows.*\.zip$/i },
  xemu:        { repo: 'xemu-project/xemu', asset: /^xemu-[\d.]+-windows-x86_64\.zip$/i },
  vita3k:      { repo: 'Vita3K/Vita3K', asset: /^windows-latest\.zip$/i },
  shadps4:     { repo: 'shadps4-emu/shadPS4', asset: /win64.*\.zip$/i },
  flycast:     { repo: 'flyinghead/flycast', asset: /win64.*\.zip$/i },
  mgba:        { repo: 'mgba-emu/mgba', asset: /win64\.7z$/i },
  gopher64:    { repo: 'gopher64/gopher64', asset: /windows-x86_64\.exe$/i, saveAs: 'gopher64.exe' },
  mesen:       { repo: 'SourMesen/Mesen2', asset: /_Windows\.zip$/i, note: 'nécessite le runtime .NET 8 de Microsoft' },
  ares:        { repo: 'ares-emulator/ares', asset: /^ares-windows-x64\.zip$/i }
};

async function latestAsset(id) {
  const src = SOURCES[id];
  if (!src?.repo) return null;
  const res = await fetch(`https://api.github.com/repos/${src.repo}/releases/latest`, {
    headers: { 'User-Agent': 'Arcadia', Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`GitHub ${src.repo} : HTTP ${res.status}`);
  const rel = await res.json();
  const a = (rel.assets || []).find(x => src.asset.test(x.name));
  if (!a) throw new Error(`Aucun fichier Windows dans la dernière version de ${src.repo}`);
  return { version: rel.tag_name, name: a.name, url: a.browser_download_url, size: a.size };
}

async function download(url, dest, size, onPct) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Arcadia' } });
  if (!res.ok || !res.body) throw new Error(`Téléchargement : HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest + '.part');
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    if (total) onPct(Math.min(99, Math.round(got * 100 / total)));
  }
  await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  await fsp.rename(dest + '.part', dest);
}

// Si l'archive ne contient qu'un dossier, on remonte son contenu d'un niveau : emu\PCSX2\pcsx2-qt.exe
async function flatten(dir) {
  const entries = await fsp.readdir(dir);
  if (entries.length !== 1) return;
  const only = path.join(dir, entries[0]);
  if (!(await fsp.stat(only)).isDirectory()) return;
  for (const e of await fsp.readdir(only)) await fsp.rename(path.join(only, e), path.join(dir, e));
  await fsp.rmdir(only);
}

// -> { dir, version }
async function installEmulator(id, emuRoot, displayName, extract, onProgress) {
  const src = SOURCES[id];
  if (!src?.repo) throw new Error(`${displayName} : ${src?.why || 'pas de téléchargement direct'}`);
  onProgress({ step: 'Recherche de la dernière version…', pct: 0 });
  const asset = await latestAsset(id);
  const dir = path.join(emuRoot, displayName);
  const tmp = path.join(emuRoot, '_telechargements');
  const file = path.join(tmp, asset.name);
  await download(asset.url, file, asset.size, pct => onProgress({ step: `Téléchargement ${asset.version}`, pct: Math.round(pct * 0.8) }));
  await fsp.mkdir(dir, { recursive: true });
  if (src.saveAs) {
    await fsp.rename(file, path.join(dir, src.saveAs));
  } else {
    onProgress({ step: 'Extraction…', pct: 80 });
    await extract(file, dir, pct => onProgress({ step: 'Extraction…', pct: 80 + Math.round(pct * 0.19) }));
    await flatten(dir);
    await fsp.unlink(file).catch(() => {});
  }
  await fsp.rmdir(tmp).catch(() => {});
  fs.writeFileSync(path.join(dir, 'VERSION_ARCADIA.txt'), `${displayName} ${asset.version}\r\nInstallé par Arcadia depuis https://github.com/${src.repo}\r\n`);
  onProgress({ step: 'Terminé', pct: 100 });
  return { dir, version: asset.version };
}

module.exports = { SOURCES, latestAsset, installEmulator };
