/* global arcadia */
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let S = null;                 // état complet renvoyé par le processus principal
let UI = { collapsed: {}, sort: 'title', zoom: 180, consoleFilter: '' };
const BP = { on: false };       // BigPicture
let view = 'home';            // 'home' | 'game'
let selectedId = null;
let collection = null;        // null = tous | 'fav' | id de catégorie (grille filtrée)
const running = new Set();

// ------------------------------------------------------------ utilitaires
const gameById = id => S.games.find(g => g.id === id);
const consoleOf = id => S.consoles.find(c => c.id === id) || { name: id, color: '#3d4450' };
const statOf = id => S.stats[id] || { playtime: 0, plays: 0, lastPlayed: 0 };
const isFav = id => S.favorites.includes(id);
const catsOf = id => S.gameCats[id] || [];
const mediaUrl = p => `media://img/?p=${encodeURIComponent(p)}`;

function fmtTime(sec) {
  if (!sec) return 'Jamais joué';
  if (sec < 60) return "Moins d'une minute";
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;
}
function fmtDate(ms) {
  if (!ms) return 'Jamais';
  const d = new Date(ms), now = new Date();
  const days = Math.floor((now - d) / 864e5);
  if (days === 0 && d.getDate() === now.getDate()) return "Aujourd'hui";
  if (days <= 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtSize(b) {
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toLocaleString('fr-FR', { maximumFractionDigits: i > 1 ? 1 : 0 })} ${u[i]}`;
}
const byTitle = (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true });

let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}

// ------------------------------------------------------------ images
function initials(title) {
  return title.split(/\s+/).filter(w => /^[A-Za-z0-9À-ÿ]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}
function smallIcon(g) {
  const src = g.icon || g.cover;
  if (src) {
    const img = el('img', 'row-ico' + (g.icon && g.pixelIcon ? ' pixel' : ''));
    img.src = mediaUrl(src); img.loading = 'lazy'; img.alt = '';
    return img;
  }
  return el('span', 'row-ico ph', initials(g.title));
}
function bigArt(g) {
  if (g.cover && g.coverSquare) { // icône eShop carrée : fond flouté + icône entière
    const sq = el('div', 'sq-art');
    sq.style.setProperty('--bg', `url("${mediaUrl(g.cover)}")`);
    const img = el('img');
    img.src = mediaUrl(g.cover); img.loading = 'lazy'; img.alt = g.title; img.draggable = false;
    sq.append(img, el('div', 'ph-title', g.title));
    return sq;
  }
  if (g.cover) {
    const img = el('img', 'cover');
    img.src = mediaUrl(g.cover); img.loading = 'lazy'; img.alt = g.title; img.draggable = false;
    return img;
  }
  if (g.icon) { // icône seule (PSP, 3DS…) : elle remplit la carte au lieu de flotter, petite, au milieu
    const ic = el('div', 'sq-art ic-art' + (g.pixelIcon ? ' pixel' : ''));
    ic.style.setProperty('--bg', `url("${mediaUrl(g.icon)}")`);
    const img = el('img');
    img.src = mediaUrl(g.icon); img.loading = 'lazy'; img.alt = g.title; img.draggable = false;
    img.onload = () => { if (img.naturalWidth && img.naturalHeight) ic.classList.toggle('wide', img.naturalWidth / img.naturalHeight > 1.15); };
    ic.append(img, el('div', 'ph-title', g.title));
    return ic;
  }
  const ph = el('div', 'ph-art');
  if (g.icon) {
    const img = el('img', g.pixelIcon ? 'pixel' : '');
    img.src = mediaUrl(g.icon); img.alt = ''; img.draggable = false;
    ph.append(img);
  } else ph.append(el('div', 'ph-letter', initials(g.title)));
  ph.append(el('div', 'ph-title', g.title));
  return ph;
}

// ------------------------------------------------------------ tri & filtres
function sortGames(list, key = UI.sort) {
  const sorters = {
    title: byTitle,
    recent: (a, b) => statOf(b.id).lastPlayed - statOf(a.id).lastPlayed || byTitle(a, b),
    playtime: (a, b) => statOf(b.id).playtime - statOf(a.id).playtime || byTitle(a, b),
    added: (a, b) => b.added - a.added || byTitle(a, b),
    console: (a, b) => a.console.localeCompare(b.console) || byTitle(a, b)
  };
  // Les favoris restent toujours en haut.
  return [...list].sort((a, b) => (isFav(b.id) - isFav(a.id)) || sorters[key](a, b));
}
function filtered() {
  const q = $('#search').value.trim().toLowerCase();
  return S.games.filter(g => !g.patch &&
    (!UI.consoleFilter || g.console === UI.consoleFilter) &&
    (!q || g.title.toLowerCase().includes(q) || g.file.toLowerCase().includes(q) || (g.innerTitle || '').toLowerCase().includes(q)));
}

// ------------------------------------------------------------ colonne de gauche
function section(key, label, list, onLabel) {
  const frag = document.createDocumentFragment();
  const collapsed = !!UI.collapsed[key];
  const head = el('div', 'sec-head' + (collapsed ? ' collapsed' : ''));
  head.dataset.key = key;
  const caret = el('span', 'caret', '▾');
  head.append(caret, el('span', '', label), el('span', 'n', `(${list.length})`));
  head.onclick = e => {
    if (e.target === caret || !onLabel) {
      UI.collapsed[key] = !collapsed;
      arcadia.setUi({ collapsed: UI.collapsed });
      renderSidebar();
    } else onLabel();
  };
  frag.append(head);
  if (!collapsed) for (const g of list) frag.append(rowFor(g));
  return { frag, head };
}
function rowFor(g) {
  const r = el('div', 'row' + (g.id === selectedId && view === 'game' ? ' sel' : '') + (running.has(g.id) ? ' running' : ''));
  r.dataset.id = g.id;
  r.append(smallIcon(g), el('span', 'row-name', g.title));
  if (running.has(g.id)) r.append(el('span', 'row-tag', 'EN COURS'));
  return r;
}
function renderSidebar() {
  const list = $('#side-list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  const games = sortGames(filtered(), 'title');
  const favs = games.filter(g => isFav(g.id));
  if (favs.length) list.append(section('fav', '★ Favoris', favs, () => openCollection('fav')).frag);
  for (const c of S.categories) {
    const inCat = games.filter(g => catsOf(g.id).includes(c.id));
    const { frag, head } = section('cat:' + c.id, c.name, inCat, () => openCollection(c.id));
    head.oncontextmenu = e => { e.preventDefault(); categoryMenu(e.clientX, e.clientY, c); };
    list.append(frag);
  }
  list.append(section('all', 'Tous les jeux', games, () => openCollection(null)).frag);
  list.scrollTop = scroll;
}

// ------------------------------------------------------------ accueil
function subtitle(g) {
  const st = statOf(g.id);
  switch (S.settings.cardSubtitle) {
    case 'console': return consoleOf(g.console).name;
    case 'last': return st.lastPlayed ? fmtDate(st.lastPlayed) : 'Jamais joué';
    case 'file': return g.file;
    case 'none': return '';
    default: return st.playtime ? fmtTime(st.playtime) : consoleOf(g.console).name;
  }
}
function listRow(g) {
  const r = el('div', 'lrow' + (g.id === selectedId ? ' sel' : ''));
  r.dataset.id = g.id;
  const src = g.icon || g.cover;
  if (src) { const i = el('img'); i.src = mediaUrl(src); i.loading = 'lazy'; if (g.icon && g.pixelIcon) i.style.imageRendering = 'pixelated'; r.append(i); }
  else r.append(el('div', 'ph', initials(g.title)));
  const st = statOf(g.id);
  r.append(el('div', 'ln', (isFav(g.id) ? '★ ' : '') + g.title), el('div', 'lc', g.console), el('div', 'lc', fmtTime(st.playtime)), el('div', 'lc', fmtDate(st.lastPlayed)));
  return r;
}
function card(g) {
  const c = el('div', 'card' + (g.id === selectedId ? ' sel' : ''));
  c.tabIndex = 0;
  c.style.setProperty('--acc', consoleOf(g.console).color || '#fff');
  c.dataset.id = g.id;
  const art = el('div', 'card-art');
  art.append(bigArt(g));
  const tag = el('span', 'cons', g.console);
  art.append(tag);
  if (g.broken) { c.classList.add('is-broken'); art.append(el('div', 'broken', '⚠ FICHIER VIDE')); }
  if (isFav(g.id)) art.append(el('span', 'fav', '★'));
  if (running.has(g.id)) art.append(el('div', 'running-badge', 'EN COURS'));
  else {
    const hp = el('div', 'hover-play');
    const b = el('span', '', '▶');
    b.dataset.play = g.id;
    hp.append(b);
    art.append(hp);
  }
  const meta = el('div', 'card-meta');
  meta.append(el('div', 'card-title', g.title));
  meta.append(el('div', 'card-sub', subtitle(g)));
  c.append(art, meta);
  return c;
}
function renderHome() {
  // Joués récemment
  const recent = S.games.filter(g => statOf(g.id).lastPlayed).sort((a, b) => statOf(b.id).lastPlayed - statOf(a.id).lastPlayed).slice(0, 10);
  $('#shelf-recent').classList.toggle('hidden', !recent.length || !!collection || !!$('#search').value);
  const row = $('#recent-row');
  row.replaceChildren();
  for (const g of recent) {
    const r = el('div', 'recent');
    r.dataset.id = g.id;
    const bg = el('div', 'bg');
    if (g.cover || g.icon) bg.style.backgroundImage = `url("${mediaUrl(g.cover || g.icon)}")`;
    else bg.style.background = '#1a1a1a';
    r.append(bg);
    const art = g.cover ? Object.assign(el('img', 'art'), { src: mediaUrl(g.cover) }) : (() => { const a = el('div', 'art'); a.append(bigArt(g)); return a; })();
    r.append(art);
    const info = el('div', 'info');
    info.append(el('div', 't', g.title), el('div', 's', `${fmtDate(statOf(g.id).lastPlayed)} · ${fmtTime(statOf(g.id).playtime)}`));
    r.append(info);
    row.append(r);
  }
  // Grille
  let list = filtered();
  let title = 'Tous les jeux';
  if (collection === 'fav') { list = list.filter(g => isFav(g.id)); title = '★ Favoris'; }
  else if (collection) {
    const c = S.categories.find(x => x.id === collection);
    if (c) { list = list.filter(g => catsOf(g.id).includes(c.id)); title = c.name; } else collection = null;
  }
  if (UI.consoleFilter) title += ` · ${UI.consoleFilter}`;
  $('#grid-title').textContent = title;
  $('#grid-count').textContent = `(${list.length})`;
  const grid = $('#grid');
  grid.replaceChildren();
  const empty = $('#empty');
  if (!list.length) {
    empty.replaceChildren();
    if (!S.games.length) {
      empty.append(el('div', '', 'Ta bibliothèque est vide.'));
      empty.append(el('div', '', 'Glisse tes ROM dans cette fenêtre : elles seront triées et rangées automatiquement dans'));
      empty.append(el('b', '', S.libraryDir));
    } else empty.append(el('div', '', collection ? 'Aucun jeu dans cette catégorie. Clic droit sur un jeu → « Ajouter à ».' : 'Aucun jeu ne correspond.'));
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    const frag = document.createDocumentFragment();
    const isList = S.settings.viewMode === 'list';
    grid.className = isList ? 'list' : 'grid';
    if (isList) {
      const h = el('div', 'lhead');
      ['', 'Jeu', 'Console', 'Temps de jeu', 'Dernière partie'].forEach(t => h.append(el('div', '', t)));
      frag.append(h);
    }
    for (const g of sortGames(list)) frag.append(isList ? listRow(g) : card(g));
    grid.append(frag);
  }
  renderHealth();
  const banner = $('#banner');
  banner.classList.toggle('hidden', !S.loose || !!collection);
  $('#banner-n').textContent = `${S.loose} élément${S.loose > 1 ? 's' : ''}`;
}

// ------------------------------------------------------------ page jeu
function renderGame() {
  const g = gameById(selectedId);
  if (!g) { showHome(); return; }
  const c = consoleOf(g.console);
  const bg = $('#hero-bg');
  bg.style.backgroundImage = g.cover || g.icon ? `url("${mediaUrl(g.cover || g.icon)}")` : '';
  bg.style.backgroundColor = '#111';
  $('#hero-art').replaceChildren(bigArt(g));
  const pill = $('#hero-console');
  pill.textContent = c.name.toUpperCase();

  $('#hero-title').textContent = g.title;
  $('#hero-inner').textContent = g.innerTitle && g.innerTitle.toLowerCase() !== g.title.toLowerCase() ? g.innerTitle : '';
  const st = statOf(g.id);
  $('#g-time').textContent = fmtTime(st.playtime);
  $('#g-last').textContent = fmtDate(st.lastPlayed);
  $('#g-plays').textContent = String(st.plays);
  const fav = $('#g-fav');
  fav.textContent = isFav(g.id) ? '★' : '☆';
  fav.classList.toggle('on', isFav(g.id));
  fav.title = isFav(g.id) ? 'Retirer des favoris' : 'Ajouter aux favoris';
  const gsW = (S.gameSettings || {})[g.id] || {};
  const usesRunner = (S.runnerConsoles || []).includes(g.console) && S.settings.useRunner !== false && (!gsW.emulator || gsW.emulator === 'arcadia');
  const warn = usesRunner ? null : S.status[g.console];
  $('#g-warning').textContent = warn ? `${warn} Ouvre « ⚙ Émulateurs » pour le régler.` : '';
  $('#g-warning').classList.toggle('hidden', !warn);
  const play = $('#g-play');
  play.disabled = !!warn;
  play.classList.toggle('running', running.has(g.id));
  $('#g-play-label').textContent = running.has(g.id) ? 'EN COURS' : 'JOUER';
  // catégories
  const chips = $('#g-cats');
  chips.replaceChildren();
  for (const cid of catsOf(g.id)) {
    const cat = S.categories.find(x => x.id === cid);
    if (!cat) continue;
    const ch = el('span', 'chip', cat.name);
    const x = el('button', '', '×');
    x.title = 'Retirer de cette catégorie';
    x.onclick = async () => { S = await arcadia.toggleCategory(g.id, cid); renderAll(); };
    ch.append(x);
    chips.append(ch);
  }
  const add = el('span', 'chip add', '＋ Ajouter à une catégorie');
  add.onclick = e => { const r = add.getBoundingClientRect(); showCtx(r.left, r.bottom + 4, categoryItems(g)); e.stopPropagation(); };
  chips.append(add);
  // infos
  const gs = (S.gameSettings || {})[g.id] || {};
  const setup = gs.emulator ? { emulator: gs.emulator } : S.mapping[g.console];
  if (usesRunner) $('#g-emu').textContent = 'Arcadia (moteur intégré)' + (gs.emulator ? ' (réglage du jeu)' : '');
  else $('#g-emu').textContent = setup ? (S.emulators[setup.emulator]?.name || setup.emulator || 'Personnalisé') + (gs.emulator ? ' (réglage du jeu)' : '') + (warn && !gs.emulator ? ' (introuvable)' : '') : 'Aucun';
  if (g.broken) { $('#g-warning').textContent = '⚠ Ce fichier semble vide (que des zéros) : copie interrompue ou récupération ratée. Il ne se lancera pas, remplace-le par une copie saine.'; $('#g-warning').classList.remove('hidden'); }
  renderDetails(g);
  renderMulti(g);
  renderSavesPanel(g);
  renderGameSettings(g);
  renderUpdates(g);
  renderMyShots(g);
  $('#g-file').textContent = g.path;
  $('#g-size').textContent = fmtSize(g.size);
  $('#g-added').textContent = new Date(g.added).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ------------------------------------------------------------ navigation
function renderAll() {
  if (!S.libraryDir) {
    $('#welcome').classList.remove('hidden');
    $('#app').classList.add('hidden');
    return;
  }
  $('#welcome').classList.add('hidden');
  $('#app').classList.remove('hidden');
  applySettings();
  renderSidebar();
  if (view === 'game') renderGame(); else if (view !== 'stats') renderHome();
  // premier lancement : choix de la manette (une seule fois, après l'intro)
  if (!S.settings.input && !renderAll.askedPad && !location.hash.includes('overlay')) {
    renderAll.askedPad = true;
    setTimeout(() => { if (!$('#modal').classList.contains('hidden')) return; inputModal(true); }, (window.__introAt ? 600 : 300));
  }
}
function applySettings() {
  const st = S.settings;
  document.body.className = `glow-${st.glow}` + (st.iconSize ? '' : ' no-icons') + (st.showNames ? '' : ' no-names') + (st.showBadges ? '' : ' no-badges') + (st.accentByConsole ? ' accent' : '') + (BP.on ? ' bp-on' : '');
  document.documentElement.style.setProperty('--icon', (st.iconSize || 22) + 'px');
  $('#view-seg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === st.viewMode));
  $('#zoom').classList.toggle('hidden', st.viewMode === 'list');
}
function showHome() {
  view = 'home';
  $('#view-stats').classList.add('hidden');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'home'));
  $('#view-game').classList.add('hidden');
  $('#view-home').classList.remove('hidden');
  $('#nav-home').classList.add('active');
  renderAll();
}
function openGame(id) {
  selectedId = id;
  view = 'game';
  $('#view-stats').classList.add('hidden');
  $('#view-home').classList.add('hidden');
  $('#view-game').classList.remove('hidden');
  $('#nav-home').classList.remove('active');
  $('#main').scrollTop = 0;
  renderAll();
}
function openCollection(key) {
  collection = key;
  showHome();
  $('#main').scrollTop = $('#shelf-recent').classList.contains('hidden') ? 0 : $('#grid').offsetTop - 80;
}

async function play(id, o) {
  const g = gameById(id);
  if (!g) return;
  sfx('launch');
  const newer = o && o.skipResume ? null : await arcadia.savesCheck(id);
  if (newer && await confirmBox('Sauvegarde plus récente trouvée', `Une copie de tes sauvegardes faite sur « ${newer.machine} » le ${newer.date.replace('_', ' à ').replace(/-(\d\d)-(\d\d)$/, 'h$1')} est plus récente que celle de ce PC. La restaurer avant de jouer ? (L'état actuel est copié avant, par sécurité.)`)) {
    const r = await arcadia.savesRestore(id, newer.file);
    toast(r.ok ? `Sauvegarde restaurée (${r.count} fichier(s)).` : r.error, !r.ok);
  }
  const res = await arcadia.launch(id, o);
  if (!res.ok && res.resumePick) { resumeModal(g, res.resumePick.items); return; }
  if (!res.ok && res.needSwitch) { switchKeysModal(g, res.needSwitch); return; }
  if (!res.ok) { toast(res.error, true); if (S.status[g.console]) openSettings(); }
  else toast(`Lancement de ${g.title}…`);
}

// Switch : clés / firmware manquants → l'utilisateur choisit SES fichiers, Arcadia les installe
function switchKeysModal(g, need) {
  openModal(card => {
    card.classList.add('keys-modal');
    card.append(el('h2', '', 'Il manque des fichiers système'));
    card.append(el('p', '', `« ${g.title} » tourne sur un moteur Switch qui a besoin des clés (prod.keys) et du firmware d'une console. Ces fichiers appartiennent à Nintendo : Arcadia ne peut pas les fournir.`));
    const st = el('div', 'keys-status');
    const line = (ok, label) => { const d = el('div', ok ? 'ok' : 'ko'); d.append(el('span', '', ok ? '✓' : '✕'), el('span', '', label)); return d; };
    const paint = n => { st.replaceChildren(line(!n.keys, 'Clés (prod.keys)'), line(!n.firmware, 'Firmware')); };
    paint(need); card.append(st);
    const p = el('p', '');
    p.append(document.createTextNode('Pour savoir comment faire, contacte-moi sur '), discordLink(), document.createTextNode(' : je t\'explique.'));
    card.append(p);
    // déjà en possession de ses fichiers (extraits de sa propre console) : installation en un clic
    const own = el('details', 'keys-own');
    own.append(el('summary', '', 'J\'ai déjà mes propres fichiers'));
    const acts = el('div', 'keys-acts');
    const bk = el('button', 'btn-ghost', 'Choisir mon prod.keys…');
    const bf = el('button', 'btn-ghost', 'Choisir mon firmware…');
    bk.onclick = async () => { const r = await arcadia.switchInstall('keys'); if (r.ok) { need.keys = false; paint(need); toast(r.message); } else if (r.error) toast(r.error, true); done(); };
    bf.onclick = async () => { bf.disabled = true; bf.textContent = 'Installation…'; const r = await arcadia.switchInstall('firmware'); bf.disabled = false; bf.textContent = 'Choisir mon firmware…'; if (r.ok) { need.firmware = false; paint(need); toast(r.message); } else if (r.error) toast(r.error, true); done(); };
    acts.append(bk, bf); own.append(acts); card.append(own);
    const actions = el('div', 'modal-actions');
    const close = el('button', 'btn-ghost', 'Fermer'); close.onclick = closeModal;
    const go = el('button', 'btn-ghost', 'Lancer le jeu'); go.onclick = () => { closeModal(); play(g.id); };
    const dc = el('button', 'btn-white', 'Me contacter sur Discord'); dc.onclick = () => arcadia.openUrl(DISCORD);
    const done = () => { go.classList.toggle('hidden', need.keys || need.firmware); };
    done();
    actions.append(close, go, dc); card.append(actions);
  });
}

// ------------------------------------------------------------ menus contextuels
function closeCtx() { $('#ctx').classList.add('hidden'); }
function buildItems(container, items) {
  for (const it of items) {
    if (it.sep) { container.append(el('div', 'sep')); continue; }
    const d = el('div', 'it' + (it.sub ? ' has-sub' : ''));
    if (it.chk !== undefined) d.append(el('span', 'chk', it.chk ? '✓' : ''));
    d.append(el('span', '', it.label));
    if (it.sub) {
      const sub = el('div', 'sub');
      buildItems(sub, it.sub);
      d.append(sub);
    } else d.onclick = e => { e.stopPropagation(); closeCtx(); it.action && it.action(); };
    container.append(d);
  }
}
function showCtx(x, y, items) {
  const m = $('#ctx');
  m.replaceChildren();
  buildItems(m, items);
  m.classList.remove('hidden');
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - h - 8) + 'px';
  if (x + w + 220 > innerWidth) m.querySelectorAll('.sub').forEach(s => s.classList.add('left'));
}
function categoryItems(g) {
  const items = S.categories.map(c => ({
    label: c.name, chk: catsOf(g.id).includes(c.id),
    action: async () => { S = await arcadia.toggleCategory(g.id, c.id); renderAll(); }
  }));
  if (items.length) items.push({ sep: true });
  items.push({ label: '＋ Nouvelle catégorie…', action: () => newCategory(g.id) });
  return items;
}
function gameMenu(x, y, g) {
  showCtx(x, y, [
    { label: running.has(g.id) ? 'En cours…' : '▶  Jouer', action: () => play(g.id) },
    { sep: true },
    { label: isFav(g.id) ? '★  Retirer des favoris' : '☆  Ajouter aux favoris', action: async () => { S = await arcadia.toggleFavorite(g.id); renderAll(); } },
    { label: 'Ajouter à', sub: categoryItems(g) },
    { sep: true },
    { label: 'Renommer…', action: async () => {
      const name = await prompt('Renommer le jeu', g.title, 'Laisse vide pour revenir au nom du fichier.');
      if (name !== null) { S = await arcadia.rename(g.id, name); renderAll(); }
    } },
    { label: "Changer l'image…", action: async () => { S = await arcadia.setCover(g.id); renderAll(); } },
    { label: "Image automatique", action: async () => { S = await arcadia.resetCover(g.id); renderAll(); toast('Recherche de la jaquette…'); } },
    { label: 'Déplacer vers', sub: S.consoles.filter(c => c.id !== g.console).map(c => ({
      label: `${c.id} — ${c.name}`,
      action: async () => { S = await arcadia.moveTo(g.id, c.id); selectedId = null; showHome(); toast(`${g.title} déplacé vers ${c.id}.`); }
    })) },
    { sep: true },
    { label: 'Créer un raccourci sur le Bureau', action: () => desktopShortcut(g) },
    { label: "Afficher dans l'explorateur", action: () => arcadia.showInFolder(g.id) }
  ]);
}
function categoryMenu(x, y, c) {
  showCtx(x, y, [
    { label: 'Afficher dans la grille', action: () => openCollection(c.id) },
    { label: 'Renommer…', action: async () => {
      const name = await prompt('Renommer la catégorie', c.name);
      if (name) { S = await arcadia.renameCategory(c.id, name); renderAll(); }
    } },
    { label: 'Supprimer la catégorie', action: async () => {
      if (await confirmBox(`Supprimer « ${c.name} » ?`, 'Les jeux ne sont pas supprimés, seulement la catégorie.')) {
        if (collection === c.id) collection = null;
        S = await arcadia.deleteCategory(c.id); renderAll();
      }
    } }
  ]);
}
async function newCategory(gameId) {
  const name = await prompt('Nouvelle catégorie', '', 'Par exemple : « À finir », « Multijoueur », « RPG »…');
  if (name) { S = await arcadia.createCategory(name, gameId); renderAll(); toast(`Catégorie « ${name} » créée.`); }
}

