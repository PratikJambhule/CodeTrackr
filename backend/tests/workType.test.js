/**
 * Tests for services/workType.js — work-type rules v1, the baseline the model
 * must beat (ML plan C-06). Run: node tests/workType.test.js
 */
const assert = require('assert');
const { classifyWorkType, WORK_TYPES } = require('../services/workType');
const { sessionFeatures } = require('../services/workTypeFeatures');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const kind = (raw) => classifyWorkType(sessionFeatures(raw)).workType;
const base = { durationSec: 1800, readMs: 600000, writeMs: 600000, flowBlocksMs: [1200000] };

console.log('\nworkType');

check('five work types', () => {
  assert.deepStrictEqual(WORK_TYPES, ['dsa', 'project', 'debugging', 'learning', 'setup']);
});

check('too little activity is "not enough", not a guess', () => {
  assert.strictEqual(kind({ ...base, durationSec: 200, linesInserted: 40 }), 'not_enough');
  assert.strictEqual(kind({ ...base }), 'not_enough'); // 30 min, no edits, no commands
});

check('a compile-error loop on a practice problem stays DSA (checked before debugging)', () => {
  assert.strictEqual(kind({ ...base, linesInserted: 40, files: ['two_sum.cpp'], totalCommands: 12,
    failedCommands: 8, commandUsage: { gcc: 12 }, buildRuns: 12, failedBuilds: 8 }), 'dsa');
});

check('a practice folder alone is enough for DSA', () => {
  assert.strictEqual(kind({ ...base, linesInserted: 30, files: ['main.cpp'], projects: ['dsa-sheet'] }), 'dsa');
});

check('package installs with few edits are setup', () => {
  assert.strictEqual(kind({ ...base, linesInserted: 4, totalCommands: 10, commandUsage: { npm: 6, docker: 2 },
    files: ['package.json', 'Dockerfile'] }), 'setup');
});

check('failing builds with little new code are debugging', () => {
  assert.strictEqual(kind({ ...base, linesInserted: 30, files: ['api.js', 'db.js'], totalCommands: 10,
    buildRuns: 6, failedBuilds: 4, commandUsage: { npm: 1 } }), 'debugging');
});

check('mostly reading and switching files is learning', () => {
  assert.strictEqual(kind({ ...base, readMs: 1500000, writeMs: 200000, linesInserted: 20, fileSwitches: 20,
    files: ['a.md', 'index.js', 'router.js'] }), 'learning');
});

check('steady writing with commits is project building', () => {
  assert.strictEqual(kind({ ...base, linesInserted: 150, linesDeleted: 30, commits: 2,
    files: ['App.tsx', 'api.ts'] }), 'project');
});

check('nothing clear is "not sure" with a reason', () => {
  const r = classifyWorkType(sessionFeatures({ ...base, linesInserted: 10, files: ['notes.txt'] }));
  assert.strictEqual(r.workType, 'not_sure');
  assert.ok(r.reason.length > 0);
});

console.log('\nrules v2 (plan M2, feature version 3)');
const { sessionFeaturesV3 } = require('../services/workTypeFeatures');
const kind3 = (raw) => classifyWorkType(sessionFeaturesV3({ durationSec: 1800, writingSec: 900, readingSec: 600, runningSec: 300, ...raw })).workType;

check('`npm run dev` while writing in a project with package.json is project work, not setup', () => {
  assert.strictEqual(kind3({ linesInserted: 120, files: ['App.tsx', 'api.ts', 'db.ts'],
    commandKinds: { run: 8, install: 1 }, workspace: { hasPackageJson: true, sourceFilesBucket: '21-100' } }), 'project');
});

check('installs and config files with little writing are setup', () => {
  assert.strictEqual(kind3({ linesInserted: 20, files: ['package.json', 'Dockerfile', 'index.js'],
    commandKinds: { install: 6, docker: 2, run: 1 } }), 'setup');
});

check('Run Without Debugging (Ctrl+F5) is not debugging; the real debugger is', () => {
  const base = { linesInserted: 40, files: ['server.js', 'routes.js', 'db.js'], workspace: { hasPackageJson: true } };
  assert.notStrictEqual(kind3({ ...base, runs: { debugNoDebug: 6 } }), 'debugging');
  assert.strictEqual(kind3({ ...base, debug: { sessions: 2, breakpointStops: 5 } }), 'debugging');
});

check('a compile-and-run loop on one file in a small folder is DSA, even with a plain name', () => {
  assert.strictEqual(kind3({ linesInserted: 60, files: ['main.cpp'], projects: ['sem3'],
    commandKinds: { compile: 10, run: 8, failed: { compile: 4 } }, workspace: { sourceFilesBucket: '1', hasGit: false } }), 'dsa');
});

check('a freshly cloned repo you mostly read is learning', () => {
  assert.strictEqual(kind3({ writingSec: 100, readingSec: 1500, runningSec: 200, linesInserted: 10,
    files: ['index.js', 'README.md', 'router.js'], workspace: { clonedRecently: true, ownCommits: false, hasPackageJson: true } }), 'learning');
});

check('v2 features still use rules v1', () => {
  assert.strictEqual(kind({ ...base, linesInserted: 40, files: ['two_sum.cpp'], totalCommands: 12,
    failedCommands: 8, commandUsage: { gcc: 12 }, buildRuns: 12, failedBuilds: 8 }), 'dsa');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
