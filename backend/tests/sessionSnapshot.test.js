/**
 * Tests for the pure parts of services/sessionSnapshot.js (ML plan B7, M4):
 * blind prompts, label priority and the stored copy of a session.
 * Run: node tests/sessionSnapshot.test.js
 */
const assert = require('assert');
const { promptFor, trainingLabel, sessionFields, BLIND_ONE_IN } = require('../services/sessionSnapshot');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\nsessionSnapshot');

check('about 1 in 5 sessions is asked blind', () => {
  let blind = 0;
  const n = 5000;
  for (let i = 0; i < n; i++) if (promptFor('64f0c0ffee', 1760000000000 + i * 600000) === 'blind') blind++;
  const share = blind / n;
  assert.strictEqual(BLIND_ONE_IN, 5);
  assert.ok(share > 0.17 && share < 0.23, `blind share ${share}`);
});

check('the prompt is fixed for a session and differs between people', () => {
  const t = 1760000000000;
  assert.strictEqual(promptFor('a', t), promptFor('a', t));
  const users = Array.from({ length: 40 }, (_, i) => promptFor(`user${i}`, t));
  assert.ok(users.includes('blind') && users.includes('guess'));
});

check('label priority: picker > blind > shown > nothing', () => {
  assert.deepStrictEqual(trainingLabel({ pickerLabel: { type: 'dsa' }, userLabel: { type: 'project', source: 'blind' } }), { type: 'dsa', source: 'picker' });
  assert.deepStrictEqual(trainingLabel({ userLabel: { type: 'setup', source: 'blind' } }), { type: 'setup', source: 'blind' });
  assert.deepStrictEqual(trainingLabel({ userLabel: { type: 'learning', source: 'shown' } }), { type: 'learning', source: 'shown' });
  assert.strictEqual(trainingLabel({ workType: { type: 'dsa' } }), null, 'a guess is never a label');
  assert.strictEqual(trainingLabel(null), null);
});

check('the stored copy keeps times, features and the guess, rounded', () => {
  const f = sessionFields({ startMs: 0, endMs: 1200000, durationSec: 1199.6, writingSec: 700.4, readingSec: 400, runningSec: 99.2,
    projects: ['app'], languages: ['ts'], featureVersion: 2, workFeatures: { linesPerMin: 3 },
    workType: { type: 'project', group: 'project_work', by: 'rules', reason: 'x' }, pickerLabel: null });
  assert.strictEqual(f.startAt.toISOString(), '1970-01-01T00:00:00.000Z');
  assert.strictEqual(f.durationSec, 1200);
  assert.strictEqual(f.writingSec, 700);
  assert.strictEqual(f.runningSec, 99);
  assert.deepStrictEqual(f.features, { linesPerMin: 3 });
  assert.strictEqual(f.workType.type, 'project');
  assert.ok(!('userLabel' in f), 'a snapshot never overwrites what the user said');
});

check('the stored copy carries the model\'s shadow guess for 2.6.0 sessions only (D-56)', () => {
  const { sessionFeaturesV3 } = require('../services/workTypeFeatures');
  const base = { startMs: 0, endMs: 1200000, durationSec: 1200, projects: [], languages: [], workType: { type: 'dsa' }, pickerLabel: null };
  const old = sessionFields({ ...base, featureVersion: 2, workFeatures: { linesPerMin: 3 } });
  assert.strictEqual(old.modelGuess, null);
  const fresh = sessionFields({ ...base, featureVersion: 3,
    workFeatures: sessionFeaturesV3({ durationSec: 1200, writingSec: 800, readingSec: 300, runningSec: 100, linesInserted: 40, files: ['two_sum.cpp'] }).features });
  assert.ok(fresh.modelGuess && fresh.modelGuess.type, 'model guess saved');
  assert.strictEqual(fresh.workType.type, 'dsa', 'the rules\' guess is still what people see');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
