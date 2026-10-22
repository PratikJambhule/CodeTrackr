/**
 * Tests for services/workTypeFeatures.js — the 18 attributes (feature version 2)
 * of the work-type classifier. Run: node tests/workTypeFeatures.test.js
 */
const assert = require('assert');
const { sessionFeatures, FEATURES, FEATURE_VERSION } = require('../services/workTypeFeatures');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

// 40 minutes on two LeetCode problems with a compile-and-run loop.
const dsa = {
  durationSec: 2400, linesInserted: 90, linesDeleted: 30, churnLines: 27,
  charsInserted: 3000, largeInsertChars: 300, readMs: 900000, writeMs: 1100000, fileSwitches: 8,
  files: ['two_sum.cpp', 'valid_parentheses.cpp'], projects: ['leetcode'],
  totalCommands: 20, failedCommands: 8, commandUsage: { gcc: 18, git: 0, npm: 0 },
  buildRuns: 18, failedBuilds: 7, testRuns: 0, debuggingSessions: 0, commits: 0,
  flowBlocksMs: [1800000, 600000],
};

console.log('\nworkTypeFeatures');

check('exactly 18 features, in the fixed order, version 2', () => {
  assert.strictEqual(FEATURES.length, 18);
  assert.strictEqual(new Set(FEATURES).size, 18);
  assert.strictEqual(FEATURE_VERSION, 2);
  const r = sessionFeatures(dsa);
  assert.deepStrictEqual(Object.keys(r.features), FEATURES);
  assert.deepStrictEqual(r.vector, FEATURES.map((k) => r.features[k]));
});

check('a DSA session computes the expected numbers', () => {
  const f = sessionFeatures(dsa).features;
  assert.strictEqual(f.linesPerMin, 3);           // 120 lines / 40 min
  assert.strictEqual(f.churnRatio, 0.3);          // 27 / 90
  assert.strictEqual(f.readRatio, 0.45);          // 900 / 2000 s
  assert.strictEqual(f.pasteShare, 0.1);
  assert.strictEqual(f.switchesPerMin, 0.2);
  assert.strictEqual(f.filesTouched, 2);
  assert.strictEqual(f.commandsPerMin, 0.5);
  assert.strictEqual(f.runShare, 0.9);            // 18 gcc of 20
  assert.strictEqual(f.packageShare, 0);
  assert.strictEqual(f.commandFailRatio, 0.4);
  assert.strictEqual(f.buildFailRatio, 0.388889);
  assert.strictEqual(f.commitsPerHour, 0);
  assert.strictEqual(f.deepShare, 0.75);          // the 30-min block of 40 min of blocks
  assert.strictEqual(f.problemFileShare, 1);
  assert.strictEqual(f.practiceFolder, 1);
});

check('size is not a feature: doubling a session keeps the rates', () => {
  const twice = Object.fromEntries(Object.entries(dsa).map(([k, v]) => [k, typeof v === 'number' ? v * 2 : v]));
  twice.flowBlocksMs = [3600000, 1200000];
  twice.commandUsage = Object.fromEntries(Object.entries(dsa.commandUsage).map(([k, v]) => [k, v * 2]));
  const a = sessionFeatures(dsa).features, b = sessionFeatures(twice).features;
  for (const k of ['linesPerMin', 'churnRatio', 'readRatio', 'commandsPerMin', 'runShare', 'commitsPerHour', 'deepShare']) {
    assert.strictEqual(a[k], b[k], k);
  }
});

check('an empty session gives 18 zeros, never NaN or Infinity', () => {
  const r = sessionFeatures({});
  for (const k of FEATURES) assert.strictEqual(r.features[k], 0, k);
  assert.deepStrictEqual(r.meta, { activeMin: 0, editVolume: 0, totalCommands: 0 });
});

