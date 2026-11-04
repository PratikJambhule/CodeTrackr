/**
 * Tests for services/ratingOutlook.js — the rating outlook model run in Node (D-63).
 *  - parity: the exported trees give the same three percentiles as Python, on 20 held-out people;
 *  - features: the 14 inputs computed here equal the training table's (ml/fetch_codeforces.js);
 *  - the outlook: range order, eligibility, the "harder problems" what-if.
 * Run: node tests/ratingOutlook.test.js
 */
const assert = require('assert');
const { predict, features, outlook, MIN_CONTESTS } = require('../services/ratingOutlook');
const { rowsFor } = require('../../ml/fetch_codeforces');
const model = require('../ml/ratingOutlookModel.json');
const parity = require('./fixtures/ratingOutlookParity.json');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\nratingOutlook');

check('parity fixtures come from this model version, with the three percentiles', () => {
  assert.strictEqual(parity.modelVersion, model.version);
  assert.strictEqual(parity.cases.length, 20);
  assert.deepStrictEqual(model.quantiles, [0.1, 0.5, 0.9]);
});

check('JavaScript matches Python on all 20 held-out cases (to 0.01 rating points)', () => {
  for (const c of parity.cases) {
    const got = predict(c.features);
    for (const q of ['0.1', '0.5', '0.9']) assert.ok(Math.abs(got[q] - c.expected[q]) < 0.01, `q${q}: ${got[q]} vs ${c.expected[q]}`);
  }
});

// A made-up person: 12 contests 2 weeks apart, practice every few days with rated problems.
const DAY = 86400;
const T0 = 1_700_000_000;
const history = Array.from({ length: 12 }, (_, i) => ({ ratingUpdateTimeSeconds: T0 + i * 14 * DAY, oldRating: 1300 + i * 15, newRating: 1315 + i * 15 }));
const subs = [];
for (let d = 0; d < 170; d += 3) {
  subs.push({ creationTimeSeconds: T0 + d * DAY + 3600, verdict: d % 9 ? 'OK' : 'WRONG_ANSWER', problem: { contestId: 1000 + d, index: 'A', rating: 1000 + (d % 7) * 150, tags: [] } });
  subs.push({ creationTimeSeconds: T0 + d * DAY + 7200, verdict: 'OK', problem: { contestId: 1000 + d, index: 'A', rating: 1000 + (d % 7) * 150, tags: [] } });
}

check('the 14 inputs equal the training table (rowsFor) at every contest it makes a row for', () => {
  const rows = rowsFor({
    handle: 'x',
    rating: history.map((r) => ({ t: r.ratingUpdateTimeSeconds, oldRating: r.oldRating, newRating: r.newRating })),
    subs: subs.map((s) => ({ t: s.creationTimeSeconds, ok: s.verdict === 'OK', key: `${s.problem.contestId}${s.problem.index}`, rating: s.problem.rating, tags: [] })),
  });
  assert.ok(rows.length >= 3, `rows: ${rows.length}`);
  for (const row of rows) {
    const f = features(history, subs, row.t);
    for (const k of model.features) assert.ok(Math.abs(f[k] - row[k]) < 1e-9, `${k} at ${row.t}: ${f[k]} vs ${row[k]}`);
  }
});

check('an outlook: low <= middle <= high around the current rating; what-if is a number', () => {
  const now = (history[11].ratingUpdateTimeSeconds + 3 * DAY) * 1000;
  const o = outlook(history, subs, now);
  assert.strictEqual(o.eligible, true);
  assert.strictEqual(o.rating, 1480);
  assert.ok(o.range.low <= o.range.mid && o.range.mid <= o.range.high, JSON.stringify(o.range));
  assert.strictEqual(o.range.mid - o.rating, o.change.mid);
  assert.strictEqual(typeof o.whatIfHarder, 'number');
  assert.strictEqual(o.coverage, model.metrics.coverage_80);
});

check(`no outlook with under ${MIN_CONTESTS} contests, or no contest for 4 months`, () => {
  assert.strictEqual(outlook(history.slice(0, MIN_CONTESTS - 1), subs, (T0 + 80 * DAY) * 1000).eligible, false);
  const late = outlook(history, subs, (history[11].ratingUpdateTimeSeconds + 200 * DAY) * 1000);
  assert.deepStrictEqual([late.eligible, late.reason], [false, 'no rated contest in the last 4 months']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
