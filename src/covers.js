// Jaquettes depuis la base libre libretro-thumbnails (GitHub), sans clé d'API.
// L'index d'une console = 1 requête, mis en cache 30 jours. Les images sont mises en cache sur disque.
const fs = require('fs');
const path = require('path');

const REPOS = {
  '3DS': ['Nintendo_-_Nintendo_3DS'],
  DS: ['Nintendo_-_Nintendo_DS', 'Nintendo_-_Nintendo_DSi'],
  WIIU: ['Nintendo_-_Wii_U'],
  PS4: ['Sony_-_PlayStation_4'],
  PS3: ['Sony_-_PlayStation_3'],
  PSVITA: ['Sony_-_PlayStation_Vita'],
  XBOX360: ['Microsoft_-_Xbox_360'],
  XBOX: ['Microsoft_-_Xbox'],
  PSP: ['Sony_-_PlayStation_Portable'],
  PS2: ['Sony_-_PlayStation_2'],
  PS1: ['Sony_-_PlayStation'],
  GAMECUBE: ['Nintendo_-_GameCube'],
  WII: ['Nintendo_-_Wii'],
  N64: ['Nintendo_-_Nintendo_64'],
  GBA: ['Nintendo_-_Game_Boy_Advance'],
  GB: ['Nintendo_-_Game_Boy', 'Nintendo_-_Game_Boy_Color'],
  SNES: ['Nintendo_-_Super_Nintendo_Entertainment_System'],
  NES: ['Nintendo_-_Nintendo_Entertainment_System', 'Nintendo_-_Family_Computer_Disk_System'],
  MEGADRIVE: ['Sega_-_Mega_Drive_-_Genesis'],
  DREAMCAST: ['Sega_-_Dreamcast']
};

