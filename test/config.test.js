// Tests du moteur de réglages : chaque format, lecture + écriture + conservation du reste du fichier.
const assert = require('assert');
const { readValues, writeValues } = require('../src/configfiles');
const { SCHEMAS, allFields } = require('../src/emuschemas');
const F = id => allFields(SCHEMAS.find(s => s.id === id));
const pick = (fields, ...keys) => fields.filter(f => keys.includes(f.key));

// ---- Eden (INI Qt avec \default)
const eden = `[Renderer]\r\nbackend\\use_global=true\r\nbackend\\default=true\r\nbackend=1\r\nresolution_setup\\use_global=true\r\nresolution_setup\\default=true\r\nresolution_setup=3\r\nuse_vsync\\default=false\r\nuse_vsync=0\r\n\r\n[System]\r\nlanguage_index\\default=true\r\nlanguage_index=1\r\n`;
let fe = pick(F('eden'), 'Renderer/resolution_setup', 'Renderer/use_vsync', 'System/language_index', 'Audio/volume');
let v = readValues('qtini', eden, fe);
assert.deepStrictEqual(v, { 'Renderer/resolution_setup': 3, 'Renderer/use_vsync': 0, 'System/language_index': 1, 'Audio/volume': 100 });
let out = writeValues('qtini', eden, fe, { 'Renderer/resolution_setup': 6, 'System/language_index': 2, 'Audio/volume': 150 });
assert(out.includes('resolution_setup\\default=false\r\nresolution_setup=6'), 'résolution écrite + \\default=false');
assert(out.includes('language_index\\default=false\r\nlanguage_index=2'));
assert(out.includes('[Audio]\r\nvolume\\default=false\r\nvolume=150'), 'section Audio créée');
assert(out.includes('backend\\use_global=true\r\nbackend\\default=true\r\nbackend=1'), 'le reste est intact');
assert(out.includes('\r\n') && !/[^\r]\n/.test(out), 'fins de ligne Windows conservées');
out = writeValues('qtini', out, fe, { 'Renderer/resolution_setup': 3 });
assert(out.includes('resolution_setup\\default=true\r\nresolution_setup=3'), 'retour à la valeur par défaut');
assert.strictEqual(readValues('qtini', out, fe)['Renderer/resolution_setup'], 3);

// ---- INI avec espaces (PCSX2 / DuckStation)
const pcsx2 = `[UI]\nTheme = Dark\n\n[EmuCore/GS]\nRenderer = -1\nupscale_multiplier = 1.000000\n`;
const fp = F('pcsx2');
v = readValues('ini', pcsx2, fp);
assert.strictEqual(v['EmuCore/GS/Renderer'], -1);
assert.strictEqual(v['EmuCore/GS/upscale_multiplier'], 1);
out = writeValues('ini', pcsx2, fp, { 'EmuCore/GS/Renderer': 14, 'EmuCore/GS/upscale_multiplier': 3, 'UI/StartFullscreen': true });
assert(out.includes('Renderer = 14') && out.includes('upscale_multiplier = 3') && out.includes('StartFullscreen = true') && out.includes('Theme = Dark'));

// ---- mGBA (booléens 0/1)
out = writeValues('ini', '', F('mgba'), { 'ports.qt/fullscreen': true });
assert(out.includes('[ports.qt]') && out.includes('fullscreen=1'));

// ---- TOML (melonDS, xemu, Xenia)
const melon = `[3D]\nRenderer = 0\n\n[3D.GL]\nScaleFactor = 1\n\n[Instance0.Window0]\nScreenLayout = 0\n`;
out = writeValues('toml', melon, F('melonds'), { '3D/Renderer': 1, '3D.GL/ScaleFactor': 4, 'Screen/VSync': true });
assert(out.includes('[3D]\nRenderer = 1') && out.includes('ScaleFactor = 4') && /\[Screen\]\nVSync = true/.test(out));
assert.strictEqual(readValues('toml', out, F('melonds'))['3D.GL/ScaleFactor'], 4);
const xemu = `[display]\nrenderer = 'OPENGL'\n\n[display.window]\nvsync = true # synchro\n\n[audio]\nvolume_limit = 1.0\n`;
out = writeValues('toml', xemu, F('xemu'), { 'display/renderer': 'VULKAN', 'display.window/vsync': false, 'audio/volume_limit': 50 });
assert(out.includes('renderer = "VULKAN"') && out.includes('vsync = false # synchro') && out.includes('volume_limit = 0.50'), out);
assert.strictEqual(readValues('toml', out, F('xemu'))['audio/volume_limit'], 50);
const xenia = `[GPU]\ngpu = "any"                     # Graphics system.\nvsync = true\n`;
out = writeValues('toml', xenia, F('xenia'), { 'GPU/gpu': 'vulkan' });
assert(out.includes('gpu = "vulkan"                     # Graphics system.'), out);

