'use strict';

/**
 * Serves the trained work-type model in JavaScript (ML plan §10, change C-18). Pure except for
 * loadModel(), which reads backend/ml/workTypeModel.json (written by ml/train_work_type.py).
 *
 * Prediction = standardise each of the 18 features with the training mean and spread, multiply by the
 * weights, add the bias, softmax into probabilities. The best type under 50% is "not sure". The two
 * features that pushed hardest towards the answer come back too, for the "why" text.
 *
 * A model trained on synthetic data (decision D-45) is never served: isServable() is false unless the
 * model passed the ship gate on real labels, or ALLOW_SYNTHETIC_MODEL=1 is set for a local demo.
 */

const fs = require('fs');
const path = require('path');
const { FEATURES_BY_VERSION } = require('./workTypeFeatures');
const { NOT_SURE, groupOf } = require('./workType');

const MODEL_PATH = path.join(__dirname, '..', 'ml', 'workTypeModel.json');

function loadModel(file = MODEL_PATH) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const expected = FEATURES_BY_VERSION[m.featureVersion];
    if (!expected || JSON.stringify(m.features) !== JSON.stringify(expected)) {
      throw new Error(`feature list differs from workTypeFeatures (version ${m.featureVersion})`);
    }
    return m;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function isServable(model, env = process.env) {
  if (!model) return false;
  if (model.servable === true) return true;
  return env.ALLOW_SYNTHETIC_MODEL === '1';
}

/**
 * @param model   the parsed JSON model
 * @param vector  the model's features in order (sessionFeatures().vector for version 2,
 *                sessionFeaturesV3().vector for version 3); a model only serves its own version
 * @returns { workType, probability, probabilities: {type: p}, because: [feature, feature] }
 */
function predict(model, vector) {
  if (!Array.isArray(vector) || vector.length !== model.features.length) {
    throw new Error(`expected ${model.features.length} features, got ${vector && vector.length}`);
  }
  const z = vector.map((v, i) => (Number(v) - model.means[i]) / (model.stds[i] || 1));
  const logits = model.weights.map((w, k) => w.reduce((s, wi, i) => s + wi * z[i], model.bias[k]));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const total = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => e / total);
  const best = probs.indexOf(Math.max(...probs));
  const because = model.weights[best]
    .map((w, i) => [model.features[i], w * z[i]])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([f]) => f);
  return {
    workType: probs[best] < model.notSureBelow ? NOT_SURE : model.classes[best],
    probability: probs[best],
    probabilities: Object.fromEntries(model.classes.map((c, k) => [c, probs[k]])),
    because,
  };
}

let cached;
/** The model file, read once per process (null when there is none). */
function currentModel() {
  if (cached === undefined) cached = loadModel();
  return cached;
}

/**
 * Shadow mode (decision D-56): the model's guess for a sessionize() session, saved next to the rules'
 * guess but never shown, so blind and picker answers can score both on real data. Null when there is
 * no model or the session's features are another version (sessions before 2.6.0 are version 2).
 */
function shadowGuess(session, model = currentModel()) {
  if (!model || !session || session.featureVersion !== model.featureVersion || !session.workFeatures) return null;
  const r = predict(model, model.features.map((f) => session.workFeatures[f]));
  return { type: r.workType, group: groupOf(r.workType), probability: Math.round(r.probability * 1000) / 1000,
    because: r.because, modelVersion: model.version };
}

module.exports = { loadModel, isServable, predict, shadowGuess, MODEL_PATH };
