// Préréglages en un clic : Performance / Équilibré / Qualité (4K).
// Chaque valeur cible un champ existant de emuschemas.js (sauf `extra`, champs ajoutés ici).
const P = (perf, balanced, quality, common = {}) => ({ perf: { ...common, ...perf }, balanced: { ...common, ...balanced }, quality: { ...common, ...quality } });

const switchLike = P(
  { 'Renderer/resolution_setup': 3, 'Renderer/anti_aliasing': 0, 'Renderer/gpu_accuracy': 0, 'Renderer/max_anisotropy': 0, 'Renderer/use_vsync': 1 },
  { 'Renderer/resolution_setup': 6, 'Renderer/anti_aliasing': 1, 'Renderer/gpu_accuracy': 0, 'Renderer/max_anisotropy': 4, 'Renderer/use_vsync': 1 },
  { 'Renderer/resolution_setup': 6, 'Renderer/anti_aliasing': 2, 'Renderer/gpu_accuracy': 1, 'Renderer/max_anisotropy': 5, 'Renderer/use_vsync': 2 },
  { 'Renderer/backend': 1, 'Renderer/use_asynchronous_shaders': true, 'Renderer/use_disk_shader_cache': true }
);

const PRESETS = {
  eden: switchLike,
  lichii: switchLike,
  azahar: P({ 'Renderer/resolution_factor': 2 }, { 'Renderer/resolution_factor': 5 }, { 'Renderer/resolution_factor': 9 },
    { 'Renderer/graphics_api': 2, 'Renderer/async_shader_compilation': true }),
  melonds: P({ '3D.GL/ScaleFactor': 2 }, { '3D.GL/ScaleFactor': 4 }, { '3D.GL/ScaleFactor': 8 }, { '3D/Renderer': 1 }),
  ppsspp: P({ 'Graphics/InternalResolution': 2 }, { 'Graphics/InternalResolution': 4 }, { 'Graphics/InternalResolution': 8 },
    { 'Graphics/GraphicsBackend': '3 (VULKAN)', 'Graphics/AnisotropyLevel': 4, 'Graphics/FrameSkip': 0 }),
  pcsx2: P({ 'EmuCore/GS/upscale_multiplier': 2 }, { 'EmuCore/GS/upscale_multiplier': 4 }, { 'EmuCore/GS/upscale_multiplier': 6 },
    { 'EmuCore/GS/Renderer': 14 }),
  duckstation: P({ 'GPU/ResolutionScale': 3 }, { 'GPU/ResolutionScale': 5 }, { 'GPU/ResolutionScale': 8 }, { 'GPU/Renderer': 'Vulkan' }),
  rpcs3: P({ 'Video/Resolution Scale': 100 }, { 'Video/Resolution Scale': 200 }, { 'Video/Resolution Scale': 300 }, { 'Video/Renderer': 'Vulkan' }),
  xenia: P({ 'GPU/draw_resolution_scale_x': 1, 'GPU/draw_resolution_scale_y': 1 }, { 'GPU/draw_resolution_scale_x': 2, 'GPU/draw_resolution_scale_y': 2 },
    { 'GPU/draw_resolution_scale_x': 3, 'GPU/draw_resolution_scale_y': 3 }),
  xemu: P({ 'display.quality/surface_scale': 1 }, { 'display.quality/surface_scale': 3 }, { 'display.quality/surface_scale': 4 }, { 'display/renderer': 'VULKAN' }),
  vita3k: P({ '/resolution-multiplier': 1 }, { '/resolution-multiplier': 2 }, { '/resolution-multiplier': 4 }, { '/backend-renderer': 'Vulkan' }),
  flycast: P({ 'config/rend.Resolution': 960 }, { 'config/rend.Resolution': 1440 }, { 'config/rend.Resolution': 2880 }, { 'config/rend.AnisotropicFiltering': 16 }),
  gopher64: P({ 'video/upscale': 2 }, { 'video/upscale': 4 }, { 'video/upscale': 8 })
};