// ------------------------------------------------------------ modales
function openModal(build, wide) {
  const card = $('#modal-card');
  card.className = 'modal-card' + (wide ? ' wide' : '');
  card.replaceChildren();
  build(card);
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
function prompt(title, value = '', hint = '') {
  return new Promise(resolve => {
    openModal(card => {
      card.append(el('h2', '', title));
      if (hint) card.append(el('p', '', hint));
      const input = el('input');
      input.type = 'text'; input.value = value;
      card.append(input);
      const actions = el('div', 'modal-actions');
      const cancel = el('button', 'btn-ghost', 'Annuler');
      const ok = el('button', 'btn-white', 'OK');
      cancel.onclick = () => { closeModal(); resolve(null); };
      ok.onclick = () => { closeModal(); resolve(input.value.trim()); };
      input.onkeydown = e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancel.click(); };
      actions.append(cancel, ok);
      card.append(actions);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  });
}
function confirmBox(title, text) {
  return new Promise(resolve => {
    openModal(card => {
      card.append(el('h2', '', title));
      if (text) card.append(el('p', '', text));
      const actions = el('div', 'modal-actions');
      const no = el('button', 'btn-ghost', 'Annuler');
      const yes = el('button', 'btn-white', 'Confirmer');
      no.onclick = () => { closeModal(); resolve(false); };
      yes.onclick = () => { closeModal(); resolve(true); };
      actions.append(no, yes);
      card.append(actions);
    });
  });
}
function pickConsole(fileName) {
  return new Promise(resolve => {
    openModal(card => {
      card.append(el('h2', '', 'Quelle console ?'));
      card.append(el('p', '', `Je n'arrive pas à deviner la console de « ${fileName} ». Choisis-la :`));
      const hint = el('p', 'muted small'); hint.append(document.createTextNode('Ta console n\'est pas dans la liste ? Contacte-moi sur '));
      const dl = el('a', 'oops-link', 'Discord'); dl.href = '#'; dl.onclick = e => { e.preventDefault(); arcadia.openUrl('https://discord.gg/PKw6MyzzzD'); };
      hint.append(dl, document.createTextNode(' pour que je l\'ajoute.')); card.append(hint);
      const grid = el('div', 'console-grid');
      for (const c of S.consoles) {
        const b = el('button', '', c.id);
        b.title = c.name;
        b.style.setProperty('--c', c.color);
        b.onclick = () => { closeModal(); resolve(c.id); };
        grid.append(b);
      }
      card.append(grid);
      const actions = el('div', 'modal-actions');
      const skip = el('button', 'btn-ghost', 'Ignorer ce fichier');
      skip.onclick = () => { closeModal(); resolve(null); };
      actions.append(skip);
      card.append(actions);
    });
  });
}

// ------------------------------------------------------------ tri automatique de la bibliothèque
async function proposeSort() {
  const items = await arcadia.listLoose();
  if (!items.length) { toast('Rien à trier : tout est déjà rangé.'); S = await arcadia.rescan(); renderAll(); return; }
  openModal(card => {
    card.append(el('h2', '', 'Ta bibliothèque est en vrac'));
    card.append(el('p', '', `J'ai trouvé ${items.length} jeu${items.length > 1 ? 'x' : ''} ou archive${items.length > 1 ? 's' : ''} hors des dossiers de console. Je peux créer les dossiers manquants et tout ranger automatiquement (les archives sont extraites, puis envoyées à la corbeille).`));
    const groups = {};
    for (const it of items) (groups[it.archive ? 'À EXTRAIRE (.zip / .7z / .rar)' : it.console || 'CONSOLE À CHOISIR'] ||= []).push(it);
    const list = el('div', 'sort-list');
    for (const [k, arr] of Object.entries(groups).sort()) {
      const g = el('div', 'sort-group');
      g.append(el('h4', '', `${k} · ${arr.length}`));
      arr.slice(0, 40).forEach(it => g.append(el('div', '', it.rel)));
      if (arr.length > 40) g.append(el('div', '', `… et ${arr.length - 40} autres`));
      list.append(g);
    }
    card.append(list);
    const actions = el('div', 'modal-actions');
    const later = el('button', 'btn-ghost', 'Plus tard');
    const go = el('button', 'btn-white', 'Créer les dossiers et trier');
    later.onclick = closeModal;
    go.onclick = () => { closeModal(); startImport(null, () => arcadia.sortLibrary()); };
    actions.append(later, go);
    card.append(actions);
  }, true);
}

// ------------------------------------------------------------ fenêtre Paramètres
const SET = { section: 'general', emu: null, page: 0, tab: 0, pending: {}, emus: [] };

function toggleEl(on, onChange) {
  const t = el('button', 'toggle' + (on ? ' on' : ''));
  t.onclick = () => { t.classList.toggle('on'); onChange(t.classList.contains('on')); };
  return t;
}
function fieldEl(f, value, onChange) {
  const row = el('div', 'field');
  const lab = el('div', 'fl', f.label);
  if (f.tip) lab.append(el('small', '', f.tip));
  row.append(lab);
  let ctrl;
  if (f.type === 'bool') ctrl = toggleEl(!!value, onChange);
  else if (f.type === 'select') {
    ctrl = el('select');
    for (const [v, l] of f.options) { const o = el('option', '', l); o.value = JSON.stringify(v); ctrl.append(o); }
    ctrl.value = JSON.stringify(f.options.some(o => String(o[0]) === String(value)) ? f.options.find(o => String(o[0]) === String(value))[0] : value);
    if (ctrl.selectedIndex < 0) { const o = el('option', '', `${value} (actuel)`); o.value = JSON.stringify(value); ctrl.append(o); ctrl.value = o.value; }
    ctrl.onchange = () => { if (ctrl.value) onChange(JSON.parse(ctrl.value)); };
  } else if (f.type === 'slider') {
    ctrl = el('div', 'range');
    const r = el('input'); r.type = 'range'; r.min = f.min; r.max = f.max; r.value = value ?? f.default;
    const v = el('span', '', `${r.value}${f.suffix || ''}`);
    r.oninput = () => { v.textContent = `${r.value}${f.suffix || ''}`; onChange(Number(r.value)); };
    ctrl.append(r, v);
  } else if (f.type === 'int') {
    ctrl = el('div', 'numwrap');
    const n = el('input'); n.type = 'number'; n.min = f.min; n.max = f.max; n.value = value ?? f.default;
    n.onchange = () => onChange(Math.max(f.min, Math.min(f.max, Number(n.value) || 0)));
    ctrl.append(n);
    if (f.suffix) ctrl.append(el('span', '', f.suffix));
  } else {
    ctrl = el('input'); ctrl.type = 'text'; ctrl.value = value ?? '';
    ctrl.onchange = () => onChange(ctrl.value);
  }
  row.append(ctrl);
  return row;
}
function group(title, fields, tip) {
  const g = el('div', 'set-group');
  if (title) g.append(el('h4', '', title));
  if (tip) g.append(el('div', 'tip', tip));
  fields.forEach(f => g.append(f));
  return g;
}
function appField(label, key, type, options, tip) {
  const f = { label, type, options, tip, min: 0, max: 0 };
  return fieldEl(f, S.settings[key], async v => { S = await arcadia.settings({ [key]: v }); renderAll(); });
}

async function openSettings(section) {
  if (section) SET.section = section;
  SET.emus = await arcadia.emuList();
  openModal(card => {
    card.className = 'modal-card settings';
    const top = el('div', 'set-top');
    top.append(el('h2', '', 'Paramètres'));
    const x = el('button', 'x', '×'); x.onclick = closeModal; top.append(x);
    const body = el('div', 'set-body');
    const nav = el('div', 'set-nav');
    const content = el('div', 'set-content');
    const foot = el('div', 'set-foot');
    body.append(nav, content);
    card.append(top, body, foot);
    SET.render = () => renderSettings(nav, content, foot);
    SET.render();
  });
}

function navBtn(nav, key, label, dot, sub) {
  const b = el('button', SET.section === key ? 'on' : '');
  if (dot !== undefined) b.append(el('span', 'dot' + (dot ? ' ok' : '')));
  b.append(el('span', '', label));
  if (sub) b.append(el('span', 'sub', sub));
  b.onclick = async () => {
    if (Object.keys(SET.pending).length && !(await confirmLeave())) return;
    SET.pending = {}; SET.section = key; SET.page = 0; SET.tab = 0; SET.emuState = null;
    SET.render();
  };
  nav.append(b);
}
async function confirmLeave() {
  return window.confirm('Des modifications ne sont pas enregistrées. Les abandonner ?');
}

// Qualité graphique : Minimal / Moyenne / Maximum / Auto (tous les émulateurs + moteur intégré)
const PERF_LEVELS = [['minimal', 'Minimal', 'Petites configurations'], ['moyenne', 'Moyenne', 'Configurations milieu de gamme'], ['maximum', 'Maximum', 'Grosses configurations'], ['auto', 'Auto', 'Analyse ton PC et choisit']];
function perfButtons(current, onPick) {
  const row = el('div', 'perf-row');
  for (const [id, label, sub] of PERF_LEVELS) {
    const b = el('button', 'perf-btn' + (current === id ? ' on' : '') + (id === 'auto' ? ' auto' : ''));
    b.append(el('b', '', label), el('span', '', sub));
    b.onclick = () => onPick(id, label);
    row.append(b);
  }
  return row;
}
function perfGroup() {
  const g = el('div', 'set-group');
  g.append(el('h4', '', 'Qualité graphique des émulateurs'));
  const hwLine = el('div', 'tip', 'Analyse de ton PC…');
  const paint = hw => { if (hw) hwLine.textContent = `Ton PC : ${hw.gpu} · ${hw.cpu || 'processeur'} (${hw.threads} threads) · ${hw.ramGb} Go → profil conseillé : ${({ minimal: 'Minimal', moyenne: 'Moyenne', maximum: 'Maximum' })[hw.level]}`; };
  if (S.hardware) paint(S.hardware); else arcadia.perfDetect().then(paint).catch(() => { hwLine.textContent = 'Analyse du PC impossible : choisis un profil à la main.'; });
  g.append(el('div', 'tip', 'Règle d\'un coup la résolution et le rendu de tous tes émulateurs, moteur intégré compris. Tu peux toujours affiner chaque émulateur ensuite.'));
  g.append(perfButtons(S.settings.perfLevel, async (id, label) => {
    const r = await arcadia.perfApply(id);
    if (!r.ok) { toast(r.error, true); return; }
    S = r.state; paint(r.hardware);
    toast(`Profil « ${label} »${id === 'auto' ? ` (${({ minimal: 'Minimal', moyenne: 'Moyenne', maximum: 'Maximum' })[r.level]})` : ''} appliqué à ${r.done.length} émulateur(s).` + (r.failed.length ? ` Échec : ${r.failed.join(', ')}.` : ''), !!r.failed.length);
    SET.render();
  }));
  g.append(hwLine);
  return g;
}

async function renderSettings(nav, content, foot) {
  nav.replaceChildren(); content.replaceChildren(); foot.replaceChildren();
  nav.append(el('div', 'nav-title', 'Arcadia'));
  navBtn(nav, 'general', 'Général');
  navBtn(nav, 'interface', 'Interface');
  navBtn(nav, 'library', 'Bibliothèque');
  navBtn(nav, 'shortcuts', 'Raccourcis clavier');
  navBtn(nav, 'saves', 'Sauvegardes & cloud');
  navBtn(nav, 'about', 'À propos');
  nav.append(el('div', 'nav-title', 'Émulateurs'));
  navBtn(nav, 'mapping', 'Attribution des consoles');
  for (const e of SET.emus) navBtn(nav, 'emu:' + e.id, e.name, e.installed, e.consoles.join(' · '));
  foot.append(el('div', 'note', 'Certains paramètres ne sont pris en compte qu\'au prochain lancement du jeu.'));
  const sec = SET.section;

  if (sec === 'about') {
    const a = el('div', 'about-page');
    const logo = el('img', 'about-logo'); logo.src = 'logo.png'; logo.alt = '';
    const word = el('div', 'about-word brand-word');
    const head = el('div', 'about-head'); head.append(logo, word);
    a.append(head);
    a.append(el('p', 'about-lead', 'Arcadia est un projet solo créé par Ivex.'));
    a.append(el('p', 'about-big', 'Une application qui réunit de nombreux émulateurs : plus besoin de chercher à droite ou à gauche, tout est ici et automatisé. Importe ta ROM, Arcadia s\'occupe du reste !'));
    const warn = el('div', 'about-warn');
    warn.append(el('strong', '', 'Attention'), el('p', '', 'Ce projet n\'est qu\'une bibliothèque plus esthétique et une racine commune à de multiples émulateurs, pour faciliter la lecture, le lancement et l\'importation de ROMs à jouer sur ordinateur. Le téléchargement de ROMs sur Internet étant illégal, je ne peux pas vous les fournir.'));
    a.append(warn);
    const ds = el('div', 'about-row');
    ds.append(el('span', '', 'Plus d\'informations ou une question ? Contacte-moi sur Discord :'));
    const link = el('button', 'btn about-discord', 'discord.gg/PKw6MyzzzD'); link.onclick = () => arcadia.openUrl('https://discord.gg/PKw6MyzzzD');
    ds.append(link); a.append(ds);
    a.append(el('p', 'about-support', 'N\'hésitez pas à me soutenir pour plus de mises à jour : je vais travailler sur mon propre émulateur, un émulateur commun, pour continuer de vous fournir un outil propre, facile d\'accès et léger.'));
    a.append(el('div', 'about-ver muted small', `Version ${S.version || ''} · Licence GPL-3.0 · Moteurs : PPSSPP, melonDS, et les émulateurs libres de chaque console`));
    content.append(a);
    if (window.mountWordmarks) mountWordmarks();
    return;
  }

  if (sec === 'general') {
    content.append(perfGroup());
    content.append(group('Comportement', [
      appField('Réduire Arcadia pendant une partie', 'minimizeOnPlay', 'bool', null, 'La fenêtre revient toute seule quand tu quittes le jeu.'),
      appField('Télécharger les jaquettes automatiquement', 'coversOnline', 'bool', null, 'Bases libres libretro-thumbnails et titledb (Switch). Seul le nom ou l\'identifiant du jeu sert à la recherche.'),
      appField('Démarrer en BigPicture', 'bigPictureOnStart', 'bool', null, 'Plein écran, navigation à la manette.'),
      introField()
    ]));
    content.append(group('Pages de jeu', [appField('Clé SteamGridDB (facultative)', 'sgdbKey', 'text', null, 'Pour de grandes bannières façon Steam en haut de chaque jeu. Clé gratuite : crée un compte sur steamgriddb.com puis Préférences → API. Sans clé, Arcadia utilise une capture du jeu.')]));
    content.append(group('Moteur intégré', [appField('Jouer avec le moteur Arcadia', 'useRunner', 'bool', null, 'Pour les consoles prises en charge (PSP, DS, 3DS, PS1, Game Boy, GBA, NES et Super Nintendo pour l\'instant), le jeu tourne directement dans Arcadia : aucune fenêtre d\'émulateur, menu Arcadia avec Échap ou le bouton Guide, reprise automatique de ta partie.')]));
    const padRow = el('div', 'tool');
    const ptd = el('div', 'td'); ptd.append(el('b', '', 'Ma manette'), el('div', '', padLabel(S.settings.input) + ' · ses touches sont appliquées à tous les jeux et à tous les moteurs.'));
    const pb = el('button', 'btn-white', 'Changer / calibrer'); pb.onclick = () => { closeModal(); inputModal(false); };
    padRow.append(ptd, pb);
    content.append(group('Manette', [padRow,
      appField('Aide des contrôles au début de chaque partie', 'controlsHint', 'bool', null, 'Rappelle que manette et clavier marchent en même temps, et où calibrer.'),
      appField('Proposer de reprendre une copie de sauvegarde', 'resumePrompt', 'bool', null, 'Jeux sur émulateur externe (Switch…) : « Reprendre ta partie ? » au lancement quand des copies existent.'),
      appField('Quitter un jeu avec la manette', 'padQuit', 'bool', null, 'Maintiens Back (⧉) + Start (☰) pendant 1,5 s : l\'émulateur se ferme et tu reviens dans Arcadia. Marche même en plein écran.')]));
    content.append(group('Téléphone', [await remoteField()], 'Ton téléphone doit être sur le même Wi-Fi. Windows peut demander d\'autoriser Arcadia sur le réseau privé : accepte.'));
    const lg = el('div', 'tool');
    const ltd = el('div', 'td'); ltd.append(el('b', '', 'Journal d\'erreurs'), el('div', '', 'Si quelque chose plante, envoie ce fichier : il contient la cause exacte.'));
    const lb = el('button', 'btn-ghost', 'Ouvrir'); lb.onclick = () => arcadia.openLog();
    lg.append(ltd, lb);
    content.append(group('Diagnostic', [lg]));
    content.append(group('Discord', [
      appField('Application ID Discord', 'discordId', 'text', null, 'Affiche « Joue à … » sur ton profil. Crée une application gratuite sur discord.com/developers/applications, nomme-la « Arcadia » et colle son Application ID ici. Discord doit être ouvert.')
    ]));
  } else if (sec === 'interface') {
    content.append(group('Apparence', [
      appField('Intensité de l\'effet lumineux', 'glow', 'select', [['off', 'Aucun'], ['soft', 'Doux'], ['medium', 'Moyen'], ['strong', 'Intense']]),
      appField('Lueur à la couleur de la console', 'accentByConsole', 'bool', null, 'Rouge pour la Switch, bleu pour la PlayStation…'),
      appField('Sons de l\'interface', 'uiSounds', 'bool', null, 'Petits sons discrets en naviguant et au lancement d\'un jeu.')
    ]));
    content.append(group('Liste de jeux', [
      appField('Mode d\'affichage', 'viewMode', 'select', [['grid', 'Grille de jaquettes'], ['list', 'Liste détaillée']]),
      appField('Taille des icônes (colonne de gauche)', 'iconSize', 'select', [[0, 'Aucune'], [16, 'Petite (16×16)'], [22, 'Standard (22×22)'], [32, 'Grande (32×32)'], [44, 'Très grande (44×44)']]),
      appField('Afficher le nom des jeux', 'showNames', 'bool'),
      appField('Texte sous le nom', 'cardSubtitle', 'select', [['playtime', 'Temps de jeu'], ['console', 'Console'], ['last', 'Dernière partie'], ['file', 'Nom du fichier'], ['none', 'Rien']]),
      appField('Afficher le badge de console', 'showBadges', 'bool')
    ]));
  } else if (sec === 'library') {
    const p = el('div', 'field');
    p.append(el('div', 'fl', 'Dossier de la bibliothèque'), el('div', 'mono', S.libraryDir || '—'));
    const acts = el('div', 'field');
    const wrap = el('div', 'numwrap');
    const change = el('button', 'btn-ghost', 'Changer…');
    change.onclick = async () => { closeModal(); await chooseLibrary(); };
    const open = el('button', 'btn-ghost', 'Ouvrir');
    open.onclick = () => arcadia.openFolder(null);
    wrap.append(change, open);
    acts.append(el('div', 'fl', ''), wrap);
    content.append(group('Dossier', [p, acts]));
    const sortRow = el('div', 'tool');
    const td = el('div', 'td'); td.append(el('b', '', 'Tri automatique'), el('div', '', S.loose ? `${S.loose} élément(s) en vrac détecté(s).` : 'Tout est rangé.'));
    const sb = el('button', 'btn-white', 'Trier maintenant'); sb.onclick = () => { closeModal(); proposeSort(); };
    sortRow.append(td, sb);
    const covRow = el('div', 'tool');
    const td2 = el('div', 'td'); td2.append(el('b', '', 'Icônes et jaquettes'), el('div', '', 'Refaire l\'extraction des icônes et la recherche des jaquettes pour tous les jeux.'));
    const cb = el('button', 'btn-ghost', 'Tout recharger'); cb.onclick = async () => { S = await arcadia.resetMedia(); renderAll(); toast('Rechargement des images…'); };
    covRow.append(td2, cb);
    content.append(group('Rangement', [sortRow, covRow]));
    const bk = await arcadia.storeBackups();
    const rows = bk.slice(0, 7).map(b => {
      const r = el('div', 'tool');
      const td3 = el('div', 'td'); td3.append(el('b', '', new Date(b.day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })), el('div', 'mono', b.file));
      const rb = el('button', 'btn-ghost', 'Restaurer');
      rb.onclick = async () => { if (await confirmBox('Restaurer les réglages ?', 'Catégories, favoris, heures de jeu et réglages reviennent à cette date. Arcadia redémarre.')) arcadia.restoreStore(b.file); };
      r.append(td3, rb); return r;
    });
    content.append(group('Copies des réglages d\'Arcadia', rows.length ? rows : [el('p', 'muted', 'Première copie au prochain démarrage.')], 'Une copie par jour (14 gardées), dans le dossier des sauvegardes — donc aussi sur ton Google Drive s\'il est lié.'));
  } else if (sec === 'shortcuts') {
    const names = { search: 'Rechercher', fullscreen: 'Plein écran', refresh: 'Actualiser la bibliothèque', add: 'Ajouter des jeux', settings: 'Paramètres', favorite: 'Favori (jeu sélectionné)', back: 'Retour / fermer' };
    const t = el('table', 'kbd-table');
    for (const [k, label] of Object.entries(names)) {
      const tr = el('tr');
      const k1 = el('span', 'kbd', S.settings.shortcuts[k] || '—');
      k1.title = 'Double-clique puis appuie sur la nouvelle combinaison';
      k1.ondblclick = () => {
        k1.classList.add('listening'); k1.textContent = 'Appuie…';
        capturing = async combo => {
          capturing = null;
          S = await arcadia.settings({ shortcuts: { [k]: combo } });
          SET.render();
        };
      };
      const td1 = el('td', '', label), td2 = el('td'); td2.append(k1);
      tr.append(td1, td2); t.append(tr);
    }
    const g = group('Fenêtre principale', [t], 'Double-clique sur un raccourci pour le changer.');
    const reset = el('button', 'btn-ghost', 'Restaurer les paramètres par défaut');
    reset.style.marginTop = '10px';
    reset.onclick = async () => { S = await arcadia.settings({ shortcuts: { search: 'Ctrl+F', fullscreen: 'F11', refresh: 'F5', add: 'Ctrl+O', settings: 'Ctrl+,', favorite: 'Ctrl+D', back: 'Escape' } }); SET.render(); };
    content.append(g, reset);
  } else if (sec === 'saves') {
    await renderSavesSettings(content);
  } else if (sec === 'mapping') {
    renderMapping(content);
  } else if (sec.startsWith('emu:')) {
    await renderEmu(sec.slice(4), content, foot);
  }
}

function renderMapping(content) {
  const head = el('div', 'tool');
  const td = el('div', 'td'); td.append(el('b', '', 'Détection automatique'), el('div', '', 'Choisis le dossier qui contient tes émulateurs : Arcadia trouve les exécutables tout seul.'));
  const det = el('button', 'btn-white', 'Détecter dans un dossier…');
  det.onclick = async () => { S = await arcadia.detectEmulators(); toast(S.detected ? `Trouvés : ${S.detected.join(', ') || 'aucun'}` : 'Annulé'); SET.emus = await arcadia.emuList(); renderAll(); SET.render(); };
  head.append(td, det);
  content.append(group('Émulateurs', [head]));
  const rows = [];
  for (const c of S.consoles) {
    const setup = S.mapping[c.id] || {};
    const row = el('div', 'emu-row');
    const name = el('div', 'name');
    const dot = el('span', 'dot' + (S.status[c.id] ? '' : ' ok')); dot.title = S.status[c.id] || 'Prêt';
    name.append(dot, el('span', '', c.id));
    const exe = el('input'); exe.placeholder = "Chemin de l'émulateur"; exe.value = setup.exe || '';
    const args = el('input'); args.placeholder = '"{rom}"'; args.value = setup.args || ''; args.title = 'Arguments ({rom} = jeu)';
    const acts = el('div', 'actions');
    const pick = el('button', 'btn-ghost', '…'); pick.title = 'Parcourir';
    pick.onclick = async () => { const p = await arcadia.pickExe(); if (p) exe.value = p; };
    const save = el('button', 'btn-white', 'OK');
    save.onclick = async () => {
      const payload = exe.value.trim() ? { emulator: setup.exe === exe.value.trim() ? setup.emulator : 'custom', exe: exe.value.trim(), args: args.value.trim() || '"{rom}"' } : null;
      S = await arcadia.setEmulator(c.id, payload); renderAll(); SET.render();
      toast(S.status[c.id] || `${c.id} prêt.`, !!S.status[c.id]);
    };
    acts.append(pick, save);
    row.append(name, exe, args, acts);
    rows.push(row);
  }
  content.append(group('Console → émulateur', rows, '{rom} = chemin du jeu'));
  renderInstaller(content);
}

async function renderInstaller(content) {
  const box = el('div');
  content.append(box);
  if (!S.org?.root) {
    const r = el('div', 'tool');
    const td = el('div', 'td'); td.append(el('b', '', 'Dossier Arcadia'), el('div', '', 'Choisis le dossier où Arcadia range « Jeux », « Émulateurs » et « Sauvegardes ».'));
    const b = el('button', 'btn-white', 'Choisir…');
    b.onclick = async () => { S = await arcadia.chooseRoot(); renderAll(); SET.render(); };
    r.append(td, b);
    box.append(group('Installation des émulateurs', [r]));
    return;
  }
  const cat = await arcadia.emuCatalog();
  if (!UPD.__loaded) { UPD.__loaded = true; arcadia.emuUpdates().then(u => { Object.assign(UPD, u); if (Object.values(u).some(x => x.update) && SET.section === 'mapping') SET.render(); }).catch(() => {}); }
  const missing = cat.filter(c => !c.installed && c.auto);
  const rows = cat.map(c => {
    const r = el('div', 'tool');
    const td = el('div', 'td');
    td.append(el('b', '', `${c.name}  ·  ${c.consoles.join(', ')}`), el('div', '', c.installed ? `✓ Installé${c.exe ? ' — ' + c.exe : ''}` : (c.note ? `Non installé · ${c.note}` : 'Non installé')));
    const acts = el('div', 'actions');
    const up = UPD[c.id];
    if (up?.update) td.lastChild.textContent += `  ·  ⬆ Version ${up.latest} disponible (installée : ${up.local})`;
    if (c.auto) {
      const b = el('button', !c.installed || up?.update ? 'btn-white' : 'btn-ghost', c.installed ? (up?.update ? 'Mettre à jour' : 'Réinstaller') : 'Installer');
      b.onclick = () => installEmus([c.id]);
      acts.append(b);
    }
    const w = el('button', 'btn-ghost', 'Site officiel');
    w.onclick = () => arcadia.openUrl(c.page);
    acts.append(w);
    r.append(td, acts);
    return r;
  });
  if (missing.length) {
    const all = el('div', 'tool');
    const td = el('div', 'td'); td.append(el('b', '', `${missing.length} émulateur(s) manquant(s)`), el('div', '', 'Dernières versions officielles, installées dans ' + (S.emulatorsDir || 'le dossier Émulateurs')));
    const b = el('button', 'btn-white', 'Tout installer');
    b.onclick = () => installEmus(missing.map(m => m.id));
    all.append(td, b);
    rows.unshift(all);
  }
  box.append(group('Installation des émulateurs', rows, 'Téléchargés depuis les pages GitHub officielles de chaque projet.'));
}

async function installEmus(ids) {
  const t = taskBox('Installation…');
  const r = await arcadia.installEmus(ids);
  if (!r.ok) { t.done([['ko', '✕ ' + r.error]], true); return; }
  S = r.state;
  t.done(r.results.map(x => x.ok ? ['ok', `✓ ${x.name} ${x.version}`] : ['ko', `✕ ${x.name} : ${x.error}`]), r.results.some(x => !x.ok));
  SET.emus = await arcadia.emuList();
  renderAll();
  if (!$('#modal').classList.contains('hidden')) SET.render();
}

async function renderEmu(id, content, foot) {
  if (!SET.emuState || SET.emuState.id !== id) SET.emuState = await arcadia.emuRead(id);
  const st = SET.emuState;
  const info = el('div', 'set-file');
  if (!st.exe && st.format !== 'qtini') {
    content.append(group(st.name, [el('p', '', `Exécutable de ${st.name} introuvable. Ajoute-le dans « Attribution des consoles » ou via « Détecter dans un dossier… ».`)]));
    return;
  }
  info.append(document.createTextNode('Fichier : '), el('b', 'mono', st.file || '—'), document.createTextNode(st.exists ? '' : '  (pas encore créé : il sera créé à l\'enregistrement)'));
  content.append(info);
  if (st.presets || st.pad || st.unlocks?.length) {
    const rows = [];
    if (st.presets) {
      const r = el('div', 'tool');
      const td = el('div', 'td'); td.append(el('b', '', 'Qualité graphique'), el('div', '', 'Minimal pour les petites configs, Maximum vise la 4K, Auto s\'adapte à ton PC.'));
      const acts = perfButtons(null, async (lvl, lab) => {
        const r2 = await arcadia.perfApply(lvl, id);
        if (r2.ok && r2.done.length) { SET.emuState = null; SET.pending = {}; SET.render(); toast(`${st.name} : profil « ${lab} »${lvl === 'auto' ? ` (${r2.level})` : ''} appliqué.`); }
        else toast(r2.error || `${st.name} : impossible d'appliquer le profil.`, true);
      });
      acts.classList.add('compact');
      r.append(td, acts); rows.push(r);
    }
    if (st.pad) {
      const r = el('div', 'tool');
      const td = el('div', 'td'); td.append(el('b', '', '🎮 Manette Xbox'), el('div', '', 'Assigne tous les boutons de ta manette (joueur 1) en un clic.'));
      const b = el('button', 'btn-white', 'Configurer');
      b.onclick = async () => { const r2 = await arcadia.emuPad(id); if (r2.ok) { SET.emuState = r2.state; toast(`${st.name} : manette Xbox configurée.`); } else toast(r2.error, true); };
      r.append(td, b); rows.push(r);
    }
    for (const u of st.unlocks || []) {
      const r = el('div', 'field');
      const l = el('div', 'fl'); l.append(el('span', '', u.label)); if (u.desc) l.append(el('div', 'tip', u.desc));
      r.append(l, toggleEl(u.on, async v => { const r2 = await arcadia.emuUnlock(id, u.id, v); if (r2.ok) { SET.emuState = r2.state; SET.render(); } else toast(r2.error, true); }));
      rows.push(r);
    }
    content.append(group('Performances, manette & débridage', rows, 'Options natives de l\'émulateur. Les patchs 60 FPS par jeu se gèrent dans RPCS3 (Gestionnaire de patchs) et PCSX2 (Propriétés du jeu → Patchs).'));
  }
  if (st.running) content.append(el('div', 'warning', `${st.name} est en cours d'utilisation : ferme le jeu pour modifier ses réglages.`));
  const pages = st.pages;
  if (pages.length > 1) {
    const pt = el('div', 'set-tabs');
    pages.forEach((p, i) => { const b = el('button', i === SET.page ? 'on' : '', p.label); b.onclick = () => { SET.page = i; SET.tab = 0; SET.render(); }; pt.append(b); });
    content.append(pt);
  }
  const page = pages[SET.page] || pages[0];
  if (page.tools) {
    const rows = page.tools.map(t => {
      const r = el('div', 'tool');
      const td = el('div', 'td'); td.append(el('b', '', t.label), el('div', '', t.desc || ''));
      const b = el('button', t.id.startsWith('open') ? 'btn-ghost' : 'btn-white', t.id.startsWith('open') ? 'Ouvrir' : 'Installer');
      b.onclick = async () => { b.disabled = true; const r2 = await arcadia.emuTool(id, t.id); b.disabled = false; if (r2.error) toast(r2.error, true); else if (r2.message) toast(r2.message); };
      r.append(td, b);
      return r;
    });
    content.append(group('Outils', rows, `${st.name} doit être fermé pendant l'installation.`));
  } else {
    if (page.tabs.length > 1) {
      const tt = el('div', 'set-tabs sub2');
      page.tabs.forEach((t, i) => { const b = el('button', i === SET.tab ? 'on' : '', t.label); b.onclick = () => { SET.tab = i; SET.render(); }; tt.append(b); });
      content.append(tt);
    }
    const tab = page.tabs[SET.tab] || page.tabs[0];
    for (const g of tab.groups) {
      const rows = g.fields.map(f => {
        const val = f.key in SET.pending ? SET.pending[f.key] : st.values[f.key];
        const row = fieldEl(f, val, v => {
          if (String(v) === String(st.values[f.key])) delete SET.pending[f.key]; else SET.pending[f.key] = v;
          row.classList.toggle('changed', f.key in SET.pending);
          updateFoot();
        });
        row.classList.toggle('changed', f.key in SET.pending);
        return row;
      });
      content.append(group(g.label, rows, g.tip));
    }
    if (tab.footer) content.append(el('p', 'muted small', tab.footer));
  }
  // pied : note + Annuler / Enregistrer
  foot.replaceChildren();
  foot.append(el('div', 'note', st.note || 'Les réglages sont écrits directement dans la configuration de l\'émulateur (une sauvegarde .arcadia.bak est faite avant la première modification).'));
  const cancel = el('button', 'btn-ghost', 'Annuler');
  const save = el('button', 'btn-white', 'Enregistrer');
  cancel.onclick = () => { SET.pending = {}; SET.render(); };
  save.onclick = async () => {
    const res = await arcadia.emuWrite(id, SET.pending);
    if (!res.ok) { toast(res.error, true); return; }
    SET.emuState = res.state; SET.pending = {};
    toast(`Réglages de ${st.name} enregistrés.`);
    SET.render();
  };
  const updateFoot = () => {
    const n = Object.keys(SET.pending).length;
    save.disabled = !n || st.running;
    save.textContent = n ? `Enregistrer (${n})` : 'Enregistrer';
    cancel.disabled = !n;
  };
  foot.append(cancel, save);
  updateFoot();
}


// ------------------------------------------------------------ glisser-déposer & import
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault(); dragDepth++;
  $('#drop').classList.remove('hidden');
});
window.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.add('hidden'); } });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0;
  $('#drop').classList.add('hidden');
  const paths = [...e.dataTransfer.files].map(f => arcadia.pathForFile(f)).filter(Boolean);
  if (paths.length) startImport(paths);
});

