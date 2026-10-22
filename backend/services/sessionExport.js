'use strict';

/**
 * Saved sessions → training rows (ML plan C-16, label priority M4). Pure.
 *
 * One row per labelled session of ONE feature version (a model is trained for one version).
 * The label follows the priority picker > blind > shown (sessionSnapshot.trainingLabel); a guess is
 * never a label. `blind` is 1 for answers given WITHOUT seeing a guess (blind questions and the
 * status-bar picker): only those measure accuracy (train_work_type.py scores the gate on them).
 * People get a random id per export, so a CSV never carries a user id, name, file or project name.
 */

const crypto = require('crypto');
const { trainingLabel } = require('./sessionSnapshot');
const { FEATURES_BY_VERSION } = require('./workTypeFeatures');
const { WORK_TYPES } = require('./workType');

const META = ['sessionId', 'personId', 'source', 'label', 'labelSource', 'blind', 'ruleType', 'featureVersion', 'activeMin'];

function exportRows(sessions, { version = 3, salt = crypto.randomBytes(16).toString('hex') } = {}) {
  const features = FEATURES_BY_VERSION[version];
  if (!features) throw new Error(`unknown feature version ${version}`);
  const personOf = (userId) => `p-${crypto.createHash('sha256').update(`${salt}:${userId}`).digest('hex').slice(0, 10)}`;
  const rows = [];
  let n = 0;
  for (const s of sessions || []) {
    if (!s || s.featureVersion !== version || !s.features) continue;
    const label = trainingLabel(s);
    if (!label || !WORK_TYPES.includes(label.type)) continue;
    const row = {
      sessionId: `s${++n}`,
      personId: personOf(String(s.userId)),
      source: 'real',
      label: label.type,
      labelSource: label.source,
      blind: label.source === 'blind' || label.source === 'picker' ? 1 : 0,
      ruleType: (s.workType && s.workType.type) || 'not_sure',
      featureVersion: version,
      activeMin: Math.round((Number(s.durationSec) || 0) / 6) / 10,
    };
    for (const f of features) row[f] = Number(s.features[f]) || 0;
    rows.push(row);
  }
  return { columns: [...META, ...features], rows };
}

function toCsv({ columns, rows }) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => r[c]).join(','))].join('\n') + '\n';
}

module.exports = { exportRows, toCsv, META };
