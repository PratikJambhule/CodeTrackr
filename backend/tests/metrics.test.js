const assert = require('assert');
const m = require('../services/metricsDerive');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60000;

console.log('\ndeepWorkRatio');
check('counts only blocks of 25 minutes or more', () => {
  // 30 + 40 deep = 70 min of 100 min focused
  assert.strictEqual(m.deepWorkRatio([30 * MIN, 40 * MIN, 5 * MIN, 5 * MIN], 100 * MIN), 0.7);
});
check('returns 0 when nothing is deep', () => {
  assert.strictEqual(m.deepWorkRatio([5 * MIN, 10 * MIN], 60 * MIN), 0);
});
check('returns 0 rather than dividing by zero', () => {
  assert.strictEqual(m.deepWorkRatio([], 0), 0);
});

console.log('\nflowBlockStats');
check('reports median, longest and deep-block count', () => {
  const s = m.flowBlockStats([10 * MIN, 30 * MIN, 50 * MIN]);
  assert.strictEqual(s.medianMs, 30 * MIN);
  assert.strictEqual(s.longestMs, 50 * MIN);
  assert.strictEqual(s.deepBlockCount, 2);
  assert.strictEqual(s.blockCount, 3);
});
check('median of an even-length set averages the middle two', () => {
  assert.strictEqual(m.flowBlockStats([10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN]).medianMs, 25 * MIN);
});
check('handles an empty set', () => {
  assert.deepStrictEqual(m.flowBlockStats([]), { medianMs: 0, longestMs: 0, deepBlockCount: 0, blockCount: 0 });
});

console.log('\nconsistencyIndex');
check('a perfectly steady week scores 1', () => {
  assert.strictEqual(m.consistencyIndex([60, 60, 60, 60]), 1);
});
check('an erratic week scores lower than a steady one', () => {
  const steady = m.consistencyIndex([50, 55, 60, 55]);
  const erratic = m.consistencyIndex([5, 200, 10, 180]);
  assert.ok(erratic < steady, `erratic ${erratic} should be < steady ${steady}`);
});
check('never returns a negative value', () => {
  assert.ok(m.consistencyIndex([0, 0, 500]) >= 0);
});
check('returns 0 for no activity', () => {
  assert.strictEqual(m.consistencyIndex([0, 0, 0]), 0);
});

console.log('\ntruePeakWindow');
check('prefers the productive hour over the merely busy one', () => {
  const result = m.truePeakWindow([
    { hour: 14, commits: 0, linesInserted: 100, churnLines: 400, minutes: 120 }, // busy, churny
    { hour: 21, commits: 4, linesInserted: 200, churnLines: 10, minutes: 60 },   // productive
  ]);
  assert.strictEqual(result.hour, 21);
});
check('ignores hours with no tracked time', () => {
  const result = m.truePeakWindow([
    { hour: 3, commits: 99, linesInserted: 0, churnLines: 0, minutes: 0 },
    { hour: 9, commits: 1, linesInserted: 10, churnLines: 0, minutes: 30 },
  ]);
  assert.strictEqual(result.hour, 9);
});
check('returns null with no usable data', () => {
  assert.strictEqual(m.truePeakWindow([]), null);
});

console.log('\nestimationCalibration');
check('detects consistent underestimation', () => {
  const r = m.estimationCalibration([
    { estimatedHours: 10, actualHours: 20 },
    { estimatedHours: 5, actualHours: 10 },
  ]);
  assert.strictEqual(r.factor, 2);
  assert.strictEqual(r.sampleSize, 2);
});
check('ignores goals with a zero estimate', () => {
  const r = m.estimationCalibration([
    { estimatedHours: 0, actualHours: 5 },
    { estimatedHours: 10, actualHours: 10 },
    { estimatedHours: 4, actualHours: 4 },
  ]);
  assert.strictEqual(r.sampleSize, 2);
  assert.strictEqual(r.factor, 1);
});
check('returns null below two samples', () => {
  assert.strictEqual(m.estimationCalibration([{ estimatedHours: 5, actualHours: 6 }]), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
