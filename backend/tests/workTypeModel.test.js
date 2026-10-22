/**
 * Tests for services/workTypeModel.js — JavaScript serving of the work-type model
 * (ML plan C-18). The parity cases come from ml/train_work_type.py: JavaScript must
 * reproduce Python's probabilities within 1e-6, which catches a wrong feature order.
 * Run: node tests/workTypeModel.test.js
 */
const assert = require('assert');
const path = require('path');
const { loadModel, isServable, predict } = require('../services/workTypeModel');
const { FEATURES_BY_VERSION } = require('../services/workTypeFeatures');
const parity = require('./fixtures/workTypeParity.json');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const model = loadModel();

console.log('\nworkTypeModel');

const FEATURES = model ? FEATURES_BY_VERSION[model.featureVersion] : [];

check('the model file loads and matches its feature version\'s list, in order', () => {
  assert.ok(model, 'backend/ml/workTypeModel.json is missing; run python ml/train_work_type.py');
  assert.deepStrictEqual(model.features, FEATURES);
  assert.strictEqual(model.weights.length, model.classes.length);
  assert.strictEqual(model.weights[0].length, FEATURES.length);
});

check('parity fixtures were made by this model version', () => {
  assert.strictEqual(parity.modelVersion, model.version);
  assert.strictEqual(parity.cases.length, 20);
});

check('JavaScript matches Python within 1e-6 on all 20 parity cases', () => {
  for (const c of parity.cases) {
    const r = predict(model, c.vector);
    model.classes.forEach((cls, k) => {
      assert.ok(Math.abs(r.probabilities[cls] - c.proba[k]) < 1e-6, `${c.sessionId} ${cls}: ${r.probabilities[cls]} vs ${c.proba[k]}`);
    });
  }
});

check('probabilities sum to 1 and the answer comes with two reasons', () => {
  const r = predict(model, parity.cases[0].vector);
  const sum = Object.values(r.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.strictEqual(r.because.length, 2);
  for (const f of r.because) assert.ok(FEATURES.includes(f));
});

check('a best guess under 50% is "not sure"', () => {
  const flat = { ...model, weights: model.weights.map((w) => w.map(() => 0)), bias: model.bias.map(() => 0) };
  const r = predict(flat, new Array(FEATURES.length).fill(0));
  assert.strictEqual(r.workType, 'not_sure');
  assert.ok(Math.abs(r.probability - 0.2) < 1e-9);
});

check('a wrong-length vector is refused', () => {
  assert.throws(() => predict(model, [1, 2, 3]), new RegExp(`expected ${FEATURES.length} features`));
});

check('a model trained on synthetic data is not served unless explicitly allowed', () => {
  if (model.trainingData === 'synthetic') {
    assert.strictEqual(model.servable, false);
    assert.strictEqual(isServable(model, {}), false);
    assert.strictEqual(isServable(model, { ALLOW_SYNTHETIC_MODEL: '1' }), true);
  }
  assert.strictEqual(isServable(null, {}), false);
});

check('a missing model file means "no model", not a crash', () => {
  assert.strictEqual(loadModel(path.join(__dirname, 'no-such-model.json')), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