async function startImport(paths, runner) {
  if (!S.libraryDir) { toast("Choisis d'abord le dossier de ta bibliothèque.", true); return; }
  const box = $('#import');
  box.classList.remove('hidden');
  $('#imp-close').classList.add('hidden');
  $('#imp-title').textContent = 'Analyse…';
  $('#imp-file').textContent = paths ? `${paths.length} élément(s)` : 'Recherche des jeux en vrac…';
  $('#imp-bar').style.width = '0%';
  $('#imp-detail').replaceChildren();
  const res = runner ? await runner() : await arcadia.importPaths(paths);
  $('#imp-close').classList.remove('hidden');
  if (!res.ok) { $('#imp-title').textContent = 'Importation impossible'; $('#imp-file').textContent = res.error; return; }
  S = res.state;
  const ok = res.results.filter(r => r.ok && !r.already), already = res.results.filter(r => r.already && !r.skipped), skipped = res.results.filter(r => r.skipped), ko = res.results.filter(r => !r.ok);
  $('#imp-title').textContent = `${ok.length} jeu(x) rangé(s)` + (ko.length ? ` · ${ko.length} ignoré(s)` : '');
  $('#imp-file').textContent = already.length ? `${already.length} déjà dans la bonne console` : 'Terminé';
  $('#imp-bar').style.width = '100%';
  const detail = $('#imp-detail');
  for (const r of ok) detail.append(el('div', 'ok', `✓ ${r.name} → ${r.console}${r.copied ? ' (copie)' : r.replaced ? ' (remplacé)' : ''}`));
  for (const r of skipped) detail.append(el('div', '', `• ${r.name} : déjà présent, pas copié`));
  for (const r of ko) detail.append(el('div', 'ko', `✕ ${r.name} : ${r.error}`));
  renderAll();
  if (!ko.length) setTimeout(() => box.classList.add('hidden'), 5000);
  const unknown = ko.filter(r => r.unknown);
  if (unknown.length) oopsModal(unknown.map(r => r.name));
}
function oopsModal(names) {
  openModal(card => {
    card.classList.add('oops');
    card.append(el('div', 'oops-ico', '?'));
    card.append(el('h2', '', 'Oops !'));
    const p = el('p', '');
    p.append(document.createTextNode('Il semble que ton fichier ne soit pas reconnu parmi mes émulateurs… Contacte-moi sur '));
    const a = el('a', 'oops-link', 'Discord'); a.href = '#'; a.onclick = e => { e.preventDefault(); arcadia.openUrl('https://discord.gg/PKw6MyzzzD'); };
    p.append(a, document.createTextNode(' afin que je regarde pour potentiellement le mettre à jour !'));
    card.append(p);
    const list = el('div', 'oops-files mono');
    for (const n of names.slice(0, 8)) list.append(el('div', '', n));
    if (names.length > 8) list.append(el('div', 'muted', `… et ${names.length - 8} autre(s)`));
    card.append(list);
    const actions = el('div', 'modal-actions');
    const ok = el('button', 'btn-ghost', 'Fermer'); ok.onclick = closeModal;
    const dc = el('button', 'btn-white', 'Ouvrir Discord'); dc.onclick = () => arcadia.openUrl('https://discord.gg/PKw6MyzzzD');
    actions.append(ok, dc); card.append(actions);
  }, true);
}
arcadia.onImportProgress(s => {
  if (s.phase === 'done') return;
  $('#imp-title').textContent = `${s.phase === 'extract' ? 'Extraction' : 'Rangement'} ${s.index}/${s.count}`;
  $('#imp-file').textContent = s.current;
  $('#imp-bar').style.width = (s.bytesTotal ? Math.min(100, 100 * s.bytesDone / s.bytesTotal) : 0).toFixed(1) + '%';
});
// Progression des déplacements / installations : même panneau que l'import
function taskBox(title) {
  const box = $('#import');
  box.classList.remove('hidden');
  $('#imp-close').classList.add('hidden');
  $('#imp-title').textContent = title;
  $('#imp-file').textContent = '';
  $('#imp-bar').style.width = '0%';
  $('#imp-detail').replaceChildren();
  return {
    done(lines, keep) {
      $('#imp-close').classList.remove('hidden');
      $('#imp-bar').style.width = '100%';
      for (const [cls, t] of lines || []) $('#imp-detail').append(el('div', cls, t));
      if (!keep) setTimeout(() => box.classList.add('hidden'), 5000);
    }
  };
}
arcadia.onTaskProgress(d => {
  $('#imp-title').textContent = d.title;
  $('#imp-file').textContent = d.file || '';
  $('#imp-bar').style.width = Math.max(0, Math.min(100, d.pct || 0)).toFixed(1) + '%';
});

