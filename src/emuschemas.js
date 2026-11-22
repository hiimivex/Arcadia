// Réglages pilotables depuis Arcadia, émulateur par émulateur.
// Toutes les clés, sections, valeurs et emplacements ont été relevés dans le code source de chaque émulateur.
const path = require('path');
const fs = require('fs');

// ---------- petits constructeurs ----------
const sel = (key, label, options, def, extra = {}) => ({ key, label, type: 'select', options, default: def, ...extra });
const bool = (key, label, def, extra = {}) => ({ key, label, type: 'bool', default: def, ...extra });
const int = (key, label, def, min, max, extra = {}) => ({ key, label, type: 'int', default: def, min, max, ...extra });
const slider = (key, label, def, min, max, extra = {}) => ({ key, label, type: 'slider', default: def, min, max, ...extra });
const text = (key, label, def, extra = {}) => ({ key, label, type: 'text', default: def, ...extra });
const list = names => names.map((n, i) => [i, n]);

// ---------- emplacements ----------
// ctx = { exe, exeDir, appData, localAppData, documents }
const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
function firstExisting(cands) { return cands.find(exists) || null; }

// ================================================================ Eden & Lichii (même moteur)
const CPU_CLOCK = list(['Normal', 'Boost', 'Overclock']);
const LANGS = list(['Japonais (日本語)', 'Anglais Américain', 'Français', 'Allemand (Deutsch)', 'Italien (italiano)', 'Espagnol (español)', 'Chinois', 'Coréen (한국어)', 'Néerlandais (Nederlands)', 'Portugais (português)', 'Russe (Русский)', 'Taïwanais', 'Anglais Britannique', 'Français Canadien', 'Espagnol Latino-américain', 'Chinois Simplifié', 'Chinois Traditionnel', 'Portugais Brésilien', 'Polonais (polski)', 'Thaï (แบบไทย)']);
const REGIONS = list(['Japon', 'É.-U.A.', 'Europe', 'Australie', 'Chine', 'Corée', 'Taïwan']);
const TZ = list(['Auto', 'Par défaut', 'CET', 'CST6CDT', 'Cuba', 'EET', 'Égypte', 'Eire', 'EST', 'EST5EDT', 'GB', 'GB-Eire', 'GMT', 'GMT+0', 'GMT-0', 'GMT0', 'Greenwich', 'Hong Kong', 'HST', 'Islande', 'Iran', 'Israël', 'Jamaïque', 'Japon', 'Kwajalein', 'Libye', 'MET', 'MST', 'MST7MDT', 'Navajo', 'NZ', 'NZ-CHAT', 'Pologne', 'Portugal', 'PRC', 'PST8PDT', 'ROC', 'ROK', 'Singapour', 'Turquie', 'UCT', 'Universel', 'UTC', 'W-SU', 'WET', 'Zulu']);
const RES = list(['0.25X (180p/270p) [EXPÉRIMENTAL]', '0.5X (360p/540p) [EXPÉRIMENTAL]', '0.75X (540p/810p) [EXPÉRIMENTAL]', '1X (720p/1080p)', '1.25X (900p/1350p) [EXPÉRIMENTAL]', '1.5X (1080p/1620p) [EXPÉRIMENTAL]', '2X (1440p/2160p)', '3X (2160p/3240p)', '4X (2880p/4320p)', '5X (3600p/5400p)', '6X (4320p/6480p)', '7X (5040p/7560p)', '8X (5760p/8640p)']);

