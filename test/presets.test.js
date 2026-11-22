// Chaque préréglage / option de débridage vise un champ existant avec une valeur autorisée.
const assert = require('assert');
const { SCHEMAS, allFields } = require('../src/emuschemas');
const { PRESETS, UNLOCKS } = require('../src/presets');
for (const [id, levels] of Object.entries(PRESETS)) {
  const schema = SCHEMAS.find(s => s.id === id);
  assert(schema, 'schéma manquant ' + id);
  const fields = Object.fromEntries(allFields(schema).map(f => [f.key, f]));
  for (const [lvl, changes] of Object.entries(levels)) for (const [k, v] of Object.entries(changes)) {
    const f = fields[k];
    assert(f, `${id}/${lvl} : champ inconnu ${k}`);
    if (f.type === 'select') assert(f.options.some(o => String(o[0]) === String(v)), `${id}/${lvl} : ${k}=${v} hors options`);
    if (f.type === 'bool') assert.strictEqual(typeof v, 'boolean', `${id} ${k}`);
  }
}
for (const [id, list] of Object.entries(UNLOCKS)) {
  const schema = SCHEMAS.find(s => s.id === id);
  const keys = new Set(allFields(schema).map(f => f.key));
  for (const u of list) assert(keys.has(u.key) || u.extra, `${id} : ${u.key} sans définition`);
}
console.log('préréglages: OK');