// ------------------------------------------------------------ organisation : tout sous le dossier Arcadia
function orgModal(kind) {
  const o = S.org;
  const emus = kind === 'emus';
  return new Promise(resolve => openModal(card => {
    card.append(el('h2', '', emus ? 'Regrouper tes émulateurs ?' : 'Regrouper tes jeux ?'));
    card.append(el('p', '', emus
      ? `Tes émulateurs sont dans « ${o.emulatorsDir} ». Arcadia range tout dans son propre dossier « Émulateurs », pour avoir une seule arborescence propre.`
      : `Tes jeux sont dans « ${o.libraryDir} ». Arcadia peut les ranger dans son dossier « Jeux ».`));
    card.append(el('p', 'muted', "Aucun risque : c'est uniquement de l'organisation. Les fichiers sont déplacés tels quels (instantané sur le même disque), tes réglages, sauvegardes et heures de jeu sont conservés."));
    const dest = el('div', 'mono', `→ ${o.root}\\${emus ? 'Émulateurs' : 'Jeux'}`);
    card.append(dest);
    const actions = el('div', 'modal-actions');
    const keep = el('button', 'btn-ghost', emus ? 'Garder et connecter mes émulateurs' : 'Garder et connecter mon dossier');
    const go = el('button', 'btn-white', emus ? 'Déplacer dans Arcadia' : 'Déplacer dans Arcadia');
    keep.onclick = async () => { closeModal(); S = await arcadia.orgConnect(emus ? 'emus' : 'library'); renderAll(); resolve(); };
    go.onclick = async () => {
      closeModal();
      const t = taskBox(emus ? 'Déplacement des émulateurs…' : 'Déplacement des jeux…');
      const r = emus ? await arcadia.moveEmus() : await arcadia.moveLibrary();
      if (r.ok) { S = r.state; t.done([['ok', `✓ Tout est dans ${o.root}\\${emus ? 'Émulateurs' : 'Jeux'}`]]); }
      else t.done([['ko', `✕ ${r.error}`]], true);
      renderAll(); resolve();
    };
    if (emus) {
      const re = el('button', 'btn-ghost', 'Réinstaller proprement');
      re.title = 'Installe les dernières versions officielles dans Arcadia\\Émulateurs (tes anciens émulateurs ne sont pas touchés)';
      re.onclick = async () => { closeModal(); await openSettings('mapping'); resolve(); };
      actions.append(keep, re, go);
    } else actions.append(keep, go);
    card.append(actions);
  }, true));
}
async function checkOrg() {
  const o = S.org || {};
  if (o.emusOutside && !o.dismissed.emus) await orgModal('emus');
  if (S.org?.libraryOutside && !S.org.dismissed.library) await orgModal('library');
}

