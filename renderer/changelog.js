// Historique des mises à jour d'Arcadia (affiché dans Paramètres → À propos et après chaque mise à jour)
// type : add = ajout, change = modification, fix = correctif
const CHANGELOG = [
  {
    v: '1.27.0', date: '2026-11-26',
    items: [
      ['add', 'Mario Kart 8 Deluxe en ligne entre amis : bouton « 🌐 En ligne » sur la page du jeu. Un ami héberge un salon privé (gratuit, sans compte, sans serveur), les autres le rejoignent avec un code d\'invitation. Même Wi-Fi ou par Internet (ouverture automatique du port de la box quand elle le permet). Dans le jeu : « Sans fil local ».', 'Mario Kart 8 Deluxe online with friends: "🌐 Online" button on the game page. One friend hosts a private room (free, no account, no server), the others join with an invite code. Same Wi-Fi or over the Internet (router port opened automatically when possible). In the game: "Local Wireless Play".'],
      ['add', 'Rembobinage dans le moteur Arcadia (PSP, DS, GBA, PS1, SNES…) : maintiens R au clavier, ou Guide + LT à la manette, pour revenir quelques secondes en arrière.', 'Rewind in the Arcadia engine (PSP, DS, GBA, PS1, SNES…): hold R on the keyboard, or Guide + LT on a controller, to go back a few seconds.'],
      ['add', 'Avance rapide maintenue : Guide + RT = ×3 tant que tu appuies (Tab / Guide + RB restent le turbo ×2).', 'Hold-to-fast-forward: Guide + RT = ×3 while held (Tab / Guide + RB stay the ×2 turbo).'],
      ['add', 'Nom du profil Switch au choix : tes jeux Switch ne t\'appellent plus « Eden ». Demandé au premier jeu Switch, modifiable dans Paramètres → Général → Profil de joueur. Tes sauvegardes ne changent pas.', 'Choose your Switch profile name: your Switch games no longer call you "Eden". Asked on your first Switch game, editable in Settings → General → Player profile. Your saves don\'t change.'],
      ['change', 'Menu Échap du moteur Arcadia : la rubrique « Cheat » devient « Rembobinage », avec l\'option pour le désactiver.', 'Arcadia engine Esc menu: the "Cheat" section becomes "Rewind", with an option to turn it off.'],
      ['fix', 'Jeux Switch : l\'identifiant du jeu n\'était plus lu depuis la 1.24.0, ce qui pouvait bloquer l\'actualisation de la bibliothèque.', 'Switch games: the title ID was no longer read since 1.24.0, which could block library refresh.']
    ]
  },
  {
    v: '1.26.0', date: '2026-11-26',
    items: [
      ['change', 'Mises à jour : dès qu\'une nouvelle version est publiée sur GitHub, Arcadia affiche « Mise à jour disponible ». Un clic sur « Mettre à jour » la télécharge (barre de progression réelle), vérifie son empreinte, l\'installe et redémarre Arcadia tout seul.', 'Updates: as soon as a new version is published on GitHub, Arcadia shows "Update available". One click on "Update" downloads it (real progress bar), checks its checksum, installs it and restarts Arcadia on its own.'],
      ['change', 'Plus de téléchargement en arrière-plan sans ton accord.', 'No more background download without your consent.'],
      ['fix', 'La barre de l\'écran de mise à jour était en retard sur le pourcentage affiché.', 'The update screen bar lagged behind the displayed percentage.']
    ]
  },
  {
    v: '1.25.0', date: '2026-11-26',
    items: [
      ['add', 'Glisser-déposer des fichiers système : clés Switch (prod.keys), firmware Switch (dossier, .zip ou .nca), BIOS PS1 / PS2 / Dreamcast / Xbox et firmware PS3 / PS Vita (.PUP) sont reconnus et installés tout seuls dans le bon moteur. Les jeux déposés en même temps sont importés comme d\'habitude.', 'Drag & drop system files: Switch keys (prod.keys), Switch firmware (folder, .zip or .nca), PS1 / PS2 / Dreamcast / Xbox BIOS and PS3 / PS Vita firmware (.PUP) are recognized and installed into the right engine automatically. Games dropped at the same time are imported as usual.'],
      ['add', 'Ligne « Clés et firmware Switch » dans Paramètres → Général → BIOS et firmware des consoles.', '"Switch keys and firmware" row in Settings → General → Console BIOS and firmware.'],
      ['fix', 'Clés, firmware et BIOS trouvés dans un dossier de jeux ne sont plus rangés comme des jeux.', 'Keys, firmware and BIOS found in a games folder are no longer filed as games.']
    ]
  },
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
