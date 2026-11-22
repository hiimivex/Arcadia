// Fiche de jeu : Wikidata + Wikipédia simulés (formats réels des API)
const assert = require('assert');
const { wikiInfo, sgdbHero, cleanTitle } = require('../src/gameinfo');
const snak = id => ({ mainsnak: { datavalue: { value: { id } } } });
const R = {
  'wbsearchentities': { search: [{ id: 'Q1' }, { id: 'Q2' }, { id: 'Q3' }] },
  'ids=Q1|Q2|Q3': { entities: {
    Q1: { id: 'Q1', labels: { fr: { value: 'The 3rd Birthday' } }, claims: { P31: [snak('Q11424')] } }, // un film homonyme
    Q2: { id: 'Q2', labels: { fr: { value: 'The 3rd Birthday' } }, sitelinks: { frwiki: { title: 'The 3rd Birthday' } },
      claims: { P31: [snak('Q7889')], P400: [snak('Q170325')], P178: [snak('Q10')], P123: [snak('Q11')], P136: [snak('Q12')], P179: [snak('Q13')], P404: [snak('Q14')],
        P577: [{ mainsnak: { datavalue: { value: { time: '+2010-12-22T00:00:00Z', precision: 11 } } } }, { mainsnak: { datavalue: { value: { time: '+2011-03-29T00:00:00Z', precision: 11 } } } }] } },
    Q3: { id: 'Q3', labels: { en: { value: 'Birthday Party' } }, claims: { P31: [snak('Q7889')] } } } },
  'ids=Q10': { entities: { Q10: { labels: { fr: { value: 'HexaDrive' } } }, Q11: { labels: { fr: { value: 'Square Enix' } } }, Q12: { labels: { fr: { value: 'jeu de tir à la troisième personne' } } }, Q13: { labels: { fr: { value: 'Parasite Eve' } } }, Q14: { labels: { fr: { value: 'solo' } } } } },
  'summary/The_3rd_Birthday': { extract: 'The 3rd Birthday est un jeu vidéo d\'action…', content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/The_3rd_Birthday' } } }
};
const fake = async url => {
  const k = Object.keys(R).find(k => url.includes(k));
  return { ok: !!k, status: k ? 200 : 404, json: async () => R[k] };
};
(async () => {
  assert.strictEqual(cleanTitle('The_3rd_Birthday [ULES01513] (Europe)'), 'The 3rd Birthday');
  const i = await wikiInfo('The 3rd Birthday', 'PSP', { fetch: fake });
  assert.strictEqual(i.qid, 'Q2');
  assert.deepStrictEqual(i.developer, ['HexaDrive']);
  assert.deepStrictEqual(i.publisher, ['Square Enix']);
  assert.deepStrictEqual(i.genre, ['Jeu de tir à la troisième personne']);
  assert.strictEqual(i.series, 'Parasite Eve');
  assert.strictEqual(i.release, '22 décembre 2010');
  assert.strictEqual(i.lang, 'fr');
  assert.ok(i.desc.startsWith('The 3rd Birthday'));
  // rien de pertinent → null
  assert.strictEqual(await wikiInfo('Zzzz', 'PSP', { fetch: async () => ({ ok: true, json: async () => ({ search: [] }) }) }), null);
  // SteamGridDB
  const sg = async url => ({ ok: true, json: async () => url.includes('autocomplete') ? { data: [{ id: 7, name: 'The 3rd Birthday' }] } : { data: [{ url: 'https://x/a.png', score: 1 }, { url: 'https://x/b.png', score: 5 }] } });
  assert.strictEqual((await sgdbHero('The 3rd Birthday', 'k', { fetch: sg })).url, 'https://x/b.png');
  assert.strictEqual(await sgdbHero('x', '', { fetch: sg }), null);
  // titre régional différent : trouvé par la recherche plein texte
  const R2 = {
    'list=search': { query: { search: [{ title: 'Q5' }] } },
    'wbsearchentities': { search: [] },
    'ids=Q5&': { entities: { Q5: { id: 'Q5', labels: { en: { value: 'Avatar: The Last Airbender – The Burning Earth' } }, claims: { P31: [snak('Q7889')], P400: [snak('Q170323')] } } } }
  };
  const fake2 = async url => { const k = Object.keys(R2).find(k => url.includes(k)); return { ok: !!k, status: k ? 200 : 404, json: async () => R2[k] }; };
  const a = await wikiInfo('Avatar - The Legend of Aang - The Burning Earth (Europe) (Fr,Nl)', 'DS', { fetch: fake2 });
  assert.strictEqual(a && a.qid, 'Q5');
  console.log('fiche de jeu: OK');
})().catch(e => { console.error(e); process.exit(1); });