arcadia.onImportAsk(async ({ askId, name }) => arcadia.answerImport(askId, await pickConsole(name)));
// Jeu déjà présent : ne pas copier / créer une copie (renommable) / remplacer l'ancienne
arcadia.onImportDuplicate(({ askId, name, same, existing }) => openModal(card => {
  card.append(el('h2', '', 'Ce jeu est déjà dans ta bibliothèque'));
  card.append(el('p', '', same
    ? `« ${name} » est identique à « ${existing.file} » (${existing.console}).`
    : `« ${name} » semble être « ${existing.title} », déjà présent dans ${existing.console} (${existing.file}).`));
  card.append(el('p', 'muted', 'Si tu continues, une copie est créée : tu peux lui donner un autre nom.'));
  const input = el('input'); input.type = 'text'; input.value = name.replace(/\.[^.]+$/, '') + ' (2)';
  card.append(input);
  const a = el('div', 'modal-actions');
  const done = ans => { closeModal(); arcadia.answerImport(askId, ans); };
  const no = el('button', 'btn-white', 'Ne pas copier'); no.onclick = () => done({ action: 'skip' });
  const rep = el('button', 'btn-ghost', "Remplacer l'ancienne"); rep.title = "L'ancienne version part dans la corbeille Windows"; rep.onclick = () => done({ action: 'replace' });
  const cp = el('button', 'btn-ghost', 'Créer une copie'); cp.onclick = () => done({ action: 'copy', name: input.value });
  a.append(rep, cp, no); card.append(a);
  setTimeout(() => no.focus(), 30);
}));

// ------------------------------------------------------------ événements
document.addEventListener('click', e => {
  if (!e.target.closest('#ctx')) closeCtx();
  const playBtn = e.target.closest('[data-play]');
  if (playBtn) { e.stopPropagation(); play(playBtn.dataset.play); return; }
  const item = e.target.closest('.card, .row, .recent, .lrow');
  if (item && item.dataset.id) openGame(item.dataset.id);
});
document.addEventListener('dblclick', e => {
  const item = e.target.closest('.card, .row, .recent, .lrow');
  if (item && item.dataset.id) play(item.dataset.id);
});
document.addEventListener('contextmenu', e => {
  const item = e.target.closest('.card, .row, .recent, .lrow');
  if (item && item.dataset.id) { e.preventDefault(); gameMenu(e.clientX, e.clientY, gameById(item.dataset.id)); }
});
function comboOf(e) {
  const k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}
let capturing = null; // raccourci en cours de modification
document.addEventListener('keydown', e => {
  if (capturing) { e.preventDefault(); const c = comboOf(e); if (c) capturing(c); return; }
  const combo = comboOf(e);
  const sc = S?.settings?.shortcuts || {};
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
  if (combo === sc.back || e.key === 'Escape') {
    if (!$('#ctx').classList.contains('hidden')) closeCtx();
    else if (!$('#modal').classList.contains('hidden')) closeModal();
    else if (view === 'game') showHome();
    return;
  }
  const act = Object.entries(sc).find(([, v]) => v === combo)?.[0];
  if (act === 'search') { e.preventDefault(); $('#search').focus(); }
  else if (act === 'fullscreen') { e.preventDefault(); arcadia.toggleFullscreen(); }
  else if (act === 'refresh') { e.preventDefault(); arcadia.rescan().then(r => { S = r; renderAll(); toast(`${S.games.length} jeux.`); }); }
  else if (act === 'add') { e.preventDefault(); $('#btn-add').click(); }
  else if (act === 'settings') { e.preventDefault(); openSettings(); }
  else if (act === 'favorite' && selectedId && !typing) { e.preventDefault(); arcadia.toggleFavorite(selectedId).then(r => { S = r; renderAll(); }); }
  if (e.key === 'Enter' && !typing && document.activeElement?.dataset?.id) play(document.activeElement.dataset.id);
});
$('#main').addEventListener('scroll', closeCtx);

async function chooseLibrary() {
  const had = !!S.libraryDir;
  S = await arcadia.chooseLibrary();
  renderAll();
  if (S.emusFound) toast(`Émulateurs trouvés dans ${S.emusFound}`);
  if (S.loose) { proposeSort(); return; }
  if (!had) afterFirstLibrary();
}
// Premier lancement : bibliothèque choisie -> on vérifie qu'il y a des émulateurs
async function afterFirstLibrary() {
  const cat = await arcadia.emuCatalog();
  if (cat.some(c => c.installed)) return;
  if (await confirmBox('Aucun émulateur trouvé', 'Installer maintenant les émulateurs recommandés (dernières versions officielles) ? Tu pourras aussi indiquer un dossier où tu en as déjà.')) openSettings('mapping');
}
$('#btn-create-lib').onclick = async () => { S = await arcadia.createLibrary(); renderAll(); toast(`Bibliothèque créée : ${S.libraryDir}`); afterFirstLibrary(); };
$('#btn-choose-first').onclick = chooseLibrary;
$('#banner-sort').onclick = () => proposeSort();
$('#btn-full').onclick = () => arcadia.toggleFullscreen();
$('#view-seg').onclick = async e => { const b = e.target.closest('button'); if (b) { S = await arcadia.settings({ viewMode: b.dataset.v }); renderAll(); } };
$('#btn-folder').onclick = () => arcadia.openFolder(UI.consoleFilter || null);
$('#btn-emus').onclick = openSettings;
$('#btn-add').onclick = async () => { const p = await arcadia.pickRoms(); if (p.length) startImport(p); };
$('#btn-new-cat').onclick = () => newCategory(null);
$('#nav-home').onclick = () => { collection = null; showHome(); };
$('#brand').onclick = () => openSettings('about');
$('#brand').title = 'À propos d\'Arcadia';
$('.tab[data-view=home]').onclick = () => { collection = null; showHome(); };
$('.tab[data-view=stats]').onclick = () => showStats();
$('#imp-close').onclick = () => $('#import').classList.add('hidden');
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
$('#g-play').onclick = () => selectedId && play(selectedId);
$('#g-fav').onclick = async () => { S = await arcadia.toggleFavorite(selectedId); renderAll(); };
$('#g-more').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); gameMenu(r.left - 180, r.bottom + 4, gameById(selectedId)); e.stopPropagation(); };
$('#search').oninput = () => { renderSidebar(); if (view === 'home') renderHome(); else if ($('#search').value) showHome(); };
$('#sort').onchange = e => { UI.sort = e.target.value; arcadia.setUi({ sort: UI.sort }); renderHome(); };
$('#zoom').oninput = e => { UI.zoom = +e.target.value; document.documentElement.style.setProperty('--card', UI.zoom + 'px'); };
$('#zoom').onchange = () => arcadia.setUi({ zoom: UI.zoom });
$('#console-filter').onchange = e => { UI.consoleFilter = e.target.value; arcadia.setUi({ consoleFilter: UI.consoleFilter }); renderSidebar(); if (view === 'home') renderHome(); };

// mises à jour en direct
let mediaTimer;
arcadia.onMedia(updates => {
  if (!S) return;
  for (const [id, g] of Object.entries(updates)) {
    const i = S.games.findIndex(x => x.id === id);
    if (i >= 0) S.games[i] = g;
  }
  clearTimeout(mediaTimer);
  mediaTimer = setTimeout(renderAll, 150);
});
arcadia.onStarted(({ id }) => { running.add(id); renderAll(); });
arcadia.onExited(({ id, seconds, stats, backup }) => {
  running.delete(id);
  S.stats = stats;
  const g = gameById(id);
  toast(`${g ? g.title : 'Jeu'} fermé · ${fmtTime(seconds)} de jeu` + (backup?.file ? ' · sauvegardes copiées ✓' : ''));
  renderAll();
});
arcadia.onStateUpdate(st => { S = st; renderAll(); if (BP.on) bpRender(); });
arcadia.onResume(({ id, items }) => { const g = gameById(id); if (g) resumeModal(g, items); });
arcadia.onError(({ id, error }) => { running.delete(id); toast(`Impossible de lancer : ${error}`, true); renderAll(); });

// ------------------------------------------------------------ démarrage
(async () => {
  UI = { ...UI, ...(await arcadia.getUi()) };
  UI.collapsed = UI.collapsed || {};
  $('#sort').value = UI.sort;
  $('#zoom').value = UI.zoom;
  document.documentElement.style.setProperty('--card', UI.zoom + 'px');
  S = await arcadia.getState();
  const sel = $('#console-filter');
  for (const c of S.consoles) { const o = el('option', '', c.id); o.value = c.id; o.title = c.name; sel.append(o); }
  sel.value = UI.consoleFilter || '';
  (S.running || []).forEach(id => running.add(id));
  renderAll();
  await checkOrg();
  const up = await arcadia.checkUpdate().catch(() => null);
  if (up && await confirmBox(`Arcadia ${up.version} est disponible`, `Installer la nouvelle version maintenant ? Arcadia se ferme, se met à jour et se relance tout seul. Tes jeux, émulateurs, réglages et sauvegardes ne sont pas touchés.`)) {
    await arcadia.installUpdate(up.file); return;
  }
  if (S.settings.bigPictureOnStart) bpOpen();
})();

// ============================================================ 1.3 : fiche riche, sauvegardes, réglages par jeu
const DETAILS = {};
const UPD = {};
async function renderDetails(g) {
  const box = $('#g-about');
  const show = d => {
    if (selectedId !== g.id) return;
    const info = d && d.info;
    box.classList.remove('hidden');
    box.classList.toggle('no-shots', !(d && d.shots && d.shots.length));
    $('#g-meta-line').textContent = '';
    // fiche : studio, éditeur, sortie, genre, série, modes
    const facts = $('#g-facts'); facts.replaceChildren();
    const fact = (label, val) => { if (!val || (Array.isArray(val) && !val.length)) return; const f = el('div', 'fact'); f.append(el('span', 'fact-l', label), el('span', 'fact-v', Array.isArray(val) ? val.join(', ') : val)); facts.append(f); };
    if (d) {
      fact('Développeur', info?.developer); fact('Éditeur', info?.publisher?.length ? info.publisher : d.publisher);
      fact('Sortie', info?.release || d.release); fact('Genre', info?.genre); fact('Série', info?.series); fact('Modes', info?.modes);
    }
    const desc = (d && d.desc) || '';
    $('#g-desc').textContent = desc;
    $('#g-desc').classList.toggle('hidden', !desc);
    const src = $('#g-source'); src.replaceChildren(); src.classList.remove('hidden');
    if (info && info.source) {
      const a = el('a', '', info.lang === 'en' ? 'Résumé : Wikipédia (anglais)' : 'Source : Wikipédia / Wikidata');
      a.href = '#'; a.onclick = e => { e.preventDefault(); arcadia.openUrl(info.source); };
      src.append(a);
    } else if (!desc && !facts.children.length) {
      src.append(el('span', 'muted', d === null ? 'Recherche de la fiche…' : (d.infoError ? `Fiche indisponible (${d.infoError}).` : 'Aucune fiche trouvée en ligne pour ce titre.')));
    }
    if (d && !info) {
      const again = el('button', 'btn-ghost sm', 'Chercher à nouveau');
      again.onclick = async () => { again.disabled = true; again.textContent = 'Recherche…'; const nd = await arcadia.details(g.id, true).catch(() => null); if (nd) DETAILS[g.id] = nd; show(nd || d); };
      src.append(again);
    }
    const shots = $('#g-shots');
    shots.replaceChildren();
    for (const p of (d && d.shots) || []) {
      const i = el('img'); i.src = mediaUrl(p); i.loading = 'lazy'; i.alt = '';
      i.onclick = () => openModal(c => { c.className = 'modal-card shot'; const big = el('img'); big.src = mediaUrl(p); big.onclick = closeModal; c.append(big); }, true);
      shots.append(i);
    }
    const hero = $('#hero-bg');
    if (d && d.banner) { hero.style.backgroundImage = `url("${mediaUrl(d.banner)}")`; hero.classList.toggle('is-hero', d.bannerKind === 'hero'); hero.classList.toggle('is-shot', d.bannerKind !== 'hero'); }
  };
  if (DETAILS[g.id]) { show(DETAILS[g.id]); return; }
  show(null);
  const d = await arcadia.details(g.id).catch(() => null);
  if (d) DETAILS[g.id] = d;
  show(d || { shots: [] });
}

