/**
 * Tests for services/shadowReport.js — scoring the shadow model against the rules on real answers
 * (decision D-56). Only picker and blind answers count; shown answers lean towards the shown guess.
 * Run: node tests/shadowReport.test.js
 */
const assert = require('assert');
const { shadowReport, MIN_LABELS, MIN_PEOPLE, MIN_PER_TYPE } = require('../services/shadowReport');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const TYPES = ['dsa', 'project', 'debugging', 'learning', 'setup'];
/** A saved session: the true answer, the rules' guess and the model's guess. */
function doc({ truth, rules, model, source = 'blind', user = 'u0' }) {
  return {
    userId: user,
    workType: { type: rules },
    modelGuess: model ? { type: model, modelVersion: 'wt-test' } : undefined,
    pickerLabel: source === 'picker' ? { type: truth } : null,
    userLabel: source === 'picker' ? null : { type: truth, source },
  };
}
/** `perType` blind answers of every type from `people` people; rules / model right as asked. */
function many({ perType = 40, people = 12, rulesRight = () => true, modelRight = () => true }) {
  const out = [];
  let i = 0;
  for (const truth of TYPES) {
    for (let k = 0; k < perType; k++, i++) {
      const wrong = TYPES[(TYPES.indexOf(truth) + 1) % TYPES.length];
      out.push(doc({ truth, user: `u${i % people}`,
        rules: rulesRight(truth, k) ? truth : wrong, model: modelRight(truth, k) ? truth : wrong }));
    }
  }
  return out;
}

console.log('\nshadowReport');

check('only picker and blind answers with a model guess are scored; shown answers and old sessions are left out', () => {
  const r = shadowReport([
    doc({ truth: 'dsa', rules: 'dsa', model: 'dsa', source: 'blind' }),
    doc({ truth: 'setup', rules: 'setup', model: 'learning', source: 'picker' }),
    doc({ truth: 'project', rules: 'project', model: 'project', source: 'shown' }),
    doc({ truth: 'learning', rules: 'learning', model: null, source: 'blind' }),
    { userId: 'u9', workType: { type: 'dsa' }, modelGuess: { type: 'dsa' } },
  ]);
  assert.strictEqual(r.labels, 2);
  assert.strictEqual(r.people, 1);
  assert.deepStrictEqual(r.skipped, { shown: 1, noModelGuess: 1, unlabelled: 1 });
  assert.strictEqual(r.model.accuracy, 0.5);
  assert.strictEqual(r.rules.accuracy, 1);
});

check('"not sure" counts as wrong', () => {
  const r = shadowReport([doc({ truth: 'dsa', rules: 'not_sure', model: 'not_sure' })]);
  assert.strictEqual(r.rules.accuracy, 0);
  assert.strictEqual(r.model.accuracy, 0);
});

check('macro-F1 and recall per type are worked out for both', () => {
  // the model is wrong on every 4th DSA session, the rules on every 2nd
  const r = shadowReport(many({ perType: 20, rulesRight: (t, k) => t !== 'dsa' || k % 2 === 0, modelRight: (t, k) => t !== 'dsa' || k % 4 !== 0 }));
  assert.strictEqual(r.rules.recall.dsa, 0.5);
  assert.strictEqual(r.model.recall.dsa, 0.75);
  assert.strictEqual(r.model.recall.setup, 1);
  assert.ok(r.model.macroF1 > r.rules.macroF1);
});

check('too few answers, people or answers of one type: not enough labels yet', () => {
  assert.strictEqual(MIN_LABELS, 150);
  assert.strictEqual(MIN_PEOPLE, 10);
  assert.strictEqual(MIN_PER_TYPE, 10);
  assert.strictEqual(shadowReport(many({ perType: 20 })).verdict, 'not_enough_labels', '100 labels');
  assert.strictEqual(shadowReport(many({ perType: 40, people: 6 })).verdict, 'not_enough_labels', '6 people');
  const noSetup = many({ perType: 50 }).filter((d) => d.userLabel.type !== 'setup');
  assert.strictEqual(shadowReport(noSetup).verdict, 'not_enough_labels', 'no setup answers');
  assert.ok(shadowReport(many({ perType: 20 })).reasons.some((x) => x.includes('150')));
});

check('the model clearly better and never much worse on a type: switch it on', () => {
  const r = shadowReport(many({ perType: 40, rulesRight: (t, k) => k % 3 !== 0, modelRight: (t, k) => k % 10 !== 0 }));
  assert.strictEqual(r.verdict, 'switch_on', JSON.stringify(r.reasons));
});

check('the model better overall but much worse on one type: keep the rules', () => {
  const r = shadowReport(many({ perType: 40, rulesRight: (t, k) => k % 3 !== 0,
    modelRight: (t, k) => (t === 'debugging' ? k % 2 === 0 : true) }));
  assert.ok(r.model.macroF1 > r.rules.macroF1 + 0.05);
  assert.strictEqual(r.verdict, 'keep_rules');
  assert.ok(r.reasons.some((x) => x.includes('debugging')), JSON.stringify(r.reasons));
});

check('the model only slightly better: keep the rules', () => {
  const r = shadowReport(many({ perType: 40, rulesRight: (t, k) => k % 10 !== 0, modelRight: (t, k) => k % 15 !== 0 }));
  assert.strictEqual(r.verdict, 'keep_rules');
});

check('exactly 0.05 better passes the gate (no floating-point surprise at the edge)', () => {
  // rules wrong on 4 of 40 per type (macro-F1 0.9), model on 2 of 40 (0.95)
  const r = shadowReport(many({ perType: 40, rulesRight: (t, k) => k % 10 !== 0, modelRight: (t, k) => k % 20 !== 0 }));
  assert.strictEqual(r.rules.macroF1, 0.9);
  assert.strictEqual(r.model.macroF1, 0.95);
  assert.strictEqual(r.verdict, 'switch_on', JSON.stringify(r.reasons));
});

check('the report names the model version it scored', () => {
  assert.deepStrictEqual(shadowReport(many({ perType: 2 })).modelVersions, ['wt-test']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
