/**
 * Flush-safety regression tests (2026-09-10).
 *
 * `buildPayload` resets every tracker, so any bail-out after that point used to
 * destroy the interval: a signal-less flush, a missing API key, an out-of-range
 * duration, or a failed upload. These cover the carry-forward merge that fixes
 * it, plus the idle-pause gate that stopped focusedMs/readMs banking the gap.
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const stub = createVscodeStub();
const restore = installVscodeStub(stub.vscode);
const bundle = require(path.join(__dirname, '..', 'dist', 'extension.js'));
const { mergeAnalytics, EditorTracker, FocusTracker } = bundle;

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const payload = (over = {}) => ({
  duration: 60,
  linesAdded: 0,
  linesRemoved: 0,
  editorAnalytics: {
    charsInserted: 0, charsDeleted: 0, linesInserted: 0, linesDeleted: 0,
    churnLines: 0, undoCount: 0, redoCount: 0, saveCount: 0,
    fileSwitches: 0, uniqueFiles: 0, readMs: 0, writeMs: 0,
    largeInsertCount: 0, largeInsertChars: 0,
  },
  focusAnalytics: { focusedMs: 0, blurredMs: 0, blurEvents: 0, flowBlocksMs: [], longestBlockMs: 0 },
  gitAnalytics: { commits: 0, filesChanged: 0, uncommittedFiles: 0, uncommittedAgeMs: 0 },
  terminalAnalytics: {
    totalCommands: 0, successfulCommands: 0, failedCommands: 0, terminalErrorCount: 0,
    buildRuns: 0, successfulBuilds: 0, failedBuilds: 0, testRuns: 0, debuggingSessions: 0,
    successRate: 0, buildSuccessRate: 0,
    commandUsage: { git: 0, npm: 0 }, gitActivity: { commits: 0, pushes: 0 },
    repeatedFailedCommands: [], lastCommand: 'unknown', lastCommandTimestamp: null,
  },
  ...over,
});

console.log('\nmergeAnalytics — carry-forward of an unsent flush');

check('is exported from the bundle', () => {
  assert.strictEqual(typeof mergeAnalytics, 'function');
});

check('returns the other side when one is missing', () => {
  const p = payload();
  assert.strictEqual(mergeAnalytics(null, p), p);
  assert.strictEqual(mergeAnalytics(p, null), p);
});

check('sums durations and counters', () => {
  const a = payload({ duration: 60 });
  a.editorAnalytics.charsInserted = 100;
  a.editorAnalytics.readMs = 5000;
  const b = payload({ duration: 90 });
  b.editorAnalytics.charsInserted = 50;
  b.editorAnalytics.readMs = 2500;

  const m = mergeAnalytics(a, b);
  assert.strictEqual(m.duration, 150);
  assert.strictEqual(m.editorAnalytics.charsInserted, 150);
  assert.strictEqual(m.editorAnalytics.readMs, 7500);
});

check('a read-only interval survives being merged forward (the B1 regression)', () => {
  // No edits at all: payloadHasSignal() is false, so this payload was silently
  // dropped before the fix even though readMs/fileSwitches/focusedMs were real.
  const held = payload({ duration: 120 });
  held.editorAnalytics.readMs = 120000;
  held.editorAnalytics.fileSwitches = 7;
  held.focusAnalytics.focusedMs = 120000;

  const next = payload({ duration: 60 });
  next.editorAnalytics.charsInserted = 40;

  const m = mergeAnalytics(held, next);
  assert.strictEqual(m.editorAnalytics.readMs, 120000, 'readMs preserved');
  assert.strictEqual(m.editorAnalytics.fileSwitches, 7, 'fileSwitches preserved');
  assert.strictEqual(m.focusAnalytics.focusedMs, 120000, 'focusedMs preserved');
  assert.strictEqual(m.editorAnalytics.charsInserted, 40);
  assert.strictEqual(m.duration, 180);
});

check('concatenates flowBlocksMs and maxes longestBlockMs', () => {
  const a = payload();
  a.focusAnalytics.flowBlocksMs = [60000, 1800000];
  a.focusAnalytics.longestBlockMs = 1800000;
  const b = payload();
  b.focusAnalytics.flowBlocksMs = [300000];
  b.focusAnalytics.longestBlockMs = 300000;

  const m = mergeAnalytics(a, b);
  assert.deepStrictEqual(m.focusAnalytics.flowBlocksMs, [60000, 1800000, 300000]);
  assert.strictEqual(m.focusAnalytics.longestBlockMs, 1800000, 'max, not sum');
});

check('caps flowBlocksMs at 200 entries, matching the backend normaliser', () => {
  const a = payload();
  a.focusAnalytics.flowBlocksMs = new Array(150).fill(1000);
  const b = payload();
  b.focusAnalytics.flowBlocksMs = new Array(150).fill(2000);
  const m = mergeAnalytics(a, b);
  assert.strictEqual(m.focusAnalytics.flowBlocksMs.length, 200);
});

check('uniqueFiles takes the max, never the sum', () => {
  const a = payload(); a.editorAnalytics.uniqueFiles = 5;
  const b = payload(); b.editorAnalytics.uniqueFiles = 3;
  assert.strictEqual(mergeAnalytics(a, b).editorAnalytics.uniqueFiles, 5);
});

check('recomputes success rates from merged counts instead of averaging percentages', () => {
  const a = payload();
  a.terminalAnalytics.totalCommands = 1;
  a.terminalAnalytics.successfulCommands = 1;
  a.terminalAnalytics.successRate = 100;
  const b = payload();
  b.terminalAnalytics.totalCommands = 3;
  b.terminalAnalytics.successfulCommands = 0;
  b.terminalAnalytics.successRate = 0;

  const m = mergeAnalytics(a, b);
  assert.strictEqual(m.terminalAnalytics.totalCommands, 4);
  assert.strictEqual(m.terminalAnalytics.successRate, 25, '1 of 4, not the mean of 100 and 0');
});

check('merges repeatedFailedCommands by command name', () => {
  const a = payload();
  a.terminalAnalytics.repeatedFailedCommands = [{ command: 'npm test', count: 2 }];
  const b = payload();
  b.terminalAnalytics.repeatedFailedCommands = [
    { command: 'npm test', count: 3 },
    { command: 'tsc', count: 1 },
  ];
  const m = mergeAnalytics(a, b).terminalAnalytics.repeatedFailedCommands;
  const byName = Object.fromEntries(m.map((e) => [e.command, e.count]));
  assert.strictEqual(byName['npm test'], 5);
  assert.strictEqual(byName['tsc'], 1);
});

check('point-in-time git gauges prefer the newer value, not the sum', () => {
  const a = payload(); a.gitAnalytics.uncommittedFiles = 9;
  const b = payload(); b.gitAnalytics.uncommittedFiles = 2;
  assert.strictEqual(mergeAnalytics(a, b).gitAnalytics.uncommittedFiles, 2);
});

check('lastCommand keeps the newer real value over a placeholder', () => {
  const a = payload(); a.terminalAnalytics.lastCommand = 'npm run build';
  const b = payload(); b.terminalAnalytics.lastCommand = 'unknown';
  assert.strictEqual(mergeAnalytics(a, b).terminalAnalytics.lastCommand, 'npm run build');
});

console.log('\nidle-pause gate — samplers must not bank the gap');

check('FocusTracker exposes setPaused/isPaused', () => {
  const t = new FocusTracker();
  assert.strictEqual(typeof t.setPaused, 'function');
  assert.strictEqual(typeof t.isPaused, 'function');
});

check('focusedMs does not accrue while paused (the B6 regression)', () => {
  const t = new FocusTracker();
  t.setFocused(true, 0);
  t.tick(60000);                       // 60s of real focused work
  const before = t.getIntervalSnapshot().focusedMs;
  assert.ok(before >= 60000, `banked real time, got ${before}`);

  t.setPaused(true, 60000);
  t.tick(60000 + 5 * 3600 * 1000);     // five hours idle, window still focused
  const after = t.getIntervalSnapshot().focusedMs;
  assert.strictEqual(after, before, 'idle gap must not be banked as focused time');
});

check('unpausing does not back-fill the idle gap', () => {
  const t = new FocusTracker();
  t.setFocused(true, 0);
  t.tick(60000);
  const before = t.getIntervalSnapshot().focusedMs;

  t.setPaused(true, 60000);
  t.setPaused(false, 60000 + 3600 * 1000);   // resume an hour later
  t.tick(60000 + 3600 * 1000 + 10000);       // 10s of new work

  const after = t.getIntervalSnapshot().focusedMs;
  assert.ok(after - before <= 11000, `expected ~10s of new time, banked ${after - before}ms`);
});

check('EditorTracker readMs does not accrue while paused', () => {
  const t = new EditorTracker();
  t.sampleAttention(0);
  t.sampleAttention(5000);                    // 5s of reading
  const before = t.getIntervalSnapshot().readMs;
  assert.ok(before >= 5000);

  t.setPaused(true, 5000);
  t.sampleAttention(5000 + 3600 * 1000);      // an hour idle
  assert.strictEqual(t.getIntervalSnapshot().readMs, before, 'idle gap must not become readMs');

  t.setPaused(false, 5000 + 3600 * 1000);
  t.sampleAttention(5000 + 3600 * 1000 + 5000);
  assert.ok(t.getIntervalSnapshot().readMs > before, 'resumes banking after unpause');
});

restore();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