// ------------------------------------------------------------ multijoueur
const DISCORD = 'https://discord.gg/PKw6MyzzzD';
function discordLink(text) { const a = el('a', 'oops-link', text || 'Discord'); a.href = '#'; a.onclick = e => { e.preventDefault(); arcadia.openUrl(DISCORD); }; return a; }
const MULTI_ICON = { couch: '🎮', adhoc: '📡', wireless: '📶', ldn: '🌐', dswifi: '📶', dead: '⛔' };
async function renderMulti(g) {
  const box = $('#g-multi');
  box.classList.add('hidden');
  const m = await arcadia.gameMulti(g.id).catch(() => null);
  if (selectedId !== g.id || !m || m.solo) return;
  box.replaceChildren(el('h3', '', 'MULTIJOUEUR'));
  box.classList.remove('hidden');
  if (!m.known) {
    const p = el('p', 'muted');
    p.append(document.createTextNode('Je ne connais pas encore ce jeu. S\'il a un mode multijoueur, contacte-moi sur '), discordLink(), document.createTextNode(' pour que je le branche !'));
    box.append(p); return;
  }
  for (const mode of m.modes) {
    const row = el('div', 'multi-row' + (mode.ready ? '' : ' off'));
    const head = el('div', 'multi-head');
    head.append(el('span', 'multi-ico', MULTI_ICON[mode.type] || '•'));
    const t = el('div', ''); t.append(el('b', '', mode.label), el('span', 'muted small', mode.type === 'dead' ? 'Serveurs fermés' : `Jusqu'à ${mode.players} joueurs`));
    head.append(t); row.append(head);
    const acts = el('div', 'multi-acts');
    if (!mode.ready) {
      const p = el('p', 'small muted');
      p.append(document.createTextNode((mode.why || 'Pas encore branché.') + ' '));
      if (mode.type !== 'dead') p.append(document.createTextNode('Contacte-moi sur '), discordLink(), document.createTextNode(' pour que je regarde !'));
      acts.append(p);
    } else if (mode.type === 'couch') {
      acts.append(el('span', 'small muted', mode.how));
    } else if (mode.type === 'adhoc') {
      const pub = el('button', 'btn-white sm', 'Salle publique'); pub.title = 'Serveur ad hoc public : toi et tes amis choisissez la même salle, rien à configurer';
      pub.onclick = () => launchMulti(g, { type: 'adhoc', server: 'public', role: 'join' });
      const host = el('button', 'btn-ghost sm', 'Héberger'); host.onclick = () => multiModal(g, m, mode, 'host');
      const join = el('button', 'btn-ghost sm', 'Rejoindre'); join.onclick = () => multiModal(g, m, mode, 'join');
      acts.append(pub, host, join);
    } else if (mode.type === 'wireless') {
      if (mode.canHost) { const host = el('button', 'btn-white sm', 'Héberger un salon'); host.onclick = () => multiModal(g, m, mode, 'host'); acts.append(host); }
      const join = el('button', 'btn-ghost sm', 'Rejoindre'); join.onclick = () => multiModal(g, m, mode, 'join'); acts.append(join);
    }
    row.append(acts); box.append(row);
  }
}
async function launchMulti(g, o) {
  const r = await arcadia.playMulti(g.id, o);
  if (!r.ok) { toast(r.error, true); return; }
  if (r.manual) openModal(c => {
    c.append(el('h2', '', 'Dernière étape dans Azahar'));
    c.append(el('p', '', 'Azahar ne sait pas rejoindre un salon tout seul. Dans sa fenêtre : menu Multijoueur → Connexion directe → Connecter. L\'adresse est déjà remplie.' + (o.password ? ' Saisis le mot de passe du salon.' : '')));
    const a = el('div', 'modal-actions'); const ok = el('button', 'btn-white', 'Compris'); ok.onclick = closeModal; a.append(ok); c.append(a);
  });
}
function multiModal(g, m, mode, role) {
  openModal(card => {
    card.classList.add('multi-modal');
    const psp = mode.type === 'adhoc';
    card.append(el('h2', '', role === 'host' ? 'Héberger une partie' : 'Rejoindre une partie'));
    const f = el('div', 'multi-form');
    const field = (label, input) => { const l = el('label', ''); l.append(el('span', 'muted small', label), input); f.append(l); return input; };
    let ip, port, pass, max;
    if (role === 'host') {
      const addr = el('div', 'multi-addr');
      addr.append(el('div', 'muted small', 'Donne cette adresse à tes amis :'));
      addr.append(el('div', 'mono big', m.public ? `${m.public}` : 'adresse publique inconnue (hors ligne ?)'));
      if (m.lan.length) addr.append(el('div', 'muted small', `Même réseau (Wi-Fi/maison) : ${m.lan.join(' · ')}`));
      f.append(addr);
      if (!psp) { pass = field('Mot de passe (facultatif, pour un salon privé)', Object.assign(el('input'), { type: 'text', placeholder: 'aucun = salon ouvert' })); max = field('Joueurs max', Object.assign(el('input'), { type: 'number', min: 2, max: Math.min(16, mode.players || 8), value: Math.min(mode.players || 4, 8) })); port = field('Port', Object.assign(el('input'), { type: 'number', value: 24872 })); }
      const tip = el('p', 'small muted', psp
        ? 'Hors de chez toi, tes amis doivent pouvoir joindre ton PC : Arcadia tente l\'ouverture automatique (UPnP) ; sinon ouvre le port TCP 27312 sur ta box. Le plus simple reste la « Salle publique ».'
        : 'Hors de chez toi, ouvre le port UDP choisi (24872 par défaut) sur ta box vers ce PC.');
      f.append(tip);
    } else {
      ip = field('Adresse de l\'hôte', Object.assign(el('input'), { type: 'text', placeholder: 'ex. 82.65.10.20' }));
      if (!psp) { port = field('Port', Object.assign(el('input'), { type: 'number', value: 24872 })); pass = field('Mot de passe (si le salon en a un)', Object.assign(el('input'), { type: 'text' })); }
    }
    card.append(f);
    const a = el('div', 'modal-actions');
    const cancel = el('button', 'btn-ghost', 'Annuler'); cancel.onclick = closeModal;
    const go = el('button', 'btn-white', role === 'host' ? 'Lancer et héberger' : 'Rejoindre');
    go.onclick = () => {
      const o = { type: mode.type, role, server: 'private', ip: ip?.value.trim(), port: port?.value, password: pass?.value, max: max?.value };
      if (role === 'join' && !o.ip) { ip.focus(); return; }
      closeModal(); launchMulti(g, o);
    };
    a.append(cancel, go); card.append(a);
  });
}

async function renderSavesPanel(g) {
  const box = $('#g-saves');
  const r = await arcadia.savesList(g.id).catch(() => null);
  if (selectedId !== g.id) return;
  box.replaceChildren();
  if (!r || !r.emulator) { box.append(el('div', 'muted small', 'Choisis un émulateur pour ce jeu.')); return; }
  const ses = r.sessions || { count: 0, total: 0, last: [] };
  box.append(el('div', 'save-sum', ses.count ? `${ses.count} session(s) · ${fmtTime(ses.total)} au total` : 'Aucune session enregistrée pour l\'instant.'));
  box.append(el('div', 'muted small', (r.isolated ? 'Sauvegardes de ce jeu' : `Toutes les sauvegardes ${r.emulator}`) + ' copiées à chaque fermeture (10 dernières versions).'));
  const list = el('div', 'save-list');
  for (const b of r.items.slice(0, 5)) {
    const row = el('div', 'save-row');
    const when = b.date.replace(/^(.{19})-\d+$/, '$1').replace('_', ' ').replace(/-(\d\d)-(\d\d)$/, ':$1');
    row.append(el('span', '', when), el('span', 'muted small', b.here ? 'ce PC' : b.machine));
    const rb = el('button', 'btn-ghost sm', 'Restaurer');
    rb.onclick = async () => {
      if (!(await confirmBox('Restaurer cette sauvegarde ?', `Les sauvegardes de ce jeu seront remplacées par la copie du ${when}. L'état actuel est copié avant, par sécurité.`))) return;
      const res = await arcadia.savesRestore(g.id, b.file);
      toast(res.ok ? `Restauré : ${res.count} fichier(s).` : res.error, !res.ok);
      renderSavesPanel(g);
    };
    row.append(rb);
    list.append(row);
  }
  if (!r.items.length) list.append(el('div', 'muted small', 'Aucune copie pour l\'instant.'));
  const acts = el('div', 'save-acts');
  const now = el('button', 'btn-ghost sm', 'Copier maintenant');
  now.onclick = async () => { const res = await arcadia.savesBackup(g.id); toast(res.ok ? `Copie faite (${res.count} fichier(s)).` : `Rien copié : ${res.error}`, !res.ok); renderSavesPanel(g); };
  const open = el('button', 'btn-ghost sm', 'Dossier du jeu');
  open.onclick = () => arcadia.savesOpen(g.id);
  acts.append(now, open);
  if (r.emulator === 'arcadia') { // sauvegardes rapides faites depuis le menu en jeu (Échap)
    const st = el('button', 'btn-ghost sm', 'Sauvegardes rapides'); st.title = 'Emplacements créés avec « Sauvegarder maintenant » dans le menu en jeu';
    st.onclick = () => arcadia.statesOpen(g.id); acts.append(st);
  }
  box.append(list, acts);
}

async function renderGameSettings(g) {
  const box = $('#g-gset');
  const emus = await arcadia.gameEmulators(g.id).catch(() => []);
  if (selectedId !== g.id) return;
  const gs = (S.gameSettings || {})[g.id] || {};
  box.replaceChildren();
  const sel = el('select');
  const runnerDefault = (S.runnerConsoles || []).includes(g.console) && S.settings.useRunner !== false;
  sel.append(Object.assign(el('option', '', 'Par défaut (' + (runnerDefault ? 'Arcadia, moteur intégré' : (S.emulators[S.mapping[g.console]?.emulator]?.name || 'aucun')) + ')'), { value: '' }));
  for (const e of emus) sel.append(Object.assign(el('option', '', e.name), { value: e.id }));
  sel.value = gs.emulator || '';
  sel.onchange = async () => { S = await arcadia.gameSettings(g.id, { emulator: sel.value || null }); renderAll(); };
  const args = el('input'); args.placeholder = 'Arguments en plus (facultatif)'; args.value = gs.extraArgs || '';
  args.onchange = async () => { S = await arcadia.gameSettings(g.id, { extraArgs: args.value.trim() || null }); };
  const l1 = el('label', 'gset'); l1.append(el('span', 'muted small', 'Émulateur'), sel);
  const l2 = el('label', 'gset'); l2.append(el('span', 'muted small', 'Arguments'), args);
  const sc = el('button', 'btn-ghost sm', '🖥 Raccourci sur le Bureau');
  sc.onclick = () => desktopShortcut(g);
  box.append(l1, langField(g, gs), l2, sc);
}

async function desktopShortcut(g) {
  const r = await arcadia.shortcut(g.id);
  toast(r.ok ? `Raccourci « ${g.title} » créé sur le Bureau : double-clic = le jeu se lance.` : r.error, !r.ok);
}

async function renderSavesSettings(content) {
  content.append(group('Sauvegarde automatique', [
    appField('Copier les sauvegardes à la fermeture de chaque jeu', 'autoBackup', 'bool', null, 'Les 10 dernières copies sont gardées. En cas de sauvegarde abîmée, tu reviens en arrière depuis la page du jeu.'),
    appField('Proposer une sauvegarde plus récente venant d\'un autre PC', 'cloudPrompt', 'bool', null, 'Avant de lancer un jeu, si le dossier cloud contient une copie plus récente faite ailleurs.')
  ]));
  const cur = el('div', 'field');
  cur.append(el('div', 'fl', 'Dossier des copies'), el('div', 'mono', S.savesRoot || '—'));
  const rows = [cur];
  const pick = el('div', 'tool');
  const td = el('div', 'td'); td.append(el('b', '', 'Choisir un dossier'), el('div', '', 'Mets-le dans OneDrive / Google Drive / Dropbox : tes sauvegardes sont synchronisées entre tes PC.'));
  const acts = el('div', 'actions');
  const b1 = el('button', 'btn-ghost', 'Parcourir…'); b1.onclick = async () => { S = await arcadia.savesChooseDir(); SET.render(); };
  const b2 = el('button', 'btn-ghost', 'Ouvrir'); b2.onclick = () => arcadia.savesOpen();
  const b3 = el('button', 'btn-ghost', 'Par défaut'); b3.onclick = async () => { S = await arcadia.settings({ savesDir: '' }); SET.render(); };
  acts.append(b1, b2, b3); pick.append(td, acts); rows.push(pick);
  const gd = el('div', 'tool');
  const gtd = el('div', 'td'); gtd.append(el('b', '', '☁ Lier Google Drive'), el('div', '', 'Sauvegarde automatique sur ton Google Drive, via l\'application officielle « Google Drive pour ordinateur » (connexion à ton compte Google une seule fois).'));
  const gb = el('button', 'btn-white', 'Lier');
  gb.onclick = async () => {
    const r = await arcadia.linkDrive();
    if (r.ok) { S = r.state; SET.render(); toast(`Sauvegardes envoyées sur Google Drive : ${r.dir}`); }
    else toast('Installe « Google Drive pour ordinateur » (la page s\'est ouverte), connecte-toi, puis reclique sur « Lier ».', true);
  };
  gd.append(gtd, gb); rows.push(gd);
  for (const c of await arcadia.savesCloud()) {
    const r = el('div', 'tool');
    const t = el('div', 'td'); t.append(el('b', '', `☁ ${c.label} détecté`), el('div', 'mono', c.path + '\\Arcadia\\saves'));
    const b = el('button', 'btn-white', 'Utiliser');
    b.onclick = async () => { S = await arcadia.settings({ savesDir: c.path + '\\Arcadia\\saves' }); SET.render(); toast(`Sauvegardes synchronisées avec ${c.label}.`); };
    r.append(t, b); rows.push(r);
  }
  content.append(group('Cloud', rows));
}

// ============================================================ sons d'interface (synthétisés, aucun fichier)
let AC = null;
function sfx(kind) {
  if (!S?.settings?.uiSounds) return;
  try {
    AC ||= new AudioContext();
    const o = AC.createOscillator(), gn = AC.createGain();
    const t = AC.currentTime;
    const f = { move: [880, 0.035, 0.02], open: [660, 0.08, 0.04], back: [440, 0.07, 0.035], launch: [520, 0.35, 0.06] }[kind] || [700, 0.05, 0.03];
    o.type = 'sine'; o.frequency.setValueAtTime(f[0], t);
    if (kind === 'launch') o.frequency.exponentialRampToValueAtTime(1320, t + f[1]);
    gn.gain.setValueAtTime(f[2], t); gn.gain.exponentialRampToValueAtTime(0.0001, t + f[1]);
    o.connect(gn).connect(AC.destination); o.start(t); o.stop(t + f[1] + 0.02);
  } catch { /* audio indisponible */ }
}
document.addEventListener('click', e => { if (e.target.closest('.card, .recent, .lrow, .row')) sfx('open'); }, true);

// Fond d'ambiance : la jaquette survolée teinte légèrement l'arrière-plan
let ambT = null;
document.addEventListener('mouseover', e => {
  const c = e.target.closest('.card');
  if (!c || view !== 'home') return;
  clearTimeout(ambT);
  ambT = setTimeout(() => {
    const g = gameById(c.dataset.id);
    const src = g && (g.cover || g.icon);
    $('#main').style.setProperty('--amb', src ? `url("${mediaUrl(src)}")` : 'none');
  }, 120);
});

// ============================================================ navigation spatiale (flèches + manette)
function navTargets() {
  if (!$('#modal').classList.contains('hidden')) return [...document.querySelectorAll('#modal button, #modal input, #modal select, #modal .tool')].filter(x => x.offsetParent);
  if (view === 'game') return [...document.querySelectorAll('#view-game button, #view-game select, #view-game input, #view-game .shots img')].filter(x => x.offsetParent && !x.disabled);
  return [...document.querySelectorAll('#view-home .recent, #view-home .card, #view-home .lrow')].filter(x => x.offsetParent);
}
function moveFocus(dx, dy) {
  let list = navTargets();
  const curEl = document.activeElement;
  if (!list.length) return;
  const cur = document.activeElement && list.includes(document.activeElement) ? document.activeElement : null;
  if (!cur) { list[0].focus(); list[0].scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
  const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestD = Infinity;
  for (const el2 of list) {
    if (el2 === cur) continue;
    const b = el2.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const ddx = bx - ax, ddy = by - ay;
    if (dx && Math.sign(ddx) !== dx) continue;
    if (dy && Math.sign(ddy) !== dy) continue;
    if (dx && Math.abs(ddx) < 4) continue;
    if (dy && Math.abs(ddy) < 4) continue;
    const d = dx ? Math.abs(ddx) + Math.abs(ddy) * 3 : Math.abs(ddy) + Math.abs(ddx) * 3;
    if (d < bestD) { bestD = d; best = el2; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); sfx('move'); }
}
document.addEventListener('keydown', e => {
  if (BP.on && !capturing) { bpKey(e); return; }
  if (capturing || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) { e.preventDefault(); e.stopPropagation(); moveFocus(...dir); return; }
}, true);

// Manette (API Gamepad) : croix / stick = flèches, A = valider, B = retour, Y = favori, X = détails, Start = BigPicture
const PAD = { prev: {}, repeat: 0 };
function key(k) { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }
function padLoop() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (pads.length && document.hasFocus() && !running.size) {
    const p = pads[0], b = i => !!p.buttons[i]?.pressed, ax = i => p.axes[i] || 0;
    const now = { up: b(12) || ax(1) < -0.6, down: b(13) || ax(1) > 0.6, left: b(14) || ax(0) < -0.6, right: b(15) || ax(0) > 0.6, a: b(0), bb: b(1), x: b(2), y: b(3), start: b(9), lb: b(4), rb: b(5) };
    const t = performance.now();
    for (const [k, code] of [['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight']]) {
      if (now[k] && (!PAD.prev[k] || t > PAD.repeat)) { key(code); PAD.repeat = t + (PAD.prev[k] ? 110 : 380); }
    }
    const press = (k, fn) => { if (now[k] && !PAD.prev[k]) fn(); };
    press('lb', () => key('PageUp'));
    press('rb', () => key('PageDown'));
    press('a', () => { if (BP.on) { key('Enter'); return; } const a = document.activeElement; if (a && a !== document.body) { if (a.dataset?.id) { BP.on ? play(a.dataset.id) : openGame(a.dataset.id); } else a.click(); } else moveFocus(1, 0); });
    press('bb', () => { sfx('back'); key('Escape'); });
    press('y', () => key('y'));
    press('x', () => key('x'));
    press('start', () => (BP.on ? bpClose() : bpOpen()));
    PAD.prev = now;
  }
  requestAnimationFrame(padLoop);
}
window.addEventListener('gamepadconnected', () => toast('🎮 Manette connectée : croix pour naviguer, A pour valider, Start pour BigPicture.'));
requestAnimationFrame(padLoop);

