// Historique des mises à jour d'Arcadia (affiché dans Paramètres → À propos et après chaque mise à jour)
// type : add = ajout, change = modification, fix = correctif
const CHANGELOG = [
  {
    v: '1.24.0', date: '2026-11-26',
    items: [
      ['add', 'Mises à jour en ligne : Arcadia vérifie GitHub au démarrage puis toutes les 6 h, télécharge la nouvelle version en arrière-plan (empreinte vérifiée) et propose de l\'installer.', 'Online updates: Arcadia checks GitHub at startup and every 6 hours, downloads the new version in the background (checksum verified) and offers to install it.'],
      ['add', 'Bouton « Rechercher des mises à jour » dans Paramètres → À propos, et option « Mises à jour automatiques ».', '"Check for updates" button in Settings → About, and an "Automatic updates" option.'],
      ['add', 'PS1 en écran large 16:9 : patch communautaire DuckStation appliqué tout seul aux jeux qui en ont un (Crash Team Racing, Resident Evil 2…).', 'PS1 in 16:9 widescreen: DuckStation community patch applied automatically to games that have one (Crash Team Racing, Resident Evil 2…).'],
      ['change', 'Jaquettes : titres français reconnus (Pokémon Lune, Rubis Oméga, Professeur Layton…) et abréviations (GTA, MGS, NFS, KH).', 'Covers: French titles recognized (Pokémon Lune, Rubis Oméga, Professeur Layton…) and abbreviations (GTA, MGS, NFS, KH).'],
      ['change', 'Jeux Switch 2 : identifiant 04… reconnu dans le nom du fichier (nom officiel et jaquette).', 'Switch 2 games: 04… title ID recognized in the file name (official name and cover).'],
      ['fix', 'Une suite pouvait prendre la jaquette d\'un autre épisode (« Brain Age » affichait « Brain Age 2 »).', 'A game could get a sequel\'s cover ("Brain Age" showed "Brain Age 2").'],
      ['fix', 'Tailles de fichiers en anglais (KB, MB, GB) dans la version anglaise.', 'File sizes in English units (KB, MB, GB) in the English version.']
    ]
  },
  {
    v: '1.23.1', date: '2026-11-26',
    items: [
      ['add', 'Historique des mises à jour consultable dans Paramètres → À propos, et « Nouveautés » affichées après chaque mise à jour.', 'Update history in Settings → About, and "What\'s new" shown after each update.'],
      ['change', 'Écran de mise à jour : une barre de chargement avance, et à 50 % Arcadia lance l\'installation puis redémarre tout seul.', 'Update screen: a progress bar fills up, and at 50% Arcadia starts the install and restarts on its own.'],
      ['fix', 'Le bouton « Mettre à jour » pouvait rester bloqué sur l\'écran de mise à jour.', 'The "Update" button could get stuck on the update screen.'],
      ['fix', 'Arcadia se ferme désormais à coup sûr avant l\'installation d\'une nouvelle version.', 'Arcadia now always closes before a new version is installed.']
    ]
  },
  {
    v: '1.23.0', date: '2026-11-26',
    items: [
      ['add', 'Version anglaise d\'Arcadia : choix de la langue au premier lancement, puis dans Paramètres → Interface.', 'English version of Arcadia: language choice at first launch, then in Settings → Interface.'],
      ['add', 'Le menu en jeu du moteur Arcadia (calibrage, sauvegardes, notifications) est aussi traduit.', 'The Arcadia engine\'s in-game menu (calibration, saves, notifications) is translated too.'],
      ['change', 'En anglais, la langue automatique des jeux, les fiches Wikipédia et les dates passent en anglais.', 'In English, the games\' automatic language, Wikipedia info and dates switch to English.'],
      ['fix', 'Le bouton ⚙ Paramètres de la barre du haut ne s\'ouvrait plus.', 'The top bar ⚙ Settings button no longer opened.']
    ]
  },
  {
    v: '1.22.0', date: '2026-11-25',
    items: [
      ['add', 'Message de bienvenue au premier lancement (logiciel en développement, lien Discord) et visite guidée en 6 étapes.', 'Welcome message at first launch (software in development, Discord link) and a 6-step guided tour.'],
      ['add', 'Nouveau lien Discord.', 'New Discord link.'],
      ['change', 'Lien GitHub et page du projet mis à jour pour la première version publique.', 'GitHub link and project page updated for the first public release.'],
      ['fix', 'Bugs d\'affichage avec le fond « Transparence (Windows derrière) ».', 'Display glitches with the "Transparency (Windows behind)" background.']
    ]
  },
  {
    v: '1.21.0', date: '2026-11-25',
    items: [
      ['add', 'Réglages vidéo Switch appliqués en direct, sans relancer le jeu (filtre, anticrénelage, format, volume).', 'Switch video settings applied live, without restarting the game (filter, anti-aliasing, aspect, volume).'],
      ['add', 'Souris en jeu Switch : la souris tourne la caméra, clic gauche = ZR, clic droit = ZL.', 'Mouse in Switch games: the mouse turns the camera, left click = ZR, right click = ZL.'],
      ['add', 'Patchs 60 images/s installés automatiquement (Switch, PSP, PS1) quand un patch communautaire existe.', '60 FPS patches installed automatically (Switch, PSP, PS1) when a community patch exists.'],
      ['add', 'Compteur d\'images/s par-dessus le jeu, avec position et taille réglables.', 'FPS counter on top of the game, with adjustable position and size.'],
      ['change', 'Le fond de la bibliothèque reste celui choisi dans Personnaliser, il ne change plus selon le jeu survolé.', 'The library background stays the one chosen in Customize; it no longer changes with the hovered game.'],
      ['change', 'Génération d\'images retirée : elle créait des artefacts même avec NVIDIA.', 'Frame generation removed: it caused artifacts even with NVIDIA.'],
      ['fix', 'Arcadia ne se rouvrait pas après avoir fermé un jeu.', 'Arcadia wouldn\'t reopen after closing a game.'],
      ['fix', 'La souris ne marchait pas en mode clavier ou clavier + manette.', 'The mouse didn\'t work in keyboard or keyboard + controller mode.'],
      ['fix', 'Tuiles vides dans la recherche de fonds d\'écran.', 'Empty tiles in the wallpaper search.']
    ]
  },
  {
    v: '1.20.0', date: '2026-11-24',
    items: [
      ['add', 'Nouveau thème Néon, avec fond d\'écran personnalisé et palette de couleurs automatique.', 'New Neon theme, with a custom wallpaper and automatic color palette.'],
      ['add', 'Page Moteurs, recherche de fonds d\'écran (Wallhaven + Openverse) et menu de reprise de partie avec miniatures.', 'Engines page, wallpaper search (Wallhaven + Openverse) and a resume menu with thumbnails.'],
      ['add', 'Mises à jour détectées toutes seules pendant qu\'Arcadia est ouvert, et bouton « Créer un rapport » pour Discord.', 'Updates detected on their own while Arcadia is open, and a "Create a report" button for Discord.'],
      ['change', 'Mode Canapé ouvert tout seul quand une manette s\'allume.', 'Couch Mode opens on its own when a controller turns on.'],
      ['fix', 'Mario Kart World (.nup) n\'était pas reconnu comme un jeu.', 'Mario Kart World (.nup) wasn\'t recognized as a game.'],
      ['fix', 'Certains DLC étaient comptés comme des jeux en double.', 'Some DLC were counted as duplicate games.']
    ]
  }
];
