/**
 * Tests for services/userStats.js — the running totals behind the leaderboard
 * (roadmap item 6, H-7/H-8). Run: node tests/userStats.test.js
 */
const assert = require('assert');
const { buildStatsUpdate } = require('../services/userStats');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const when = new Date('2026-10-03T10:00:00Z');
const flush = {
  projectName: 'demo',
  linesAdded: 12,
  linesRemoved: 3,
  gitAnalytics: { commits: 2 },
  terminalAnalytics: { totalCommands: 5, failedCommands: 1, buildRuns: 2, failedBuilds: 1, gitActivity: { commits: 9 } },
};

console.log('\nuserStats: buildStatsUpdate');

check('adds CREDITED seconds, not the claimed duration', () => {
  const u = buildStatsUpdate({ ...flush, duration: 3600 }, 600, when);
  assert.strictEqual(u.$inc.totalSeconds, 600);
});

check('counts lines, code changes and one flush', () => {
  const u = buildStatsUpdate(flush, 60, when);
  assert.strictEqual(u.$inc.linesAdded, 12);
  assert.strictEqual(u.$inc.linesRemoved, 3);
  assert.strictEqual(u.$inc.codeChanges, 15);
  assert.strictEqual(u.$inc.flushes, 1);
});

check('commits come from the Git API, falling back to the terminal count, never both', () => {
  assert.strictEqual(buildStatsUpdate(flush, 60, when).$inc.commits, 2);
  const noGit = { ...flush, gitAnalytics: undefined };
  assert.strictEqual(buildStatsUpdate(noGit, 60, when).$inc.commits, 9);
});

check('carries the failure counters the group board shows', () => {
  const u = buildStatsUpdate(flush, 60, when);
  assert.deepStrictEqual(
    [u.$inc.totalCommands, u.$inc.failedCommands, u.$inc.buildRuns, u.$inc.failedBuilds], [5, 1, 2, 1]);
});

check('records the project and last-active time', () => {
  const u = buildStatsUpdate(flush, 60, when);
  assert.deepStrictEqual(u.$addToSet, { projects: 'demo' });
  assert.deepStrictEqual(u.$max, { lastActiveAt: when });
});

check('garbage numbers become zero, never NaN or negative', () => {
  const u = buildStatsUpdate({ linesAdded: -5, linesRemoved: 'x', projectName: 'p' }, NaN, when);
  for (const v of Object.values(u.$inc)) assert.ok(Number.isFinite(v) && v >= 0, JSON.stringify(u.$inc));
});

check('a signal-less top-up adds time but not a flush or counters', () => {
  const u = buildStatsUpdate(flush, 30, when, { timeOnly: true });
  assert.deepStrictEqual(u.$inc, { totalSeconds: 30 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