// ============================================================ BigPicture (carrousel façon Steam)
// zone : 'games' (carrousel) | 'tiles' (rangée du bas) ; onglets : Tous, Récents, Favoris, puis une console par onglet
function bpTabs() {
  const recent = S.games.filter(g => !g.patch && statOf(g.id).lastPlayed).sort((a, b) => statOf(b.id).lastPlayed - statOf(a.id).lastPlayed);
  const all = sortGames(S.games.filter(g => !g.patch), 'title');
  const tabs = [{ id: 'all', label: 'Tous', list: all }];
  if (recent.length) tabs.push({ id: 'recent', label: 'Récents', list: recent });
  const favs = all.filter(g => isFav(g.id));
  if (favs.length) tabs.push({ id: 'fav', label: 'Favoris', list: favs });
  for (const c of S.consoles) { const l = all.filter(g => g.console === c.id); if (l.length) tabs.push({ id: c.id, label: c.id, list: l }); }
  return tabs;
}
function bpOpen() {
  BP.on = true; BP.zone = 'games'; BP.tile = 0;
  if (!BP.tab) BP.tab = 'all';
  $('#bp').classList.remove('hidden');
  document.body.classList.add('bp-on');
  arcadia.setFullscreen(true).then(prev => { BP.restoreFs = !prev; });
  const tick = () => { $('#bp-clock').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  tick(); BP.clock = setInterval(tick, 1000);
  bpRender();
  sfx('open');
}
function bpClose() {
  if (!BP.on) return;
  BP.on = false;
  $('#bp').classList.add('hidden');
  document.body.classList.remove('bp-on');
  clearInterval(BP.clock);
  if (BP.restoreFs) arcadia.setFullscreen(false);
  renderAll();
}
function bpCurrent() {
  const tabs = bpTabs();
  const tab = tabs.find(t => t.id === BP.tab) || tabs[0];
  BP.tab = tab.id;
  BP.index = Math.max(0, Math.min(BP.index ?? 0, tab.list.length - 1));
  return { tabs, tab, list: tab.list };
}
function bpRender() {
  const { tabs, tab, list } = bpCurrent();
  const nav = $('#bp-tabs');
  nav.replaceChildren(...tabs.map(t => { const b = el('button', t.id === tab.id ? 'on' : '', t.label); b.onclick = () => { BP.tab = t.id; BP.index = 0; bpRender(); }; return b; }));
  const track = $('#bp-track');
  // on garde les éléments existants pour que les transitions jouent
  const keep = new Map([...track.children].map(n => [n.dataset.id, n]));
  const frag = [];
  list.forEach((g, i) => {
    let n = keep.get(g.id);
    if (!n) {
      n = el('div', 'bp-item'); n.dataset.id = g.id;
      n.append(bigArt(g));
      n.onclick = () => { if (i === BP.index) play(g.id); else { BP.index = list.findIndex(x => x.id === g.id); BP.zone = 'games'; bpLayout(); } };
    }
    n.classList.toggle('fav', isFav(g.id));
    n.style.setProperty('--acc', consoleOf(g.console).color || '#fff');
    keep.delete(g.id); frag.push(n);
  });
  keep.forEach(n => n.remove());
  track.replaceChildren(...frag);
  // tuiles du bas
  const tiles = $('#bp-tiles');
  const pics = list.filter(g => g.cover || g.icon);
  const tileDefs = [
    ['Joués récemment', () => { BP.tab = tabs.some(t => t.id === 'recent') ? 'recent' : 'all'; BP.index = 0; BP.zone = 'games'; bpRender(); }, pics[0]],
    ['Favoris', () => { if (tabs.some(t => t.id === 'fav')) { BP.tab = 'fav'; BP.index = 0; BP.zone = 'games'; bpRender(); } else toast('Aucun favori : appuie sur Y sur un jeu.'); }, pics[1]],
    ['Statistiques', () => { bpClose(); showStats(); }, pics[2]],
    ['Paramètres', () => { bpClose(); openSettings(); }, pics[3]]
  ];
  tiles.replaceChildren(...tileDefs.map(([label, fn, g], i) => {
    const t = el('div', 'bp-tile'); t.tabIndex = -1; t.append(el('span', '', label));
    if (g) t.style.setProperty("--img", `url("${mediaUrl(g.cover || g.icon)}")`);
    t.onclick = fn; t.dataset.tile = i; return t;
  }));
  BP.tileFns = tileDefs.map(d => d[1]);
  bpLayout();
}
// Fond BigPicture : bannière (ou capture, à défaut jaquette) floutée et assombrie, fondu entre deux calques
let BG_LAYER = 0, BG_SRC = null;
function bpSetBg(g) {
  const d = g && DETAILS[g.id];
  const src = g && ((d && d.banner) || g.cover || g.icon);
  if (src === BG_SRC) return;
  BG_SRC = src;
  const layers = [$('#bp-bg'), $('#bp-bg2')];
  BG_LAYER ^= 1;
  const on = layers[BG_LAYER], off = layers[BG_LAYER ^ 1];
  on.style.backgroundImage = src ? `url("${mediaUrl(src)}")` : 'none';
  on.classList.toggle('cover', !(d && d.banner));
  on.classList.add('show'); off.classList.remove('show');
}
function bpLayout() {
  const { list } = bpCurrent();
  const items = [...$('#bp-track').children];
  const slot = Math.min(window.innerWidth * 0.2, 390);
  items.forEach((n, i) => {
    const d = i - BP.index, a = Math.abs(d);
    const x = Math.sign(d) * (a === 0 ? 0 : slot * 0.95 + (a - 1) * slot * 0.72);
    const sc = a === 0 ? 1.08 : a === 1 ? 0.8 : a === 2 ? 0.68 : 0.6;
    n.style.setProperty('--x', `${x}px`);
    n.style.setProperty('--s', sc);
    n.style.setProperty('--o', a > 4 ? 0 : a === 0 ? 1 : a === 1 ? 0.92 : a === 2 ? 0.7 : 0.45);
    n.style.setProperty('--z', 100 - a);
    n.classList.toggle('on', a === 0 && BP.zone === 'games');
  });
  [...$('#bp-tiles').children].forEach((t, i) => t.classList.toggle('on', BP.zone === 'tiles' && i === BP.tile));
  const g = list[BP.index];
  $('#bp-title').textContent = g ? g.title : 'Aucun jeu';
  const st = g ? statOf(g.id) : null;
  $('#bp-sub').textContent = g ? (st.playtime ? `${fmtTime(st.playtime)} · ${consoleOf(g.console).id}` : consoleOf(g.console).name) : '';
  bpSetBg(g);
  if (g && !DETAILS[g.id]) arcadia.details(g.id).then(d => { if (d) { DETAILS[g.id] = d; if (BP.on && bpCurrent().list[BP.index]?.id === g.id) bpSetBg(g); } }).catch(() => {});
  // précharge les fiches des voisins pour que le fond change sans attendre
  for (const k of [1, -1, 2]) { const n = list[BP.index + k]; if (n && !DETAILS[n.id]) arcadia.details(n.id).then(d => { if (d) DETAILS[n.id] = d; }).catch(() => {}); }
}
function bpKey(e) {
  const { tabs, list } = bpCurrent();
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  const k = e.key;
  if (!$('#modal').classList.contains('hidden')) { if (k === 'Escape') { stop(); closeModal(); } return; }
  const tabMove = dir => { const i = tabs.findIndex(t => t.id === BP.tab); BP.tab = tabs[(i + dir + tabs.length) % tabs.length].id; BP.index = 0; BP.zone = 'games'; sfx('move'); bpRender(); };
  if (k === 'PageUp' || k === 'q' || k === 'Q') { stop(); tabMove(-1); return; }
  if (k === 'PageDown' || k === 'e' || k === 'E') { stop(); tabMove(1); return; }
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    stop(); const dir = k === 'ArrowLeft' ? -1 : 1;
    if (BP.zone === 'games') BP.index = Math.max(0, Math.min(list.length - 1, BP.index + dir));
    else BP.tile = Math.max(0, Math.min(3, BP.tile + dir));
    sfx('move'); bpLayout(); return;
  }
  if (k === 'ArrowDown') { stop(); if (BP.zone !== 'tiles') { BP.zone = 'tiles'; sfx('move'); bpLayout(); } return; }
  if (k === 'ArrowUp') { stop(); if (BP.zone !== 'games') { BP.zone = 'games'; sfx('move'); bpLayout(); } return; }
  const g = list[BP.index];
  if (k === 'Enter') { stop(); if (BP.zone === 'tiles') BP.tileFns[BP.tile](); else if (g) play(g.id); return; }
  if (k === 'Escape') { stop(); bpClose(); return; }
  if ((k === 'y' || k === 'Y') && g && BP.zone === 'games') { stop(); arcadia.toggleFavorite(g.id).then(r => { S = r; bpRender(); }); return; }
  if ((k === 'x' || k === 'X') && g && BP.zone === 'games') { stop(); bpClose(); openGame(g.id); }
}
window.addEventListener('resize', () => { if (BP.on) bpLayout(); });
$('#btn-bp').onclick = () => bpOpen();

// ============================================================ 1.5
window.addEventListener('error', e => arcadia.log('ERREUR', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => arcadia.log('ERREUR', String(e.reason && e.reason.stack || e.reason)));

const normTitle = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
function duplicates() {
  const groups = {};
  for (const g of S.games) { if (g.patch) continue; (groups[g.console + '|' + normTitle(g.title)] ||= []).push(g); }
  return Object.values(groups).filter(l => l.length > 1);
}
function renderHealth() {
  const broken = S.games.filter(g => g.broken);
  const dups = duplicates();
  const box = $('#banner-health');
  const parts = [];
  if (broken.length) parts.push(`<b>${broken.length}</b> fichier(s) vide(s) ou abîmé(s)`);
  if (dups.length) parts.push(`<b>${dups.length}</b> jeu(x) en double`);
  box.classList.toggle('hidden', !parts.length || !!collection);
  $('#health-text').innerHTML = parts.join(' · ');
  $('#health-see').onclick = () => openModal(card => {
    card.append(el('h2', '', 'Santé de la bibliothèque'));
    if (broken.length) {
      card.append(el('h4', '', 'Fichiers vides ou abîmés'));
      card.append(el('p', 'muted', 'Ces fichiers ne contiennent que des zéros : ils ne se lanceront pas. Remplace-les par une copie saine.'));
      for (const g of broken) { const d = el('div', 'dup-group'); const r = el('div'); const b = el('button', 'btn-ghost sm', 'Afficher'); b.onclick = () => arcadia.showInFolder(g.id); r.append(el('span', '', `${g.console} · ${g.file}`), b); d.append(r); card.append(d); }
    }
    if (dups.length) {
      card.append(el('h4', '', 'Doublons'));
      for (const l of dups) {
        const d = el('div', 'dup-group');
        for (const g of l) { const r = el('div'); const b = el('button', 'btn-ghost sm', 'Afficher'); b.onclick = () => arcadia.showInFolder(g.id); r.append(el('span', '', `${g.file} · ${fmtSize(g.size)}`), b); d.append(r); }
        card.append(d);
      }
    }
    const a = el('div', 'modal-actions'); const ok = el('button', 'btn-white', 'Fermer'); ok.onclick = closeModal; a.append(ok); card.append(a);
  }, true);
}

function renderUpdates(g) {
  const box = $('#g-updates');
  const ups = g.titleId ? S.games.filter(p => p.patch && p.titleId === g.titleId) : [];
  box.classList.toggle('hidden', !ups.length);
  if (!ups.length) return;
  box.replaceChildren(el('h3', '', 'MISES À JOUR / DLC TROUVÉES'));
  box.append(el('div', 'muted small', 'Pour les appliquer : dans Eden, menu Fichier → « Installer des fichiers dans la NAND », puis choisis ce fichier. Arcadia le garde de côté pour qu\'il n\'encombre pas la bibliothèque.'));
  for (const u of ups) { const r = el('div', 'upd-row'); const b = el('button', 'btn-ghost sm', 'Afficher le fichier'); b.onclick = () => arcadia.showInFolder(u.id); r.append(el('span', '', u.file), b); box.append(r); }
}

async function renderMyShots(g) {
  const box = $('#g-myshots');
  const list = await arcadia.gameShots(g.id).catch(() => []);
  if (selectedId !== g.id) return;
  box.classList.toggle('hidden', !list.length);
  const grid = box.querySelector('.shots');
  grid.replaceChildren();
  for (const p of list) {
    const i = el('img'); i.src = mediaUrl(p); i.loading = 'lazy'; i.alt = '';
    i.onclick = () => openModal(c => { c.className = 'modal-card shot'; const big = el('img'); big.src = mediaUrl(p); big.onclick = closeModal; c.append(big); }, true);
    grid.append(i);
  }
}

async function remoteField() {
  const row = el('div', 'field');
  const l = el('div', 'fl'); l.append(el('span', '', 'Lancer mes jeux depuis mon téléphone'));
  const urls = el('div', 'tip mono');
  const show = list => { urls.textContent = list.length ? 'Ouvre sur ton téléphone : ' + list.join('   ou   ') : ''; };
  show(await arcadia.remoteUrls());
  l.append(urls);
  row.append(l, toggleEl(!!S.settings.remoteEnabled, async v => {
    const r = await arcadia.remoteSet(v);
    if (!r.ok) { toast('Impossible d\'ouvrir la télécommande : ' + r.error, true); return; }
    S.settings.remoteEnabled = v; show(r.urls);
  }));
  return row;
}

// ------------------------------------------------------------ statistiques
async function showStats() {
  view = 'stats';
  $('#view-home').classList.add('hidden'); $('#view-game').classList.add('hidden');
  const v = $('#view-stats'); v.classList.remove('hidden');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'stats'));
  $('#nav-home').classList.remove('active');
  const data = await arcadia.statsAll();
  const wrap = el('div', 'stats-wrap');
  const total = data.reduce((a, g) => a + (g.playtime || 0), 0);
  const sessions = data.flatMap(g => g.sessions);
  const days = new Set(sessions.map(x => new Date(x.start).toDateString()));
  let streak = 0; for (let d = new Date(); days.has(d.toDateString()); d.setDate(d.getDate() - 1)) streak++;
  const top = [...data].sort((a, b) => b.playtime - a.playtime);
  const kp = el('div', 'kpis');
  for (const [v2, l] of [[fmtTime(total), 'Temps de jeu total'], [String(data.filter(g => g.plays).length), 'Jeux lancés'], [String(sessions.length || data.reduce((a, g) => a + g.plays, 0)), 'Sessions'], [streak + ' j', 'Série en cours'], [top[0]?.playtime ? top[0].title : '—', 'Jeu le plus joué']]) {
    const k = el('div', 'kpi'); k.append(el('b', '', v2), el('span', '', l)); kp.append(k);
  }
  wrap.append(kp);
  const bars = (title, rows) => {
    const p = el('div', 'panel'); p.append(el('h3', '', title));
    const max = Math.max(1, ...rows.map(r => r[1]));
    const b = el('div', 'bars');
    for (const [name, val] of rows) { const r = el('div', 'bar-row'); const t = el('div', 'track'); const f = el('div', 'fill'); f.style.width = (100 * val / max) + '%'; t.append(f); r.append(el('span', '', name), t, el('span', 'muted', fmtTime(val))); b.append(r); }
    if (!rows.length) b.append(el('p', 'muted', 'Pas encore de partie : lance un jeu !'));
    p.append(b); return p;
  };
  wrap.append(bars('JEUX LES PLUS JOUÉS', top.filter(g => g.playtime).slice(0, 10).map(g => [g.title, g.playtime])));
  const byConsole = {}; for (const g of data) byConsole[g.console] = (byConsole[g.console] || 0) + (g.playtime || 0);
  wrap.append(bars('PAR CONSOLE', Object.entries(byConsole).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(([c, v2]) => [consoleOf(c).name, v2])));
  // carte de l'année
  const heat = el('div', 'panel'); heat.append(el('h3', '', `TON ANNÉE ${new Date().getFullYear()}`));
  const grid = el('div', 'heat');
  const perDay = {}; for (const x of sessions) { const k = new Date(x.start).toDateString(); perDay[k] = (perDay[k] || 0) + x.seconds; }
  const maxD = Math.max(1, ...Object.values(perDay));
  const start = new Date(new Date().getFullYear(), 0, 1);
  for (let i = 0; i < 371; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    if (d.getFullYear() !== start.getFullYear()) break;
    const c = el('i'); const v3 = perDay[d.toDateString()] || 0;
    if (v3) c.style.background = `rgba(255,255,255,${0.2 + 0.8 * v3 / maxD})`;
    c.title = `${d.toLocaleDateString('fr-FR')} · ${v3 ? fmtTime(v3) : 'pas de jeu'}`;
    grid.append(c);
  }
  grid.style.gridAutoFlow = 'column'; grid.style.gridTemplateRows = 'repeat(7, 12px)'; grid.style.gridTemplateColumns = 'none'; grid.style.gridAutoColumns = '12px';
  heat.append(grid);
  wrap.append(heat);
  v.replaceChildren(wrap);
}

