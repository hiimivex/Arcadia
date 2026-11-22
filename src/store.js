const fs = require('fs');
const path = require('path');

// Petit stockage JSON (config + stats de jeu) dans le dossier utilisateur de l'app.
class Store {
  constructor(dir) {
    this.file = path.join(dir, 'arcadia.json');
    this.data = { libraryDir: null, emulatorsDir: null, mapping: {}, stats: {}, favorites: [] };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch { /* premier lancement */ }
  }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; this.save(); }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  recordPlay(gameId, seconds) {
    const s = this.data.stats[gameId] || { playtime: 0, plays: 0, lastPlayed: 0 };
    s.playtime += seconds;
    s.plays += 1;
    s.lastPlayed = Date.now();
    this.data.stats[gameId] = s;
    this.save();
  }
  toggleFavorite(gameId) {
    const fav = new Set(this.data.favorites);
    fav.has(gameId) ? fav.delete(gameId) : fav.add(gameId);
    this.data.favorites = [...fav];
    this.save();
    return this.data.favorites;
  }
}

module.exports = { Store };
