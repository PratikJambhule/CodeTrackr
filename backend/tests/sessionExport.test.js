/**
 * Tests for services/sessionExport.js — saved sessions to training rows (ML plan C-16, M4).
 * Run: node tests/sessionExport.test.js
 */
const assert = require('assert');
const { exportRows, toCsv } = require('../services/sessionExport');
const { FEATURES_V3 } = require('../services/workTypeFeatures');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const feats = Object.fromEntries(FEATURES_V3.map((f, i) => [f, i / 100]));
const s = (over) => ({ userId: 'u1', durationSec: 1800, featureVersion: 3, features: feats, workType: { type: 'project' }, ...over });

console.log('\nsessionExport');

check('label priority and the blind flag: picker and blind measure accuracy, shown does not', () => {
  const { rows } = exportRows([
    s({ pickerLabel: { type: 'dsa' }, userLabel: { type: 'project', source: 'shown' } }),
    s({ userLabel: { type: 'learning', source: 'blind' } }),
    s({ userLabel: { type: 'setup', source: 'shown' } }),
  ], { salt: 'x' });
  assert.deepStrictEqual(rows.map((r) => [r.label, r.labelSource, r.blind]), [['dsa', 'picker', 1], ['learning', 'blind', 1], ['setup', 'shown', 0]]);
});

check('unlabelled sessions, other feature versions and non-type labels are left out', () => {
  const { rows } = exportRows([
    s({}),                                                   // only a guess
    s({ featureVersion: 2, userLabel: { type: 'dsa', source: 'blind' } }),
    s({ userLabel: { type: 'not_sure', source: 'shown' } }),
  ], { salt: 'x' });
  assert.strictEqual(rows.length, 0);
});

check('columns: metadata then the 33 features in order; values are the stored features', () => {
  const out = exportRows([s({ userLabel: { type: 'dsa', source: 'blind' } })], { salt: 'x' });
  assert.deepStrictEqual(out.columns.slice(-33), FEATURES_V3);
  assert.strictEqual(out.columns[out.columns.indexOf('activeMin') + 1], FEATURES_V3[0]);
  assert.strictEqual(out.rows[0].runShare, feats.runShare);
  assert.strictEqual(out.rows[0].activeMin, 30);
  assert.strictEqual(out.rows[0].ruleType, 'project');
});

check('people get a random id per export: never the user id, stable within one export', () => {
  const a = exportRows([s({ userId: 'secret-user', userLabel: { type: 'dsa', source: 'blind' } }),
    s({ userId: 'secret-user', userLabel: { type: 'setup', source: 'blind' } })], { salt: 'one' });
  assert.strictEqual(a.rows[0].personId, a.rows[1].personId);
  const b = exportRows([s({ userId: 'secret-user', userLabel: { type: 'dsa', source: 'blind' } })], { salt: 'two' });
  assert.notStrictEqual(a.rows[0].personId, b.rows[0].personId);
  assert.ok(!toCsv(a).includes('secret-user'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