// Options « débridage » natives des émulateurs (pas de mod tiers).
//   key: champ de emuschemas ; on/off: valeurs écrites ; extra: définition si le champ n'est pas dans le schéma
const UNLOCKS = {
  eden: [
    { id: 'nolimit', label: 'Vitesse illimitée', desc: 'Retire la limite de vitesse : utile pour accélérer les passages lents. Les jeux à logique liée aux FPS tournent plus vite.', key: 'Core/use_speed_limit', on: false, off: true }
  ],
  lichii: [
    { id: 'nolimit', label: 'Vitesse illimitée', desc: 'Retire la limite de vitesse.', key: 'Core/use_speed_limit', on: false, off: true }
  ],
  pcsx2: [
    { id: 'ws', label: 'Patchs écran large (16:9)', desc: 'Patchs intégrés à PCSX2, appliqués automatiquement aux jeux compatibles.', key: 'EmuCore/EnableWideScreenPatches', on: true, off: false, extra: { type: 'bool' } },
    { id: 'noint', label: 'Patchs anti-entrelacement', desc: 'Image plus nette sur les jeux compatibles.', key: 'EmuCore/EnableNoInterlacingPatches', on: true, off: false, extra: { type: 'bool' } },
    { id: 'autostate', label: 'Reprendre là où je me suis arrêté', desc: 'Sauvegarde instantanée à la fermeture, rechargée au lancement suivant.', key: 'EmuCore/SaveStateOnShutdown', on: true, off: false, extra: { type: 'bool' } }
  ],
  duckstation: [
    { id: 'ws', label: 'Écran large (hack 16:9)', desc: 'Rendu en 16:9 natif dans la plupart des jeux 3D.', key: 'GPU/WidescreenHack', on: true, off: false },
    { id: 'autostate', label: 'Reprendre là où je me suis arrêté', desc: 'Sauvegarde instantanée à la fermeture.', key: 'Main/SaveStateOnExit', on: true, off: false, extra: { type: 'bool' } }
  ],
  rpcs3: [
    { id: 'nolimit', label: 'Limite d\'images désactivée', desc: 'Utile avec les patchs 60 FPS du gestionnaire de patchs de RPCS3.', key: 'Video/Frame limit', on: 'Off', off: 'Auto' }
  ],
  flycast: [
    { id: 'ws', label: 'Écran large (16:9)', desc: 'Avec les correctifs par jeu de Flycast.', key: 'config/rend.WideScreen', on: true, off: false },
    { id: 'wshack', label: 'Correctifs écran large par jeu', desc: '', key: 'config/rend.WidescreenGameHacks', on: true, off: false }
  ],
  gopher64: [
    { id: 'ws', label: 'Écran large (16:9)', desc: '', key: 'video/widescreen', on: true, off: false }
  ]
};

module.exports = { PRESETS, UNLOCKS };

// Manette Xbox (XInput, via SDL) : correspondance des boutons pour les émulateurs qui ne s'auto-configurent pas.
const sdl = b => `SDL-0/${b}`;
const PS_PAD = {
  Up: sdl('DPadUp'), Right: sdl('DPadRight'), Down: sdl('DPadDown'), Left: sdl('DPadLeft'),
  Triangle: sdl('FaceNorth'), Circle: sdl('FaceEast'), Cross: sdl('FaceSouth'), Square: sdl('FaceWest'),
  Select: sdl('Back'), Start: sdl('Start'), L1: sdl('LeftShoulder'), R1: sdl('RightShoulder'),
  L2: sdl('+LeftTrigger'), R2: sdl('+RightTrigger'), L3: sdl('LeftStick'), R3: sdl('RightStick'),
  LUp: sdl('-LeftY'), LRight: sdl('+LeftX'), LDown: sdl('+LeftY'), LLeft: sdl('-LeftX'),
  RUp: sdl('-RightY'), RRight: sdl('+RightX'), RDown: sdl('+RightY'), RLeft: sdl('-RightX'),
  Analog: sdl('Guide'), LargeMotor: sdl('LargeMotor'), SmallMotor: sdl('SmallMotor')
};
const PADS = {
  pcsx2: { 'InputSources/SDL': 'true', 'Pad1/Type': 'DualShock2', ...Object.fromEntries(Object.entries(PS_PAD).map(([k, v]) => [`Pad1/${k}`, v])) },
  duckstation: { 'InputSources/SDL': 'true', 'Pad1/Type': 'AnalogController', ...Object.fromEntries(Object.entries(PS_PAD).map(([k, v]) => [`Pad1/${k}`, v])) }
};

module.exports.PADS = PADS;