check('ratios are capped at 1 and garbage counts are treated as 0', () => {
  const f = sessionFeatures({ durationSec: 600, linesInserted: 10, churnLines: 50, totalCommands: 2,
    failedCommands: 9, buildRuns: -3, failedBuilds: 'x', files: new Array(30).fill(0).map((_, i) => `f${i}.js`) }).features;
  assert.strictEqual(f.churnRatio, 1);
  assert.strictEqual(f.commandFailRatio, 1);
  assert.strictEqual(f.buildFailRatio, 0);
  assert.strictEqual(f.filesTouched, 10);
});

check('meta carries the absolute numbers the rules need', () => {
  assert.deepStrictEqual(sessionFeatures(dsa).meta, { activeMin: 40, editVolume: 120, totalCommands: 20 });
});

console.log('\nfeature version 3 (plan M1)');
const { sessionFeaturesV3, bestFeatures, FEATURES_V3, FEATURES_BY_VERSION } = require('../services/workTypeFeatures');
const v3raw = {
  durationSec: 1200, writingSec: 600, readingSec: 400, runningSec: 200,
  linesInserted: 60, linesDeleted: 20, charsInserted: 1800,
  commandKinds: { compile: 6, run: 2, install: 0, test: 1, failed: { compile: 3 } },
  runs: { terminal: 9, task: 1, codeRunner: 0, debugNoDebug: 2 },
  debug: { sessions: 1, breakpointStops: 4, steps: 10 },
  reading: { scrollEvents: 8, navigations: 10, filesOpenedNotEdited: 1 },
  filesCreated: 2, files: ['main.cpp', 'README.md'],
  fileSec: { 'main.cpp': { seconds: 900 }, 'README.md': { seconds: 300 } },
  workspace: { sourceFilesBucket: '6-20', hasPackageJson: false, hasRequirements: true, hasGit: true, ownCommits: true, clonedRecently: false },
};

check('33 features in a fixed order; versions are listed', () => {
  assert.strictEqual(FEATURES_V3.length, 33);
  assert.strictEqual(new Set(FEATURES_V3).size, 33);
  assert.deepStrictEqual(Object.keys(FEATURES_BY_VERSION), ['2', '3']);
  const r = sessionFeaturesV3(v3raw);
  assert.strictEqual(r.version, 3);
  assert.deepStrictEqual(Object.keys(r.features), FEATURES_V3);
});

check('v3 numbers come from the 2.6.0 signals', () => {
  const f = sessionFeaturesV3(v3raw).features;
  assert.strictEqual(f.writingShare, 0.5);
  assert.strictEqual(f.runningShare, 0.166667);
  assert.strictEqual(f.navigationsPerMin, 0.5);           // 10 jumps / 20 min
  assert.strictEqual(f.topFileShare, 0.75);
  assert.strictEqual(f.docFileShare, 0.25);               // README.md
  assert.strictEqual(f.compileShare, 6 / 12);             // 9 kinds + task + noDebug x2 = 12
  assert.strictEqual(f.runShare, 0.416667);               // run 2 + task 1 + noDebug 2
  assert.strictEqual(f.buildFailRatio, 0.5);              // 3 of 6 compiles failed
  assert.strictEqual(f.realDebugPerHour, 3);              // 1 real session in 20 min
  assert.strictEqual(f.noDebugRunsPerHour, 6);            // Ctrl+F5 counted apart
  assert.strictEqual(f.hasRequirements, 1);
  assert.strictEqual(f.projectSize, 0.5);                 // '6-20' is bucket 3 of 0..6
  assert.strictEqual(f.filesCreated, 2);
});

check('bestFeatures: v3 with the 2.6.0 time split, v2 without it', () => {
  assert.strictEqual(bestFeatures(v3raw).version, 3);
  assert.strictEqual(bestFeatures({ durationSec: 600, linesInserted: 10 }).version, 2);
});

check('an empty v3 session gives zeros, never NaN', () => {
  const f = sessionFeaturesV3({ writingSec: 0 }).features;
  for (const k of FEATURES_V3) assert.strictEqual(f[k], 0, k);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
