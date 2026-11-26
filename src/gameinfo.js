// Fiche d'un jeu sans clé d'API : Wikidata (studio, éditeur, sortie, genre, série, modes)
// + résumé Wikipédia en français (anglais à défaut). Bannière « hero » via SteamGridDB si une clé est fournie.
const UA = 'Arcadia/1.8 (lanceur de jeux open source)';

// Plateformes Wikidata (P400) → bonus quand le jeu existe sur la bonne console
const PLATFORM_QID = {
  PSP: 'Q170325', DS: 'Q170323', '3DS': 'Q203597', SWITCH: 'Q19610114', GBA: 'Q188642', GB: 'Q186437', GBC: 'Q203992',
  NES: 'Q172742', SNES: 'Q183259', N64: 'Q184839', GAMECUBE: 'Q182172', WII: 'Q8079', WIIU: 'Q56942',
  PS1: 'Q10677', PS2: 'Q10680', PS3: 'Q10683', PS4: 'Q5014725', PSVITA: 'Q188808', MEGADRIVE: 'Q10676', DREAMCAST: 'Q184198'
};
// Instances acceptées : jeu vidéo, remaster, remake, jeu épisodique…
const GAME_QIDS = new Set(['Q7889', 'Q21125433', 'Q65963104', 'Q111223304', 'Q4393107', 'Q865493', 'Q16070115', 'Q61476627']);

