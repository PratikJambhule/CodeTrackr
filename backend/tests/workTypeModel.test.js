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

console.log('\nshadow mode (D-56)');
const { shadowGuess } = require('../services/workTypeModel');
const { sessionFeaturesV3 } = require('../services/workTypeFeatures');
const { WORK_TYPES, NOT_SURE, groupOf } = require('../services/workType');
const v3 = (raw) => ({ featureVersion: 3, workFeatures: sessionFeaturesV3({ durationSec: 1800, writingSec: 900, readingSec: 600, runningSec: 300, ...raw }).features });

check('a 2.6.0 session gets the model\'s guess: a type or "not sure", its probability, why, and the model version', () => {
  const g = shadowGuess(v3({ linesInserted: 60, files: ['two_sum.cpp'], commandKinds: { compile: 10, run: 8 } }));
  assert.ok(g, 'a guess for a v3 session');
  assert.ok([...WORK_TYPES, NOT_SURE].includes(g.type), g.type);
  assert.ok(g.probability > 0 && g.probability <= 1);
  assert.strictEqual(g.because.length, 2);
  assert.strictEqual(g.modelVersion, model.version);
  assert.strictEqual(g.group, groupOf(g.type));
});

check('the shadow guess matches predict() on the same features (same model, same order)', () => {
  const s = v3({ linesInserted: 300, files: ['App.tsx', 'api.ts', 'db.ts'], commandKinds: { run: 6, git: 3 }, commits: 2 });
  const direct = predict(model, model.features.map((f) => s.workFeatures[f]));
  const g = shadowGuess(s);
  assert.strictEqual(g.type, direct.workType);
  assert.strictEqual(g.probability, Math.round(direct.probability * 1000) / 1000);
});

check('a session from before 2.6.0 (feature version 2) or with no features gets no shadow guess', () => {
  assert.strictEqual(shadowGuess({ featureVersion: 2, workFeatures: { linesPerMin: 3 } }), null);
  assert.strictEqual(shadowGuess({}), null);
  assert.strictEqual(shadowGuess(null), null);
});

check('no model file means no shadow guess, not a crash', () => {
  assert.strictEqual(shadowGuess(v3({ linesInserted: 60 }), null), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