// ---- YAML (RPCS3 imbriqué, Vita3K plat)
const rpcs3 = `Core:\n  PPU Decoder: Recompiler (LLVM)\nVideo:\n  Renderer: Vulkan\n  Resolution Scale: 100\n  Aspect ratio: 16:9\nAudio:\n  Master Volume: 100\n`;
out = writeValues('yaml', rpcs3, F('rpcs3'), { 'Video/Resolution Scale': 200, 'Audio/Master Volume': 80, 'Miscellaneous/Start games in fullscreen mode': false });
assert(out.includes('  Resolution Scale: 200') && out.includes('  Master Volume: 80') && out.includes('Miscellaneous:\n  Start games in fullscreen mode: false') && out.includes('PPU Decoder: Recompiler (LLVM)'));
assert.strictEqual(readValues('yaml', out, F('rpcs3'))['Video/Aspect ratio'], '16:9');
out = writeValues('yaml', 'v-sync: true\nresolution-multiplier: 1\n', F('vita3k'), { '/v-sync': false, '/resolution-multiplier': 2 });
assert(out.includes('v-sync: false') && out.includes('resolution-multiplier: 2'));

// ---- XML (Cemu)
const cemu = `<?xml version="1.0" encoding="UTF-8"?>\n<content>\n    <Graphic>\n        <api>0</api>\n        <VSync>0</VSync>\n    </Graphic>\n</content>\n`;
out = writeValues('xml', cemu, F('cemu'), { 'Graphic/api': 1, 'Audio/TVVolume': 50 });
assert(out.includes('<api>1</api>') && out.includes('<TVVolume>50</TVVolume>') && out.includes('<VSync>0</VSync>'));
assert.strictEqual(readValues('xml', out, F('cemu'))['Graphic/api'], 1);

// ---- JSON (shadPS4, MesenCE avec énumérations numériques)
out = writeValues('json', JSON.stringify({ GPU: { full_screen: false, other: 1 }, General: {} }, null, 4), F('shadps4'), { 'GPU/full_screen': true });
assert.deepStrictEqual(JSON.parse(out).GPU, { full_screen: true, other: 1 });
out = writeValues('json', JSON.stringify({ Video: { AspectRatio: 0 } }), F('mesen'), { 'Video/AspectRatio': 'Widescreen' });
assert.strictEqual(JSON.parse(out).Video.AspectRatio, 5, 'énumération numérique conservée');
assert.strictEqual(readValues('json', out, F('mesen'))['Video/AspectRatio'], 'Widescreen');

// ---- BML (ares)
const ares = `Video\n  Driver: Direct3D 9.0\n  Output: Scale\nAudio\n  Volume: 1.0\n`;
out = writeValues('bml', ares, F('ares'), { 'Video/Output': 'Stretch', 'Audio/Volume': 50, 'Audio/Mute': true });
assert(out.includes('  Output: Stretch') && out.includes('  Volume: 0.50') && out.includes('  Mute: true') && out.includes('Driver: Direct3D 9.0'));

// ---- tous les schémas : chaque champ a une clé, un libellé, une valeur par défaut valide
for (const s of SCHEMAS) {
  for (const f of allFields(s)) {
    assert(f.key && f.label, `${s.id} : champ incomplet`);
    if (f.type === 'select') assert(f.options.some(o => String(o[0]) === String(f.default)), `${s.id} ${f.key} : défaut ${f.default} absent des choix`);
  }
}
console.log('OK — moteur de réglages : tous les tests passent.');
