// Langue du jeu : langues proposées par la ROM + réglage à appliquer à chaque moteur.
const LANGS = {
  fr: 'Français', 'fr-CA': 'Français (Canada)', en: 'Anglais', 'en-GB': 'Anglais (Royaume-Uni)', de: 'Allemand', it: 'Italien',
  es: 'Espagnol', 'es-419': 'Espagnol (Amérique latine)', nl: 'Néerlandais', pt: 'Portugais', 'pt-BR': 'Portugais (Brésil)',
  ru: 'Russe', ja: 'Japonais', ko: 'Coréen', 'zh-Hans': 'Chinois simplifié', 'zh-Hant': 'Chinois traditionnel'
};
const ORDER = Object.keys(LANGS);
const sortLangs = l => [...new Set(l)].filter(x => LANGS[x]).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

// Switch : bits « SupportedLanguageFlag » de control.nacp (même ordre que les titres)
const NACP = ['en', 'en-GB', 'ja', 'fr', 'de', 'es-419', 'es', 'it', 'nl', 'fr-CA', 'pt', 'ru', 'ko', 'zh-Hant', 'zh-Hans', 'pt-BR'];
function fromNacp(nacp) {
  if (!nacp || nacp.length < 0x3030) return null;
  const flags = nacp.readUInt32LE(0x302C);
  let out = NACP.filter((_, i) => flags & (1 << i));
  if (!out.length) out = NACP.filter((_, i) => nacp.toString('utf8', i * 0x300, i * 0x300 + 0x200).replace(/\0.*$/s, '').trim());
  return sortLangs(out);
}

// 3DS : titres SMDH remplis ∩ langues des régions autorisées
const SMDH = ['ja', 'en', 'fr', 'de', 'it', 'es', 'zh-Hans', 'ko', 'nl', 'pt', 'ru', 'zh-Hant'];
const REGION_LANGS = [['ja'], ['en', 'fr', 'es', 'pt'], ['en', 'fr', 'de', 'it', 'es', 'nl', 'pt', 'ru'], ['en'], ['zh-Hans'], ['ko'], ['zh-Hant']];
function fromSmdh(b) {
  if (!b || b.length < 0x2030 || b.toString('ascii', 0, 4) !== 'SMDH') return null;
  const filled = SMDH.filter((_, i) => b.toString('utf16le', 8 + i * 0x200, 8 + i * 0x200 + 0x80).replace(/\0.*$/s, '').trim());
  const region = b.readUInt32LE(0x2018);
  const allowed = region === 0x7FFFFFFF || !region ? null : new Set(REGION_LANGS.flatMap((l, i) => (region & (1 << i) ? l : [])));
  const out = allowed ? filled.filter(l => allowed.has(l)) : filled;
  return sortLangs(out.length ? out : filled);
}

// Consoles où la langue suit le réglage de la console émulée (la ROM ne les liste pas)
const CONSOLE_LANGS = {
  PSP: ['fr', 'en', 'de', 'it', 'es', 'nl', 'pt', 'ru', 'ja', 'ko', 'zh-Hans', 'zh-Hant'],
  DS: ['fr', 'en', 'de', 'it', 'es', 'ja']
};

// Option de cœur du moteur intégré
const CORE = {
  PSP: { key: 'ppsspp_language', v: { fr: 'French', en: 'English', de: 'German', it: 'Italian', es: 'Spanish', nl: 'Dutch', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', 'zh-Hans': 'Chinese Simplified', 'zh-Hant': 'Chinese Traditional' } },
  DS: { key: 'melonds_language', v: { fr: 'French', en: 'English', de: 'German', it: 'Italian', es: 'Spanish', ja: 'Japanese' } },
  '3DS': { key: 'citra_language_value', v: { fr: 'French', en: 'English', de: 'German', it: 'Italian', es: 'Spanish', nl: 'Dutch', pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese' } }
};
const REGION_3DS = l => (l === 'ja' ? 'Japan' : l === 'ko' ? 'Korea' : l === 'zh-Hans' ? 'China' : l === 'zh-Hant' ? 'Taiwan' : ['fr', 'de', 'it', 'nl', 'ru', 'en-GB'].includes(l) ? 'Europe' : null);
function runnerOpts(consoleId, lang) {
  const c = CORE[consoleId]; if (!c || !lang) return [];
  const base = lang.split('-')[0];
  const v = c.v[lang] || c.v[base]; if (!v) return [];
  const out = [`${c.key}=${v}`];
  if (consoleId === '3DS') { const r = REGION_3DS(lang); if (r) out.push(`citra_region_value=${r}`); }
  return out;
}

// Moteurs Switch (Eden) : System/language_index + région cohérente
const EDEN_LANG = { ja: 0, en: 1, fr: 2, de: 3, it: 4, es: 5, ko: 7, nl: 8, pt: 9, ru: 10, 'en-GB': 12, 'fr-CA': 13, 'es-419': 14, 'zh-Hans': 15, 'zh-Hant': 16, 'pt-BR': 17 };
const EDEN_REGION = l => (l === 'ja' ? 0 : ['en', 'fr-CA', 'es-419', 'pt-BR'].includes(l) ? 1 : l === 'zh-Hans' ? 4 : l === 'ko' ? 5 : l === 'zh-Hant' ? 6 : 2);
function switchOpts(lang) {
  if (lang == null || !(lang in EDEN_LANG)) return {};
  return { 'System/language_index': String(EDEN_LANG[lang]), 'System/region_index': String(EDEN_REGION(lang)) };
}

// Langue retenue : choix du joueur, sinon le français si le jeu l'a, sinon rien (réglage du moteur)
function pick(chosen, available) {
  if (chosen && (!available || !available.length || available.includes(chosen))) return chosen;
  if (available && available.length) return available.find(l => l === 'fr') || available.find(l => l === 'fr-CA') || null;
  return null;
}

module.exports = { LANGS, fromNacp, fromSmdh, CONSOLE_LANGS, runnerOpts, switchOpts, pick, sortLangs };