function cleanTitle(t) {
  return String(t || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').trim();
}
const norm = s => cleanTitle(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function makeFetch(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  return async (url, opts = {}) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await f(url, { ...opts, headers: { 'User-Agent': UA, 'Api-User-Agent': UA, ...(opts.headers || {}) }, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  };
}

const claimIds = (ent, p) => ((ent.claims || {})[p] || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean);
function claimDates(ent, p) {
  return ((ent.claims || {})[p] || []).map(c => {
    const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (!v || !v.time) return null;
    const m = v.time.match(/^[+-](\d{4})-(\d{2})-(\d{2})/); if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3], precision: v.precision || 9, sort: `${m[1]}${m[2]}${m[3]}` };
  }).filter(Boolean).sort((a, b) => a.sort.localeCompare(b.sort));
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function fmtDate(d) {
  if (!d) return null;
  if (d.precision >= 11 && d.d) return `${d.d === 1 ? '1er' : d.d} ${MOIS[d.m - 1]} ${d.y}`;
  if (d.precision >= 10 && d.m) return `${MOIS[d.m - 1]} ${d.y}`;
  return String(d.y);
}

// Choisit l'entité Wikidata la plus probable
function score(ent, wanted, consoleId) {
  const inst = claimIds(ent, 'P31');
  if (!inst.some(q => GAME_QIDS.has(q))) return -1;
  let s = 10;
  const labels = Object.values(ent.labels || {}).map(l => norm(l.value));
  const aliases = Object.values(ent.aliases || {}).flat().map(a => norm(a.value));
  if (labels.includes(wanted)) s += 6; else if (aliases.includes(wanted)) s += 4;
  else if (labels.some(l => l && (l.startsWith(wanted) || wanted.startsWith(l)))) s += 2;
  else { // mots significatifs en commun (titres régionaux différents)
    const w = new Set(wanted.split(' ').filter(x => x.length > 2));
    const best = Math.max(0, ...[...labels, ...aliases].map(l => l.split(' ').filter(x => w.has(x)).length / Math.max(1, w.size)));
    s += best >= .6 ? 3 : best >= .4 ? 1 : -4;
  }
  const plat = PLATFORM_QID[String(consoleId || '').toUpperCase()];
  if (plat && claimIds(ent, 'P400').includes(plat)) s += 8;
  if ((ent.sitelinks || {}).frwiki) s += 1;
  return s;
}

async function wikiInfo(title, consoleId, opts = {}) {
  const get = makeFetch(opts.fetch);
  const q = cleanTitle(title); const wanted = norm(title);
  if (!q) return null;
  const ids = new Set();
  // 1) recherche plein texte limitée aux jeux vidéo (tolère « Legend of Aang » / « Last Airbender », tirets, sous-titres…)
  const words = q.replace(/[:\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    const r = await get(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(words + ' haswbstatement:P31=Q7889')}&srlimit=8&format=json`);
    for (const x of (r.query && r.query.search) || []) if (/^Q\d+$/.test(x.title)) ids.add(x.title);
  } catch { /* on tente la recherche par libellé */ }
  // 2) recherche par libellé, avec quelques variantes du titre
  const variants = [...new Set([q, q.replace(/\s+-\s+/g, ': '), q.split(/\s+-\s+/)[0]].filter(v => v && v.length > 2))];
  for (const v of variants) {
    if (ids.size >= 8) break;
    for (const lang of ['fr', 'en']) {
      const r = await get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(v)}&language=${lang}&uselang=fr&type=item&limit=6&format=json`);
      for (const x of r.search || []) ids.add(x.id);
    }
  }
  if (!ids.size) return null;
  const e = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...ids].slice(0, 12).join('|')}&props=claims|sitelinks|labels|aliases&languages=fr|en&format=json`);
  const ents = Object.values(e.entities || {});
  const best = ents.map(x => ({ x, s: score(x, wanted, consoleId) })).filter(o => o.s >= 12).sort((a, b) => b.s - a.s)[0];
  if (!best) return null;
  const ent = best.x;
  const want = { developer: claimIds(ent, 'P178'), publisher: claimIds(ent, 'P123'), genre: claimIds(ent, 'P136'), series: claimIds(ent, 'P179'), modes: claimIds(ent, 'P404') };
  const all = [...new Set(Object.values(want).flat())].slice(0, 40);
  const labels = {};
  if (all.length) {
    const l = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${all.join('|')}&props=labels&languages=fr|en&format=json`);
    for (const [id, v] of Object.entries(l.entities || {})) labels[id] = (v.labels && (v.labels.fr || v.labels.en) || {}).value;
  }
  const lab = list => [...new Set(list.map(id => labels[id]).filter(Boolean))];
  const dates = claimDates(ent, 'P577');
  const info = {
    qid: ent.id,
    title: (ent.labels && (ent.labels.fr || ent.labels.en) || {}).value || q,
    developer: lab(want.developer).slice(0, 3), publisher: lab(want.publisher).slice(0, 3),
    genre: lab(want.genre).slice(0, 3).map(g => g.charAt(0).toUpperCase() + g.slice(1)),
    series: lab(want.series)[0] || null, modes: lab(want.modes).slice(0, 3).map(g => g.charAt(0).toUpperCase() + g.slice(1)),
    release: fmtDate(dates[0]), year: dates[0] ? dates[0].y : null,
    desc: null, lang: null, source: `https://www.wikidata.org/wiki/${ent.id}`
  };
  // Résumé Wikipédia
  for (const lang of ['fr', 'en']) {
    const page = ent.sitelinks && ent.sitelinks[`${lang}wiki`] && ent.sitelinks[`${lang}wiki`].title;
    if (!page) continue;
    try {
      const s = await get(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, '_'))}`);
      if (s.extract) {
        info.desc = s.extract; info.lang = lang;
        info.source = (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page)}`;
        break;
      }
    } catch { /* page absente : on essaie l'autre langue */ }
  }
  return info;
}

// Bannière large façon Steam (« hero ») — clé gratuite sur steamgriddb.com/profile/preferences/api
async function sgdbHero(title, key, opts = {}) {
  if (!key) return null;
  const get = makeFetch(opts.fetch);
  const auth = { headers: { Authorization: `Bearer ${key}` } };
  const s = await get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleanTitle(title))}`, auth);
  const game = (s.data || [])[0];
  if (!game) return null;
  const h = await get(`https://www.steamgriddb.com/api/v2/heroes/game/${game.id}?types=static&nsfw=false&humor=false`, auth);
  const hero = (h.data || []).filter(x => (x.width || 0) >= 1920).sort((a, b) => (b.score || 0) - (a.score || 0) || (b.width || 0) - (a.width || 0))[0]; // grandes bannières nettes seulement
  return hero ? { url: hero.url, game: game.name } : null;
}

module.exports = { wikiInfo, sgdbHero, cleanTitle, norm, fmtDate, PLATFORM_QID };