// "The Legend of Zelda: Ocarina of Time (Europe) [!]" -> "legendofzeldaocarinaoftime"
function norm(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .toLowerCase()
    .replace(/&|\band\b/g, ' ') // libretro écrit "Mario _ Sonic" pour "Mario & Sonic"
    .replace(/,\s*the\b/g, ' ').replace(/^\s*the\s+/, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

function regionScore(name) {
  const n = name.toLowerCase();
  let s = 5;
  if (n.includes('(france')) s = 0;
  else if (n.includes('(europe')) s = 1;
  else if (n.includes('(world')) s = 2;
  else if (n.includes('(usa')) s = 3;
  if (/\((demo|beta|proto|kiosk|sample|preview)/i.test(n) || /\(.*(demo|kiosk|beta)/i.test(n)) s += 20;
  return s;
}

// Titres français / abréviations → nom anglais utilisé par libretro-thumbnails
const ALIASES = [
  [/^gta\b/i, 'Grand Theft Auto'], [/^mgs\b/i, 'Metal Gear Solid'], [/^nfs\b/i, 'Need for Speed'], [/^kh\b/i, 'Kingdom Hearts'],
  [/^professeur layton et l['’ ]?(é|e)trange village/i, 'Professor Layton and the Curious Village'],
  [/^professeur layton et la bo(î|i)te de pandore/i, 'Professor Layton and the Diabolical Box'],
  [/^professeur layton et le destin perdu/i, 'Professor Layton and the Lost Future'],
  [/^professeur layton et l['’ ]?appel du spectre/i, 'Professor Layton and the Spectre\'s Call'],
  [/^professeur layton et le masque des miracles/i, 'Professor Layton and the Miracle Mask'],
  [/^professeur layton et l['’ ]?h(é|e)ritage des aslantes/i, 'Professor Layton and the Azran Legacy'],
  [/^professeur layton/i, 'Professor Layton'],
  [/^pok(é|e)mon (version )?ultra[- ]soleil/i, 'Pokemon Ultra Sun'], [/^pok(é|e)mon (version )?ultra[- ]lune/i, 'Pokemon Ultra Moon'],
  [/^pok(é|e)mon (version )?soleil/i, 'Pokemon Sun'], [/^pok(é|e)mon (version )?lune/i, 'Pokemon Moon'],
  [/^pok(é|e)mon (version )?rubis (o|ô)m(é|e)ga/i, 'Pokemon Omega Ruby'], [/^pok(é|e)mon (version )?saphir alpha/i, 'Pokemon Alpha Sapphire'],
  [/^pok(é|e)mon (version )?diamant/i, 'Pokemon - Diamond Version'], [/^pok(é|e)mon (version )?perle/i, 'Pokemon - Pearl Version'],
  [/^pok(é|e)mon (version )?platine/i, 'Pokemon - Platinum Version'], [/^pok(é|e)mon (version )?or heartgold/i, 'Pokemon - HeartGold Version'],
  [/^pok(é|e)mon (version )?argent soulsilver/i, 'Pokemon - SoulSilver Version'],
  [/^pok(é|e)mon donjon myst(è|e)re/i, 'Pokemon Mystery Dungeon'], [/^pok(é|e)mon ranger/i, 'Pokemon Ranger'],
  [/^la l(é|e)gende de zelda|^zelda/i, 'Legend of Zelda, The -'],
  [/^entra(î|i)nement c(é|e)r(é|e)bral|^programme d['’ ]?entra(î|i)nement c(é|e)r(é|e)bral/i, 'Brain Age - Train Your Brain in Minutes a Day']
];
function aliases(titles) {
  const out = [...titles];
  for (const t of titles) {
    const s = String(t || '').trim();
    for (const [re, en] of ALIASES) if (re.test(s)) { out.push(s.replace(re, en)); break; }
  }
  return [...new Set(out)];
}
// Suite d'un autre jeu (« Brain Age » ≠ « Brain Age 2 ») : le nom continue par un chiffre ou un chiffre romain
const sequelOf = (n, k) => n.length > k.length && n.startsWith(k) && /^([0-9]|ii|iii|iv|v[^a-z]|vi)/.test(n.slice(k.length));

class Covers {
  constructor(cacheDir) {
    this.dir = cacheDir;
    this.indexDir = path.join(cacheDir, 'index');
    fs.mkdirSync(this.indexDir, { recursive: true });
    this.mem = {};
  }

  // Index d'un dépôt : { Named_Boxarts: [[norm, nom]], Named_Snaps: [...], Named_Titles: [...] }
  async index(repo, kind = 'Named_Boxarts') {
    if (!this.mem[repo]) this.mem[repo] = await this.loadIndex(repo);
    return this.mem[repo][kind] || [];
  }

  async loadIndex(repo) {
    const file = path.join(this.indexDir, repo + '.v2.json');
    const build = raw => Object.fromEntries(Object.entries(raw).map(([k, names]) => [k, names.map(n => [norm(n), n])]));
    try {
      if (Date.now() - fs.statSync(file).mtimeMs < 30 * 864e5) return build(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* pas encore en cache */ }
    const res = await fetch(`https://api.github.com/repos/libretro-thumbnails/${repo}/git/trees/master?recursive=1`, {
      headers: { 'User-Agent': 'Arcadia', Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(`index ${repo}: HTTP ${res.status}`);
    const data = await res.json();
    const raw = { Named_Boxarts: [], Named_Snaps: [], Named_Titles: [] };
    for (const e of data.tree) {
      const slash = e.path.indexOf('/');
      const k = e.path.slice(0, slash);
      if (raw[k] && e.path.endsWith('.png')) raw[k].push(e.path.slice(slash + 1, -4));
    }
    fs.writeFileSync(file, JSON.stringify(raw)); // noms bruts : la normalisation peut évoluer
    return build(raw);
  }

  // Meilleur nom libretro pour un titre, ou null.
  static pick(idx, titles) {
    titles = aliases(titles);
    for (const t of titles) {
      const k = norm(t);
      if (k.length < 2) continue;
      const exact = idx.filter(([n]) => n === k);
      if (exact.length) return exact.sort((a, b) => regionScore(a[1]) - regionScore(b[1]))[0][1];
    }
    for (const t of titles) {
      const k = norm(t);
      if (k.length < 5) continue;
      const near = idx.filter(([n]) => (n.startsWith(k) && !sequelOf(n, k)) || (k.startsWith(n) && n.length >= 6));
      if (near.length) {
        near.sort((a, b) => Math.abs(a[0].length - k.length) - Math.abs(b[0].length - k.length) || regionScore(a[1]) - regionScore(b[1]));
        return near[0][1];
      }
    }
    // Dernier recours : tous les mots du titre présents dans le nom (« Pokémon Lune » -> « Pokemon - Version Lune »)
    const words = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !['the', 'and', 'of', 'version'].includes(w));
    for (const t of titles) {
      const want = words(t);
      if (want.length < 2) continue;
      const hits = idx.filter(([, name]) => { const have = new Set(words(name)); return want.every(w => have.has(w)); });
      if (hits.length) {
        hits.sort((a, b) => words(a[1]).length - words(b[1]).length || regionScore(a[1]) - regionScore(b[1]));
        return hits[0][1];
      }
    }
    return null;
  }

  // Télécharge la jaquette d'un jeu vers dest. Renvoie true si trouvée.
  // kind : Named_Boxarts (jaquette), Named_Snaps (capture en jeu), Named_Titles (écran titre)
  async fetchCover(consoleId, titles, dest, ext, kind = 'Named_Boxarts') {
    let repos = REPOS[consoleId];
    if (!repos) return false;
    if (consoleId === 'GB' && ext === 'gbc') repos = [...repos].reverse();
    for (const repo of repos) {
      const name = Covers.pick(await this.index(repo, kind), titles);
      if (!name) continue;
      const url = `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/${kind}/${encodeURIComponent(name)}.png`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Arcadia' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) continue;
      fs.writeFileSync(dest, buf);
      return true;
    }
    return false;
  }
}

module.exports = { Covers, norm, REPOS };