function edenFamily(id, name, dirName, consoles) {
  const R = 'Renderer/', S = 'System/', C = 'Core/', A = 'Audio/', CT = 'Controls/', U = 'UI/';
  const players = [0, 1, 2, 3].flatMap(p => [
    bool(`${CT}player_${p}_connected`, `Joueur ${p + 1} : connecter la manette`, p === 0),
    sel(`${CT}player_${p}_type`, `Joueur ${p + 1} : type de manette`, list(['Manette Switch Pro', 'Deux Joycons', 'Joycon gauche', 'Joycon droit', 'Mode Portable', 'Manette GameCube']), 0)
  ]);
  return {
    id, name, consoles, format: 'qtini',
    files: ctx => {
      const portable = path.join(ctx.exeDir, 'user', 'config', 'qt-config.ini');
      if (exists(path.join(ctx.exeDir, 'user'))) return [portable];
      return [path.join(ctx.appData, dirName, 'config', 'qt-config.ini')];
    },
    dataDir: ctx => exists(path.join(ctx.exeDir, 'user')) ? path.join(ctx.exeDir, 'user') : path.join(ctx.appData, dirName),
    note: `${name} réécrit sa configuration en quittant : ferme-le avant de modifier ces réglages.`,
    pages: [
      { id: 'general', label: 'Général', tabs: [
        { label: 'Général', groups: [{ label: 'Général', fields: [
          bool(`${U}pauseWhenInBackground`, "Pause lorsque la fenêtre n'est pas active", false),
          bool(`${U}hideInactiveMouse`, "Cacher la souris en cas d'inactivité", true),
          bool(`${U}select_user_on_boot`, "Choisir l'utilisateur au démarrage", false),
          bool(`${U}check_for_updates`, 'Rechercher des mises à jour', true)
        ] }] }
      ] },
      { id: 'system', label: 'Système', tabs: [
        { label: 'Système', groups: [
          { label: 'Système', fields: [
            sel(`${S}fast_cpu_time`, 'CPU Clocks', CPU_CLOCK, 0),
            sel(`${S}fast_gpu_time`, 'GPU Clocks', CPU_CLOCK, 1),
            sel(`${S}language_index`, 'Langue', LANGS, 1),
            sel(`${S}region_index`, 'Région', REGIONS, 1),
            sel(`${S}time_zone_index`, 'Fuseau horaire', TZ, 0),
            bool(`${S}custom_rtc_enabled`, 'Date RTC personnalisée', false),
            bool(`${S}rng_seed_enabled`, 'Seed RNG', false),
            text(`${S}device_name`, "Nom de l'appareil", 'Eden')
          ] },
          { label: 'Cœur', fields: [
            bool(`${C}use_multi_core`, 'Émulation CPU Multicœur', true),
            sel(`${C}memory_layout_mode`, 'Disposition de la mémoire', list(['4 GB DRAM (Par défaut)', '6 GB DRAM (Risqué)', '8 GB DRAM', '10 GB DRAM (Risqué)', '12 GB DRAM (Risqué)']), 0),
            bool(`${C}use_speed_limit`, 'Limiter la vitesse en pourcentage', true),
            int(`${C}speed_limit`, 'Limite de vitesse', 100, 0, 9999, { suffix: '%' }),
            int(`${C}slow_speed_limit`, 'Slow Speed', 50, 0, 9999, { suffix: '%' }),
            int(`${C}turbo_speed_limit`, 'Turbo Speed', 200, 0, 9999, { suffix: '%' }),
            bool(`${C}sync_core_speed`, 'Synchroniser la vitesse du noyau', false)
          ] }
        ] }
      ] },
      { id: 'cpu', label: 'CPU', tabs: [
        { label: 'CPU', groups: [{ label: 'Général', fields: [
          sel('Cpu/cpu_accuracy', 'Précision', list(['Auto', 'Précis', 'Risqué', 'Paranoïaque (désactive la plupart des optimisations)', 'Débogage']), 0, { tip: 'Nous recommandons de mettre la précision à « Auto ».' }),
          bool('Cpu/use_custom_cpu_ticks', 'Ticks CPU personnalisés', false),
          int('Cpu/cpu_ticks', 'Ticks CPU', 16000, 77, 65535)
        ] }] }
      ] },
      { id: 'video', label: 'Vidéo', tabs: [
        { label: 'Vidéo', groups: [
          { label: "Paramètres de l'API", fields: [
            sel(`${R}backend`, 'API', [[1, 'Vulkan'], [0, 'OpenGL GLSL'], [3, 'OpenGL GLASM'], [4, 'OpenGL SPIR-V'], [2, 'Null']], 1),
            int(`${R}vulkan_device`, 'Carte graphique (n°)', 0, 0, 8, { tip: '0 = première carte détectée' })
          ] },
          { label: 'Paramètres Vidéo', fields: [
            sel(`${R}resolution_setup`, 'Résolution', RES, 3),
            sel(`${R}use_vsync`, 'Mode VSync', [[0, 'Immediate (VSync désactivée)'], [1, 'Mailbox'], [2, 'FIFO (VSync Activée)'], [3, 'FIFO Relaxed']], 2),
            sel(`${R}scaling_filter`, 'Filtre de fenêtre adaptatif', list(['Plus proche voisin', 'Bilinéaire', 'Bicubique', 'Gaussien', 'Lanczos', 'ScaleForce', 'AMD FidelityFX Super Resolution', 'Area', 'Zero-Tangent', 'B-Spline', 'Mitchell']), 5),
            slider(`${R}fsr_sharpening_slider`, 'Netteté FSR', 25, 0, 200, { suffix: '%' }),
            sel(`${R}aspect_ratio`, 'Format', list(['Par défaut (16:9)', 'Forcer le 4:3', 'Forcer le 21:9', 'Forcer le 16:10', 'Étirer à la fenêtre']), 0),
            sel(`${R}anti_aliasing`, "Méthode d'anticrénelage", list(['Aucun', 'FXAA', 'SMAA']), 1),
            bool(`${R}post_shader_enabled`, 'Effets de post-traitement', true),
            bool(`${R}use_asynchronous_gpu_emulation`, 'Émulation GPU asynchrone', true),
            sel(`${R}fullscreen_mode`, 'Mode Plein écran', [[0, 'Fenêtré sans bordure'], [1, 'Plein écran exclusif']], 0)
          ] }
        ] },
        { label: 'Avancée', groups: [{ label: 'Paramètres Vidéo Avancés', fields: [
          sel(`${R}gpu_accuracy`, 'Mode GPU', [[0, 'Rapide'], [1, 'Précis']], 1),
          sel(`${R}dma_accuracy`, 'Précision du DMA', list(['Par défaut', 'Risqué', 'Sûr']), 0),
          sel(`${R}gpu_fence_behavior`, 'GPU Fence Behavior', list(['Par défaut', 'Immédiat', 'Équilibré', 'Précis']), 0),
          sel(`${R}vram_usage_mode`, "Mode d'utilisation de la VRAM", list(['Conservateur', 'Agressif']), 0),
          sel(`${R}nvdec_emulation`, 'Émulation NVDEC', list(['Pas de sortie vidéo', 'Décodage Vidéo sur le CPU', 'Décodage Vidéo sur le GPU (par défaut)']), 2),
          sel(`${R}max_anisotropy`, 'Filtrage anisotropique', list(['Automatique', 'Par défaut', '2x', '4x', '8x', '16x']), 0),
          sel(`${R}accelerate_astc`, 'Méthode de décodage ASTC', list(['CPU', 'GPU', 'CPU asynchrone']), 1),
          sel(`${R}frame_pacing_mode`, 'Frame Pacing Mode (Vulkan)', list(['Auto', '30 FPS', '60 FPS', '90 FPS', '120 FPS']), 0),
          sel(`${R}astc_recompression`, 'Méthode de recompression ASTC', list(['Non compressé (Meilleure qualité)', 'BC1 (Basse qualité)', 'BC3 (Qualité moyenne)']), 0),
          bool(`${R}sync_memory_operations`, 'Synchroniser les opérations mémoire', false),
          bool(`${R}force_max_clock`, "Forcer la fréquence d'horloge maximale (Vulkan)", false),
          bool(`${R}use_disk_shader_cache`, 'Conserver le cache du rendu graphique', true),
          bool(`${R}use_vulkan_driver_pipeline_cache`, 'Utiliser le cache de pipeline Vulkan', true),
          bool(`${R}use_video_framerate`, "Synchro la fréquence d'image de la relecture vidéo", false),
          bool(`${R}use_reactive_flushing`, 'Activer le Vidage Réactif', true),
          bool(`${R}barrier_feedback_loops`, 'Boucles de rétroaction de barrière', true),
          bool(`${R}enable_buffer_history`, 'Enable buffer history', false)
        ] }] },
        { label: 'Extras', groups: [
          { label: 'Hacks', tip: 'Changer ces options peut causer des problèmes.', fields: [
            bool(`${R}skip_cpu_inner_invalidation`, "Ignorer l'invalidation interne du CPU", false),
            bool(`${R}async_presentation`, 'Activer la présentation asynchrone (Vulkan)', false),
            bool(`${R}fix_bloom_effects`, 'Fix bloom effects', false),
            bool(`${R}use_asynchronous_shaders`, 'Activer la compilation asynchrone des shaders', false),
            sel(`${R}gpu_unswizzle_texture_size`, 'GPU Unswizzle Max Texture Size', list(['Très petit (32 Mo)', 'Petit (64 Mo)', 'Normal (128 Mo)', 'Large (256 Mo)', 'Très large (512 Mo)']), 3),
            sel(`${R}gpu_unswizzle_stream_size`, 'GPU Unswizzle Stream Size', list(['Très bas (4 Mo)', 'Bas (8 Mo)', 'Normal (16 Mo)', 'Moyen (32 Mo)', 'Élevé (64 Mo)']), 3),
            sel(`${R}gpu_unswizzle_chunk_size`, 'GPU Unswizzle Chunk Size', list(['Très bas (32)', 'Bas (64)', 'Normal (128)', 'Moyen (256)', 'Élevé (512)']), 3),
            bool(`${R}gpu_unswizzle_enabled`, 'GPU Unswizzle', false)
          ] },
          { label: 'Vulkan Extensions', fields: [
            sel(`${R}dyna_state`, 'État dynamique étendu', list(['Désactivé', 'État dynamique étendu 1', 'État dynamique étendu 2', 'État dynamique étendu 3']), 2),
            slider(`${R}sample_shading_fraction`, 'Échantillonnage de shading', 0, 0, 100, { suffix: '%' }),
            bool(`${R}vertex_input_dynamic_state`, 'Vertex Input Dynamic State', true)
          ] }
        ] }
      ] },
      { id: 'audio', label: 'Son', tabs: [
        { label: 'Audio', groups: [{ label: 'Audio', fields: [
          sel(`${S}sound_index`, 'Mode de sortie sonore', list(['Mono', 'Stéréo', 'Surround']), 1),
          slider(`${A}volume`, 'Volume', 100, 0, 200, { suffix: '%' }),
          bool(`${A}audio_muted`, 'Couper le son', false),
          bool(`${A}muteWhenInBackground`, 'Couper le son en arrière-plan', false)
        ] }] }
      ] },
      { id: 'controls', label: 'Contrôles', tabs: [
        { label: 'Manettes', groups: [
          { label: 'Mode console', fields: [
            sel(`${S}use_docked_mode`, 'Mode console', [[1, 'Mode TV'], [0, 'Mode Portable']], 1),
            bool(`${CT}vibration_enabled`, 'Vibration', true),
            bool(`${CT}motion_enabled`, 'Mouvement', true),
            bool(`${CT}mouse_panning`, 'Panoramique de la souris', false),
            bool(`${CT}enable_joycon_driver`, 'Pilote Joy-Con intégré', true),
            bool(`${CT}enable_procon_driver`, 'Pilote Manette Pro intégré', false)
          ] },
          { label: 'Joueurs', fields: players }
        ], footer: `L'assignation touche par touche se fait dans ${name} : bouton « Ouvrir ${name} » dans Outils.` }
      ] },
      { id: 'tools', label: 'Outils', tools: [
        { id: 'keys', label: 'Installer les clés de déchiffrement…', desc: 'Copie prod.keys (+ title.keys et key_retail.bin s\'ils sont à côté) dans le dossier keys.' },
        { id: 'firmware', label: 'Installer le Firmware…', desc: 'Dossier ou .zip contenant les fichiers .nca. L\'ancien firmware est gardé dans registered.old.' },
        { id: 'openData', label: `Ouvrir le dossier de ${name}`, desc: 'Sauvegardes, clés, NAND, shaders…' },
        { id: 'openEmu', label: `Ouvrir ${name}`, desc: 'Pour l\'assignation des touches, les amiibo, le multijoueur.' }
      ] }
    ]
  };
}

