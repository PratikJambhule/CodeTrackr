const assert = require('assert');
const { buildDaySummary } = require('../services/dailySummary');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60000;

const docs = [
  { // a bucket doc
    userId: 'u1', language: 'typescript', projectName: 'proj-a', duration: 600,
    linesAdded: 40, linesRemoved: 10, flushCount: 7,
    editorAnalytics: { charsInserted: 900, churnLines: 12, saveCount: 4 },
    focusAnalytics: { focusedMs: 9 * MIN, longestBlockMs: 30 * MIN, flowBlocksMs: [30 * MIN, 4 * MIN] },
    terminalAnalytics: { totalCommands: 5, successfulCommands: 4, failedCommands: 1 },
    gitAnalytics: { commits: 1, filesChanged: 3 },
  },
  { // a legacy per-flush doc (no flushCount, one language)
    userId: 'u1', language: 'javascript', projectName: 'proj-b', duration: 120,
    linesAdded: 5, linesRemoved: 0,
    editorAnalytics: { charsInserted: 100 },
    focusAnalytics: { focusedMs: 2 * MIN, longestBlockMs: 2 * MIN, flowBlocksMs: [2 * MIN] },
    terminalAnalytics: {}, gitAnalytics: {},
  },
];

console.log('\nbuildDaySummary');
const s = buildDaySummary('u1', '2026-03-10', docs);

check('sums seconds and line counts', () => {
  assert.strictEqual(s.totalSeconds, 720);
  assert.strictEqual(s.totalLinesAdded, 45);
  assert.strictEqual(s.totalLinesRemoved, 10);
});
check('flushCount treats a missing value as 1', () => {
  assert.strictEqual(s.flushCount, 8); // 7 + 1
  assert.strictEqual(s.bucketCount, 2);
});
check('language breakdown is per-language seconds', () => {
  const ts = s.languages.find((l) => l.language === 'typescript');
  const js = s.languages.find((l) => l.language === 'javascript');
  assert.strictEqual(ts.seconds, 600);
  assert.strictEqual(js.seconds, 120);
});
check('project set is de-duplicated', () => {
  assert.deepStrictEqual([...s.projects].sort(), ['proj-a', 'proj-b']);
});
check('focus: focusedMs summed, longestBlockMs maxed, deep blocks counted', () => {
  assert.strictEqual(s.focus.focusedMs, 11 * MIN);
  assert.strictEqual(s.focus.longestBlockMs, 30 * MIN);
  assert.strictEqual(s.focus.blockCount, 3);
  assert.strictEqual(s.focus.deepBlockCount, 1); // only the 30-min block is >= 25 min
});
check('editor / terminal / git additive totals', () => {
  assert.strictEqual(s.editor.charsInserted, 1000);
  assert.strictEqual(s.terminal.totalCommands, 5);
  assert.strictEqual(s.git.commits, 1);
});
check('empty input yields a zeroed summary', () => {
  const z = buildDaySummary('u1', '2026-03-11', []);
  assert.strictEqual(z.totalSeconds, 0);
  assert.strictEqual(z.bucketCount, 0);
  assert.deepStrictEqual(z.languages, []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