arcadia.onClosing(({ id }) => { const g = gameById(id); toast(`🎮 Fermeture de ${g ? g.title : 'du jeu'}…`); });
// Animation d'intro (réglage mémorisé localement pour s'appliquer avant le chargement)
function introField() {
  let on = true;
  try { on = localStorage.getItem('arcadia.intro') !== 'off'; } catch { /* */ }
  const row = el('div', 'field');
  const l = el('div', 'fl'); l.append(el('span', '', 'Animation « ARCADIA » au démarrage'));
  row.append(l, toggleEl(on, v => { try { localStorage.setItem('arcadia.intro', v ? 'on' : 'off'); } catch { /* */ } }));
  return row;
}

// Nouveaux jeux détectés dans le dossier (téléchargement terminé, copie…)
arcadia.onLibraryChanged(({ added, newLoose }) => {
  if (added.length) toast(added.length === 1 ? `🎮 Nouveau jeu : ${added[0]}` : `🎮 ${added.length} nouveaux jeux ajoutés`);
  if (newLoose.length) {
    const n = newLoose[0];
    openModal(card => {
      card.append(el('h2', '', newLoose.length === 1 ? 'Nouveau jeu détecté' : `${newLoose.length} nouveaux jeux détectés`));
      card.append(el('p', '', newLoose.length === 1
        ? `« ${n.name} » est arrivé dans ton dossier${n.console ? ` : je le range dans ${n.console} ?` : ', hors des dossiers de console. Je le range ?'}`
        : 'Ils sont arrivés hors des dossiers de console. Je les range dans le dossier de leur console ?'));
      const a = el('div', 'modal-actions');
      const later = el('button', 'btn-ghost', 'Plus tard'); later.onclick = closeModal;
      const go = el('button', 'btn-white', 'Ranger'); go.onclick = () => { closeModal(); startImport(null, () => arcadia.sortLibrary()); };
      a.append(later, go); card.append(a);
    });
  }
});

// ------------------------------------------------------------ Manette : choix au premier lancement + calibrage
const PAD_SVG = {
  keyboard: '<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="6" width="58" height="28" rx="6"/><path d="M11 14h3M19 14h3M27 14h3M35 14h3M43 14h3M51 14h3M11 21h3M19 21h3M27 21h3M35 21h3M43 21h3M51 21h3M20 28h24"/></svg>',
  switch: '<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M14 6h36a10 10 0 0 1 10 10v4c0 10-4 16-9 16-4 0-6-5-8-9H21c-2 4-4 9-8 9-5 0-9-6-9-16v-4A10 10 0 0 1 14 6z"/><circle cx="18" cy="15" r="3.6"/><circle cx="40" cy="24" r="3.6"/><path d="M22 24h6M25 21v6"/><circle cx="46" cy="12" r="1.8" fill="currentColor"/><circle cx="50" cy="16" r="1.8" fill="currentColor"/><circle cx="42" cy="16" r="1.8"/><circle cx="46" cy="20" r="1.8"/></svg>',
  xbox: '<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M16 7h32c6 0 9 4 10 10l2 10c1 6-2 9-6 9-3 0-5-3-7-6H21c-2 3-4 6-7 6-4 0-7-3-6-9l2-10C11 11 10 7 16 7z"/><circle cx="20" cy="16" r="3.6"/><circle cx="38" cy="24" r="3.6"/><path d="M24 24h6M27 21v6"/><circle cx="46" cy="12" r="1.8"/><circle cx="50" cy="16" r="1.8"/><circle cx="42" cy="16" r="1.8"/><circle cx="46" cy="20" r="1.8" fill="currentColor"/></svg>',
  generic: '<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M16 7h32c6 0 9 4 10 10l2 10c1 6-2 9-6 9-3 0-5-3-7-6H21c-2 3-4 6-7 6-4 0-7-3-6-9l2-10C11 11 10 7 16 7z"/><path d="M19 15h6M22 12v6"/><circle cx="44" cy="15" r="2.2"/><path d="M27 24c2-3 8-3 10 0" stroke-dasharray="2 3"/><path d="M52 4l2 3 3 1-3 1-2 3-2-3-3-1 3-1z" fill="currentColor" stroke="none"/></svg>'
};
const PAD_TYPES = [
  ['keyboard', 'Clavier seulement', 'Rien à brancher · voir les touches'],
  ['switch', 'Manette Switch', 'Pro Controller, Joy-Con…'],
  ['xbox', 'Manette Xbox', 'Xbox, MSI, 8BitDo, PowerA…'],
  ['generic', 'Autre manette', 'PlayStation, USB générique… calibrage touche par touche']
];
// touches du clavier : positions physiques, affichées avec la disposition réelle (AZERTY, QWERTY…)
const KB_ROWS = [['ArrowUp', 'Croix directionnelle', '↑ ↓ ← →'], ['KeyX', 'Bouton A'], ['KeyZ', 'Bouton B'], ['KeyS', 'Bouton X'], ['KeyA', 'Bouton Y'], ['KeyQ', 'L'], ['KeyW', 'R'], ['Enter', 'Start', 'Entrée'], ['Backspace', 'Select', 'Retour arrière'], ['Escape', 'Menu Arcadia', 'Échap'], ['F5', 'Sauvegarder', 'F5'], ['Tab', 'Avance rapide', 'Tab'], ['Mouse', 'Écran tactile (DS, 3DS)', 'Souris']];
async function keyLabels() {
  const m = {};
  try { const lm = await navigator.keyboard.getLayoutMap(); for (const [code] of KB_ROWS) { const v = lm.get(code); if (v) m[code] = v.toUpperCase(); } } catch { /* API absente : noms QWERTY */ }
  for (const [code, , fixed] of KB_ROWS) if (!m[code]) m[code] = fixed || code.replace('Key', '');
  return m;
}
function padLabel(inp) {
  if (!inp || inp.type === 'keyboard') return 'Clavier & souris';
  return `${inp.name || 'Manette'}${inp.known ? '' : ' · calibrée'}`;
}
function inputModal(first) {
  openModal(card => {
    card.classList.add('input-modal');
    const paint = (view, data) => {
      card.replaceChildren();
      if (view === 'pick') {
        card.append(el('h2', '', first ? 'Manette ou clavier ? Les deux.' : 'Ta manette'));
        card.append(el('p', '', 'Dans tous tes jeux, la manette et le clavier marchent en même temps : joue avec l\'un, passe à l\'autre quand tu veux, sans rien régler.'));
        const facts = el('div', 'in-facts');
        for (const [ico, t] of [['✦', 'Manette reconnue toute seule (Xbox, Switch, PlayStation…)'], ['⌨', 'Clavier & souris toujours actifs'], ['↻', 'Calibrage automatique à tout moment, même en jeu : Échap → Manette']]) { const f = el('div'); f.append(el('b', '', ico), el('span', '', t)); facts.append(f); }
        card.append(facts);
        card.append(el('p', 'small muted', 'Choisis ta manette pour qu\'Arcadia la règle dès maintenant (facultatif) :'));
        const grid = el('div', 'in-grid');
        const cur = (S.settings.input || {}).type || 'keyboard';
        for (const [id, label, sub] of PAD_TYPES) {
          const b = el('button', 'in-opt' + (cur === id && S.settings.input ? ' on' : ''));
          const ico = el('div', 'in-ico'); ico.innerHTML = PAD_SVG[id];
          b.append(ico, el('b', '', label), el('span', '', sub));
          b.onclick = () => id === 'keyboard' ? paint('keyboard') : calibrate(id, false);
          grid.append(b);
        }
        card.append(grid);
        const acts = el('div', 'modal-actions');
        const later = el('button', 'btn-ghost', first ? 'Plus tard' : 'Fermer');
        later.onclick = async () => { if (first && !S.settings.input) S = await arcadia.inputSet({ type: 'keyboard' }); closeModal(); };
        acts.append(later); card.append(acts);
      } else if (view === 'keyboard') {
        card.append(el('h2', '', 'Clavier & souris'));
        card.append(el('p', '', 'Les touches sont placées au même endroit quelle que soit ta disposition de clavier.'));
        const tbl = el('div', 'in-keys');
        keyLabels().then(m => { for (const [code, what] of KB_ROWS) { const r = el('div', 'in-key'); r.append(el('kbd', '', m[code]), el('span', '', what)); tbl.append(r); } });
        card.append(tbl);
        const acts = el('div', 'modal-actions');
        const back = el('button', 'btn-ghost', 'Retour'); back.onclick = () => paint('pick');
        const ok = el('button', 'btn-white', 'C\'est parti'); ok.onclick = async () => { S = await arcadia.inputSet({ type: 'keyboard' }); closeModal(); toast('Clavier & souris : prêt'); if (SET.render) SET.render(); };
        acts.append(back, ok); card.append(acts);
      } else if (view === 'wait') {
        const ico = el('div', 'in-ico big pulse'); ico.innerHTML = PAD_SVG[data.layout];
        card.append(ico, el('h2', 'center', data.layout === 'generic' ? 'Appuie sur un bouton de ta manette' : 'Appuie sur A'));
        card.append(el('p', 'center', 'Une fenêtre Arcadia s\'est ouverte : branche ta manette si ce n\'est pas fait, puis suis les étapes. Si elle est reconnue, c\'est réglé en une seconde ; sinon Arcadia te demande chaque touche une fois.'));
      } else if (view === 'done') {
        const i = data.input;
        const ok = el('div', 'oops-ico', '✓'); card.append(ok);
        card.append(el('h2', 'center', 'Manette prête'));
        card.append(el('p', 'center strong', i.name));
        card.append(el('p', 'center', i.known ? 'Reconnue automatiquement : les touches sont au bon endroit dans tous tes jeux, moteurs externes compris.' : 'Calibrage enregistré : il s\'applique à tous tes jeux et à tous les moteurs.'));
        const acts = el('div', 'modal-actions');
        const redo = el('button', 'btn-ghost', 'Régler touche par touche'); redo.title = 'Si une touche n\'est pas au bon endroit';
        redo.onclick = () => calibrate(i.type, true);
        const fin = el('button', 'btn-white', 'Terminer'); fin.onclick = () => { closeModal(); if (SET.render) SET.render(); };
        acts.append(redo, fin); card.append(acts);
      }
    };
    const calibrate = async (layout, full) => {
      paint('wait', { layout });
      const r = await arcadia.inputCalibrate({ layout, full });
      if (r.ok) { S = r.state; paint('done', r); }
      else { paint('pick'); if (!r.cancelled) toast(r.error || 'Calibrage impossible', true); }
    };
    paint('pick');
  }, true);
}

// « Reprendre ta partie ? » pour les jeux sur émulateur externe : sauvegarde actuelle du jeu, ou une copie
const fmtCopy = iso => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
function resumeModal(g, items) {
  openModal(card => {
    card.classList.add('resume-modal');
    card.append(el('h2', '', 'Reprendre ta partie ?'));
    card.append(el('p', '', 'Continue là où le jeu s\'est arrêté, ou repars d\'une de tes copies de sauvegarde.'));
    const go = el('button', 'rs-main');
    const gt = el('div', 'rs-txt'); gt.append(el('b', '', '▶  Continuer'), el('span', '', 'Dernière sauvegarde du jeu'));
    if (items[0] && items[0].thumb) go.style.setProperty('--img', `url("${items[0].thumb}")`);
    go.append(gt);
    go.onclick = () => { closeModal(); play(g.id, { skipResume: true }); };
    card.append(go);
    card.append(el('div', 'rs-label', 'Ou repartir d\'une copie'));
    const grid = el('div', 'rs-grid');
    for (const it of items) {
      const b = el('button', 'rs-item');
      const im = el('div', 'rs-img'); if (it.thumb) im.style.backgroundImage = `url("${it.thumb}")`; else im.append(el('span', '', '◆'));
      b.append(im, el('b', '', fmtCopy(it.iso)), el('span', '', it.machine || ''));
      b.onclick = async () => {
        if (!await confirmBox('Repartir de cette copie ?', `La sauvegarde du ${fmtCopy(it.iso)} remplace celle du jeu. L'état actuel est copié avant, par sécurité.`)) return;
        const r = await arcadia.savesRestore(g.id, it.file);
        if (!r.ok) { toast(r.error, true); return; }
        closeModal(); toast('Copie remise en place'); play(g.id, { skipResume: true });
      };
      grid.append(b);
    }
    card.append(grid);
    const acts = el('div', 'modal-actions');
    const no = el('button', 'btn-ghost', 'Annuler'); no.onclick = closeModal;
    acts.append(no); card.append(acts);
    setTimeout(() => go.focus(), 50);
  }, true);
}

// Langue du jeu : seulement les langues proposées par la ROM (ou par la console quand la ROM ne les liste pas)
const LANG_NAMES = { fr: 'Français', 'fr-CA': 'Français (Canada)', en: 'Anglais', 'en-GB': 'Anglais (Royaume-Uni)', de: 'Allemand', it: 'Italien', es: 'Espagnol', 'es-419': 'Espagnol (Amérique latine)', nl: 'Néerlandais', pt: 'Portugais', 'pt-BR': 'Portugais (Brésil)', ru: 'Russe', ja: 'Japonais', ko: 'Coréen', 'zh-Hans': 'Chinois simplifié', 'zh-Hant': 'Chinois traditionnel' };
function langField(g, gs) {
  const l = el('label', 'gset');
  l.append(el('span', 'muted small', 'Langue du jeu'));
  const langs = g.langs || [];
  if (!langs.length) {
    const fixed = ['PS1', 'NES', 'SNES', 'GB', 'GBC', 'GBA', 'N64', 'MEGADRIVE'].includes(g.console);
    l.append(el('span', 'small', fixed ? 'Fixée par la version du jeu (une seule langue dans la ROM)' : 'Se règle dans le jeu ou dans l\'émulateur'));
    return l;
  }
  const sel = el('select');
  sel.append(Object.assign(el('option', '', langs.includes('fr') ? 'Automatique (français)' : 'Automatique (langue du jeu)'), { value: '' }));
  for (const c of langs) sel.append(Object.assign(el('option', '', LANG_NAMES[c] || c), { value: c }));
  sel.value = gs.lang && langs.includes(gs.lang) ? gs.lang : '';
  sel.onchange = async () => { S = await arcadia.gameSettings(g.id, { lang: sel.value || null }); toast(`Langue : ${sel.value ? LANG_NAMES[sel.value] : 'automatique'} (au prochain lancement)`); };
  l.append(sel);
  l.title = g.langsFromRom ? `Langues présentes dans la ROM : ${langs.map(c => LANG_NAMES[c] || c).join(', ')}` : 'Langue de la console émulée : le jeu l\'utilise s\'il la propose.';
  return l;
}