// ================================================================ autres émulateurs (réglages essentiels)
const SCHEMAS = [
  edenFamily('eden', 'Eden', 'eden', ['SWITCH']),
  edenFamily('lichii', 'Lichii', 'lichii', ['SWITCH 2']),

  { id: 'azahar', name: 'Azahar', consoles: ['3DS'], format: 'qtini',
    files: ctx => [exists(path.join(ctx.exeDir, 'user')) ? path.join(ctx.exeDir, 'user', 'config', 'qt-config.ini') : path.join(ctx.appData, 'Azahar', 'config', 'qt-config.ini')],
    note: 'Azahar réécrit sa configuration en quittant : ferme-le avant de modifier ces réglages.',
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Vidéo', fields: [
        sel('Renderer/graphics_api', 'API', [[2, 'Vulkan'], [1, 'OpenGL'], [0, 'Logiciel']], 1),
        sel('Renderer/resolution_factor', 'Résolution interne', [[0, 'Auto (taille de la fenêtre)'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [n, `${n}x (${400 * n}×${240 * n})`])], 1),
        bool('Renderer/use_vsync', 'VSync', true),
        sel('Renderer/texture_filter', 'Filtre de textures', list(['Aucun', 'Anime4K', 'Bicubique', 'ScaleForce', 'xBRZ', 'MMPX']), 0),
        bool('Renderer/filter_mode', 'Filtrage linéaire', true),
        bool('Renderer/async_shader_compilation', 'Compilation asynchrone des shaders', false)
      ] },
      { label: 'Écrans', fields: [
        sel('Layout/layout_option', 'Disposition', list(['Par défaut', 'Un seul écran', 'Grand écran', 'Côte à côte', 'Fenêtres séparées', 'Hybride', 'Personnalisée']), 0),
        bool('Layout/swap_screen', 'Inverser les écrans', false)
      ] },
      { label: 'Système & son', fields: [
        bool('System/is_new_3ds', 'Mode New 3DS', true),
        int('Core/cpu_clock_percentage', 'Horloge CPU', 100, 5, 400, { suffix: '%' }),
        slider('Audio/volume', 'Volume', 100, 0, 100, { suffix: '%', decode: v => Math.round(Number(v) * 100), encode: v => String(Number(v) / 100) })
      ] }
    ] }] }] },

  { id: 'melonds', name: 'melonDS', consoles: ['DS'], format: 'toml',
    files: ctx => [exists(path.join(ctx.exeDir, 'portable')) ? path.join(ctx.exeDir, 'portable', 'melonDS.toml') : path.join(ctx.exeDir, 'melonDS.toml'), path.join(ctx.appData, 'melonDS', 'melonDS.toml')],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Vidéo & son', groups: [
      { label: 'Rendu 3D', fields: [
        sel('3D/Renderer', 'Moteur de rendu', list(['Logiciel', 'OpenGL', 'OpenGL (compute)']), 0),
        sel('3D.GL/ScaleFactor', 'Échelle de rendu OpenGL', [1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, `${n}x`]), 1),
        bool('3D.GL/BetterPolygons', 'Meilleurs polygones', false),
        bool('3D.Soft/Threaded', 'Rendu logiciel multithread', true)
      ] },
      { label: 'Écran', fields: [
        bool('Screen/VSync', 'VSync', false),
        bool('Screen/Filter', "Filtrage de l'écran", true),
        sel('Instance0.Window0/ScreenLayout', 'Disposition des écrans', list(['Naturelle', 'Verticale', 'Horizontale', 'Hybride']), 0),
        sel('Instance0.Window0/ScreenSizing', 'Taille des écrans', list(['Égale', 'Haut agrandi', 'Bas agrandi', 'Auto', 'Haut seul', 'Bas seul']), 0),
        bool('Instance0.Window0/ScreenSwap', 'Inverser les écrans', false),
        bool('Instance0.Window0/IntegerScaling', 'Mise à l\'échelle entière', false)
      ] },
      { label: 'Console & son', fields: [
        sel('Emu/ConsoleType', 'Console', [[0, 'Nintendo DS'], [1, 'Nintendo DSi']], 0),
        slider('Instance0.Audio/Volume', 'Volume', 256, 0, 256)
      ] }
    ] }] }] },

  { id: 'ppsspp', name: 'PPSSPP', consoles: ['PSP'], format: 'ini',
    files: ctx => [
      ...(exists(path.join(ctx.exeDir, 'installed.txt')) ? [] : [path.join(ctx.exeDir, 'memstick', 'PSP', 'SYSTEM', 'ppsspp.ini')]),
      path.join(ctx.documents, 'PPSSPP', 'PSP', 'SYSTEM', 'ppsspp.ini')
    ],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('Graphics/GraphicsBackend', 'Moteur de rendu', [['3 (VULKAN)', 'Vulkan'], ['2 (DIRECT3D11)', 'Direct3D 11'], ['0 (OPENGL)', 'OpenGL']], '3 (VULKAN)', { decode: v => ({ 3: '3 (VULKAN)', 2: '2 (DIRECT3D11)', 0: '0 (OPENGL)' })[parseInt(v, 10)] || v }),
        sel('Graphics/InternalResolution', 'Résolution interne', [[0, 'Auto (1:1)'], ...[1, 2, 3, 4, 5, 6, 8, 10].map(n => [n, `${n}x PSP (${480 * n}×${272 * n})`])], 0),
        bool('Graphics/VerticalSync', 'VSync', true),
        bool('Graphics/FullScreen', 'Plein écran', false),
        sel('Graphics/FrameSkip', 'Saut d\'images', [[0, 'Désactivé'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], 0),
        sel('Graphics/AnisotropyLevel', 'Filtrage anisotrope', [[0, 'Désactivé'], [1, '2x'], [2, '4x'], [3, '8x'], [4, '16x']], 4),
        sel('Graphics/TexScalingLevel', 'Agrandissement des textures', [[1, 'Désactivé'], [2, '2x'], [3, '3x'], [4, '4x'], [5, '5x']], 1),
        bool('DisplayLayout.Landscape/DisplayStretch', "Étirer l'image", false)
      ] },
      { label: 'Son', fields: [slider('Sound/GameVolume', 'Volume du jeu', 100, 0, 100, { suffix: '%' })] }
    ] }] }] },

  { id: 'pcsx2', name: 'PCSX2', consoles: ['PS2'], format: 'ini',
    files: ctx => [
      ...(exists(path.join(ctx.exeDir, 'portable.ini')) || exists(path.join(ctx.exeDir, 'portable.txt')) ? [path.join(ctx.exeDir, 'inis', 'PCSX2.ini')] : []),
      path.join(ctx.documents, 'PCSX2', 'inis', 'PCSX2.ini')
    ],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('EmuCore/GS/Renderer', 'Moteur de rendu', [[-1, 'Automatique'], [14, 'Vulkan'], [15, 'Direct3D 12'], [3, 'Direct3D 11'], [12, 'OpenGL'], [13, 'Logiciel']], -1),
        sel('EmuCore/GS/upscale_multiplier', 'Résolution interne', [[1, 'Native (PS2)'], [2, '2x (~720p)'], [3, '3x (~1080p)'], [4, '4x (~1440p)'], [5, '5x (~1620p)'], [6, '6x (~2160p / 4K)'], [8, '8x (~2880p)']], 1, { decode: v => Math.round(Number(v)) || 1 }),
        sel('EmuCore/GS/AspectRatio', 'Format', [['Auto 4:3/3:2', 'Auto 4:3/3:2'], ['4:3', '4:3'], ['16:9', '16:9'], ['10:7', '10:7'], ['Stretch', 'Étirer']], 'Auto 4:3/3:2'),
        bool('EmuCore/GS/VsyncEnable', 'VSync', false)
      ] },
      { label: 'Interface & son', fields: [
        bool('UI/StartFullscreen', 'Démarrer en plein écran', false),
        slider('SPU2/Output/StandardVolume', 'Volume', 100, 0, 200, { suffix: '%' })
      ] }
    ] }] }] },

  { id: 'duckstation', name: 'DuckStation', consoles: ['PS1'], format: 'ini',
    files: ctx => [path.join(ctx.exeDir, 'settings.ini'), path.join(ctx.documents, 'DuckStation', 'settings.ini'), path.join(ctx.localAppData, 'DuckStation', 'settings.ini')],
    pickExisting: true,
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('GPU/Renderer', 'Moteur de rendu', [['Automatic', 'Automatique'], ['Vulkan', 'Vulkan'], ['D3D12', 'Direct3D 12'], ['D3D11', 'Direct3D 11'], ['OpenGL', 'OpenGL'], ['Software', 'Logiciel']], 'Automatic'),
        sel('GPU/ResolutionScale', 'Résolution interne', [1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map(n => [n, n === 1 ? '1x (natif)' : `${n}x`]), 1),
        sel('GPU/TextureFilter', 'Filtrage des textures', [['Nearest', 'Plus proche voisin'], ['Bilinear', 'Bilinéaire'], ['JINC2', 'JINC2'], ['xBR', 'xBR']], 'Nearest'),
        bool('GPU/PGXPEnable', 'PGXP (corrige la géométrie tremblante)', false),
        bool('GPU/WidescreenHack', 'Rendu grand écran (hack)', false),
        sel('Display/AspectRatio', 'Format', [['Auto (Game Native)', 'Auto (natif du jeu)'], ['4:3', '4:3'], ['16:9', '16:9'], ['Stretch To Fill', 'Étirer'], ['PAR 1:1', 'Pixels carrés']], 'Auto (Game Native)'),
        bool('Display/VSync', 'VSync', false)
      ] },
      { label: 'Interface & son', fields: [
        bool('Main/StartFullscreen', 'Démarrer en plein écran', false),
        slider('Audio/OutputVolume', 'Volume', 100, 0, 100, { suffix: '%' })
      ] }
    ] }] }] },

  { id: 'rpcs3', name: 'RPCS3', consoles: ['PS3'], format: 'yaml',
    files: ctx => [path.join(ctx.exeDir, 'config', 'config.yml')],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Vidéo', fields: [
        sel('Video/Renderer', 'Moteur de rendu', [['Vulkan', 'Vulkan'], ['OpenGL', 'OpenGL'], ['Null', 'Aucun']], 'Vulkan'),
        sel('Video/Resolution Scale', 'Échelle de résolution', [50, 100, 150, 200, 250, 300, 400].map(n => [n, `${n}%`]), 100),
        sel('Video/Aspect ratio', 'Format', [['16:9', '16:9'], ['4:3', '4:3']], '16:9'),
        sel('Video/Frame limit', 'Limite d\'images', [['Auto', 'Auto'], ['Off', 'Désactivée'], ['30', '30'], ['50', '50'], ['60', '60'], ['120', '120'], ['Display', 'Fréquence de l\'écran']], 'Auto')
      ] },
      { label: 'Son & interface', fields: [
        slider('Audio/Master Volume', 'Volume', 100, 0, 200, { suffix: '%' }),
        bool('Miscellaneous/Start games in fullscreen mode', 'Démarrer les jeux en plein écran', true)
      ] }
    ] }] }] },

  { id: 'cemu', name: 'Cemu', consoles: ['WIIU'], format: 'xml',
    files: ctx => [path.join(ctx.exeDir, 'portable', 'settings.xml'), path.join(ctx.exeDir, 'settings.xml'), path.join(ctx.appData, 'Cemu', 'settings.xml')],
    pickExisting: true,
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('Graphic/api', 'API', [[1, 'Vulkan'], [0, 'OpenGL']], 1),
        sel('Graphic/VSync', 'VSync', [[0, 'Désactivée'], [1, 'Double tampon'], [2, 'Triple tampon'], [3, "Caler sur l'écran émulé"]], 0),
        sel('Graphic/UpscaleFilter', "Filtre d'agrandissement", list(['Bilinéaire', 'Bicubique', 'Hermite bicubique', 'Plus proche voisin']), 2),
        sel('Graphic/FullscreenScaling', 'Plein écran', [[0, 'Garder les proportions'], [1, 'Étirer']], 0),
        bool('Graphic/AsyncCompile', 'Compilation asynchrone des shaders', true)
      ] },
      { label: 'Son', fields: [slider('Audio/TVVolume', 'Volume TV', 20, 0, 100, { suffix: '%' })] }
    ] }] }] },

  { id: 'xenia', name: 'Xenia Canary', consoles: ['XBOX360'], format: 'toml',
    files: ctx => [path.join(ctx.exeDir, 'xenia-canary.config.toml')],
    note: 'Xenia crée ce fichier à son premier lancement.',
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('GPU/gpu', 'API', [['any', 'Automatique'], ['d3d12', 'Direct3D 12'], ['vulkan', 'Vulkan']], 'any'),
        sel('GPU/draw_resolution_scale_x', 'Échelle de rendu (horizontale)', [1, 2, 3].map(n => [n, `${n}x`]), 1),
        sel('GPU/draw_resolution_scale_y', 'Échelle de rendu (verticale)', [1, 2, 3].map(n => [n, `${n}x`]), 1),
        bool('GPU/vsync', 'VSync', true),
        int('GPU/framerate_limit', 'Limite d\'images (0 = illimitée)', 0, 0, 240),
        bool('Display/fullscreen', 'Démarrer en plein écran', false)
      ] },
      { label: 'Son', fields: [bool('APU/mute', 'Couper le son', false)] }
    ] }] }] },

  { id: 'xemu', name: 'xemu', consoles: ['XBOX'], format: 'toml',
    files: ctx => [path.join(ctx.exeDir, 'xemu.toml'), path.join(ctx.appData, 'xemu', 'xemu', 'xemu.toml')],
    pickExisting: true,
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Affichage', fields: [
        sel('display/renderer', 'Moteur de rendu', [['VULKAN', 'Vulkan'], ['OPENGL', 'OpenGL'], ['NULL', 'Aucun']], 'OPENGL'),
        sel('display.quality/surface_scale', 'Échelle de rendu', [1, 2, 3, 4, 5, 6, 8, 10].map(n => [n, `${n}x`]), 1),
        sel('display/filtering', 'Filtrage', [['linear', 'Linéaire'], ['nearest', 'Plus proche voisin']], 'linear'),
        bool('display.window/fullscreen_on_startup', 'Démarrer en plein écran', false),
        bool('display.window/vsync', 'VSync', true)
      ] },
      { label: 'Son', fields: [slider('audio/volume_limit', 'Volume', 100, 0, 100, { suffix: '%', decode: v => Math.round(Number(v) * 100), encode: v => ({ raw: (Number(v) / 100).toFixed(2) }) })] }
    ] }] }] },

  { id: 'vita3k', name: 'Vita3K', consoles: ['PSVITA'], format: 'yaml',
    files: ctx => [path.join(ctx.exeDir, 'portable', 'config.yml'), path.join(ctx.exeDir, 'config.yml'), path.join(ctx.appData, 'Vita3K', 'Vita3K', 'config.yml')],
    pickExisting: true,
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('/backend-renderer', 'Moteur de rendu', [['Vulkan', 'Vulkan'], ['OpenGL', 'OpenGL']], 'Vulkan'),
        sel('/resolution-multiplier', 'Résolution interne', [[0.5, '0.5x'], [1, '1x (natif)'], [1.5, '1.5x'], [2, '2x'], [3, '3x'], [4, '4x']], 1, { decode: v => Number(v) }),
        sel('/screen-filter', 'Filtre', [['Bilinear', 'Bilinéaire'], ['Nearest', 'Plus proche voisin'], ['Bicubic', 'Bicubique'], ['FXAA', 'FXAA'], ['FSR', 'AMD FSR']], 'Bilinear'),
        bool('/v-sync', 'VSync', true)
      ] },
      { label: 'Son', fields: [slider('/audio-volume', 'Volume', 100, 0, 100, { suffix: '%' })] }
    ] }] }] },

  { id: 'shadps4', name: 'shadPS4', consoles: ['PS4'], format: 'json',
    files: ctx => [path.join(ctx.exeDir, 'user', 'config.json'), path.join(ctx.appData, 'shadPS4', 'config.json')],
    pickExisting: true,
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        bool('GPU/full_screen', 'Plein écran', false),
        bool('GPU/fsr_enabled', 'AMD FSR', false),
        int('GPU/window_width', 'Largeur de la fenêtre', 1280, 640, 7680),
        int('GPU/window_height', 'Hauteur de la fenêtre', 720, 360, 4320),
        sel('GPU/vblank_frequency', 'Fréquence VBlank', [[60, '60 Hz'], [120, '120 Hz'], [144, '144 Hz']], 60)
      ] },
      { label: 'Son', fields: [slider('General/volume_slider', 'Volume', 100, 0, 500, { suffix: '%' })] }
    ] }] }] },

  { id: 'flycast', name: 'Flycast', consoles: ['DREAMCAST'], format: 'ini',
    files: ctx => [path.join(ctx.exeDir, 'emu.cfg')],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Graphismes & son', groups: [
      { label: 'Graphismes', fields: [
        sel('config/pvr.rend', 'Moteur de rendu', [[4, 'Vulkan'], [5, 'Vulkan (OIT)'], [2, 'DirectX 11'], [6, 'DirectX 11 (OIT)'], [0, 'OpenGL'], [3, 'OpenGL (OIT)']], 4),
        sel('config/rend.Resolution', 'Résolution interne', [[480, '480p (natif)'], [960, '960p (2x)'], [1440, '1440p (3x)'], [1920, '1920p (4x)'], [2880, '2880p (6x)']], 480),
        bool('config/rend.WideScreen', 'Grand écran', false),
        bool('config/rend.WidescreenGameHacks', 'Hacks grand écran par jeu', false),
        bool('config/rend.vsync', 'VSync', true),
        sel('config/rend.AnisotropicFiltering', 'Filtrage anisotrope', [[1, 'Désactivé'], [2, '2x'], [4, '4x'], [8, '8x'], [16, '16x']], 1)
      ] },
      { label: 'Son', fields: [slider('config/aica.Volume', 'Volume', 100, 0, 100, { suffix: '%' })] }
    ] }] }] },

  { id: 'mgba', name: 'mGBA', consoles: ['GBA', 'GB'], format: 'ini',
    files: ctx => [
      ...(exists(path.join(ctx.exeDir, 'portable.ini')) ? [path.join(ctx.exeDir, 'config.ini')] : []),
      path.join(ctx.appData, 'mGBA', 'config.ini')
    ],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Affichage & son', groups: [
      { label: 'Affichage', fields: [
        bool('ports.qt/fullscreen', 'Plein écran', false, { boolAs: ['0', '1'] }),
        bool('ports.qt/lockAspectRatio', 'Garder les proportions', true, { boolAs: ['0', '1'] }),
        bool('ports.qt/resampleVideo', 'Lissage bilinéaire', false, { boolAs: ['0', '1'] }),
        bool('ports.qt/interframeBlending', 'Fusion inter-images', false, { boolAs: ['0', '1'] })
      ] },
      { label: 'Son', fields: [slider('ports.qt/volume', 'Volume', 256, 0, 256)] }
    ] }] }] },

  { id: 'ares', name: 'ares', consoles: ['SNES', 'MEGADRIVE', 'N64', 'NES'], format: 'bml',
    files: ctx => [path.join(ctx.exeDir, 'settings.bml'), path.join(ctx.localAppData, 'ares', 'settings.bml'), path.join(ctx.appData, 'ares', 'settings.bml')],
    pickExisting: true,
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Vidéo & son', groups: [
      { label: 'Vidéo', fields: [
        sel('Video/Output', 'Sortie', [['Center', 'Centrée'], ['Scale', 'Agrandie'], ['Stretch', 'Étirée']], 'Scale'),
        bool('Video/Blocking', 'VSync (synchro vidéo)', false),
        bool('Video/Exclusive', 'Plein écran exclusif', false),
        bool('Video/ColorEmulation', 'Émulation des couleurs', true),
        bool('Video/InterframeBlending', 'Fusion inter-images', true),
        bool('Video/Overscan', 'Overscan', false)
      ] },
      { label: 'Son', fields: [
        slider('Audio/Volume', 'Volume', 100, 0, 200, { suffix: '%', decode: v => Math.round(Number(v) * 100), encode: v => (Number(v) / 100).toFixed(2) }),
        bool('Audio/Mute', 'Couper le son', false)
      ] }
    ] }] }] },

  { id: 'gopher64', name: 'gopher64', consoles: ['N64'], format: 'json',
    files: ctx => [
      ...(exists(path.join(ctx.exeDir, 'portable.txt')) ? [path.join(ctx.exeDir, 'portable_data', 'config', 'config.json')] : []),
      path.join(ctx.appData, 'gopher64', 'config.json')
    ],
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Vidéo', groups: [
      { label: 'Vidéo', fields: [
        sel('video/upscale', 'Agrandissement', [[1, '1x (natif)'], [2, '2x'], [4, '4x'], [8, '8x']], 1),
        bool('video/fullscreen', 'Plein écran', false),
        bool('video/widescreen', 'Grand écran (hack)', false),
        bool('video/integer_scaling', 'Mise à l\'échelle entière', false),
        bool('video/ssaa', 'Super-échantillonnage (SSAA)', false),
        bool('video/vsync', 'VSync', true),
        bool('video/crt', 'Effet CRT', false)
      ] },
      { label: 'Émulation', fields: [bool('emulation/overclock', 'Overclock CPU', false)] }
    ] }] }] },

  { id: 'mesen', name: 'MesenCE', consoles: ['NES'], format: 'json',
    files: ctx => [path.join(ctx.exeDir, 'settings.json'), path.join(ctx.documents, 'MesenCE', 'settings.json'), path.join(ctx.documents, 'Mesen2', 'settings.json')],
    pickExisting: true,
    note: 'MesenCE crée ce fichier à son premier lancement.',
    pages: [{ id: 'main', label: 'Réglages', tabs: [{ label: 'Vidéo & son', groups: [
      { label: 'Vidéo', fields: [
        sel('Video/AspectRatio', 'Format', [['NoStretching', 'Sans étirement'], ['Auto', 'Auto'], ['NTSC', 'NTSC'], ['PAL', 'PAL'], ['Standard', 'Standard (4:3)'], ['Widescreen', 'Grand écran (16:9)']], 'NoStretching', {
          decode: v => typeof v === 'number' ? ['NoStretching', 'Auto', 'NTSC', 'PAL', 'Standard', 'Widescreen', 'Custom'][v] : v,
          encodeLike: ['NoStretching', 'Auto', 'NTSC', 'PAL', 'Standard', 'Widescreen', 'Custom']
        }),
        bool('Video/VerticalSync', 'VSync', false),
        bool('Video/UseBilinearInterpolation', 'Lissage bilinéaire', false),
        bool('Video/UseExclusiveFullscreen', 'Plein écran exclusif', false),
        bool('Video/FullscreenForceIntegerScale', 'Échelle entière en plein écran', false)
      ] },
      { label: 'Son', fields: [slider('Audio/MasterVolume', 'Volume', 100, 0, 100, { suffix: '%' })] }
    ] }] }] }
];

// Fichier de config retenu : le premier existant, sinon l'emplacement par défaut (création au besoin).
function resolveFile(schema, ctx) {
  const cands = schema.files(ctx);
  return firstExisting(cands) || cands[0];
}

function allFields(schema) {
  return schema.pages.flatMap(p => (p.tabs || []).flatMap(t => t.groups.flatMap(g => g.fields)));
}

module.exports = { SCHEMAS, resolveFile, allFields };
