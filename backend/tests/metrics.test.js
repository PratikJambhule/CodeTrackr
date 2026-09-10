const assert = require('assert');
const m = require('../services/metricsDerive');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60000;

console.log('\ndeepWorkRatio  (share of WORKING time in blocks >= 25 min)');
check('divides deep block time by total block time, not by focusedMs', () => {
  // 30 + 40 deep out of 30+40+5+5 = 80 min of blocks -> 70/80
  assert.strictEqual(m.deepWorkRatio([30 * MIN, 40 * MIN, 5 * MIN, 5 * MIN]), 0.88);
});
check('is bounded to [0,1] by construction', () => {
  // Regression: the old deepMs/focusedMs could exceed 1, because a flow block
  // stays open across a brief alt-tab while focusedMs does not accrue.
  const r = m.deepWorkRatio([60 * MIN], 10 * MIN /* legacy arg, ignored */);
  assert.strictEqual(r, 1);
  assert.ok(r <= 1);
});
check('ignores the legacy focusedMs argument entirely', () => {
  assert.strictEqual(
    m.deepWorkRatio([30 * MIN, 10 * MIN], 999 * MIN),
    m.deepWorkRatio([30 * MIN, 10 * MIN])
  );
});
check('returns 0 when nothing is deep', () => {
  assert.strictEqual(m.deepWorkRatio([5 * MIN, 10 * MIN]), 0);
});
check('returns 0 rather than dividing by zero', () => {
  assert.strictEqual(m.deepWorkRatio([]), 0);
  assert.strictEqual(m.deepWorkRatio(null), 0);
});
check('discards negative and non-finite block values', () => {
  assert.strictEqual(m.deepWorkRatio([30 * MIN, -5, NaN, undefined]), 1);
});

console.log('\nflowBlockStats');
check('reports median, longest, deep count and total', () => {
  const s = m.flowBlockStats([10 * MIN, 30 * MIN, 50 * MIN]);
  assert.strictEqual(s.medianMs, 30 * MIN);
  assert.strictEqual(s.longestMs, 50 * MIN);
  assert.strictEqual(s.deepBlockCount, 2);
  assert.strictEqual(s.blockCount, 3);
  assert.strictEqual(s.totalMs, 90 * MIN);
});
check('median of an even-length set averages the middle two', () => {
  assert.strictEqual(m.flowBlockStats([10 * MIN, 20 * MIN, 30 * MIN, 40 * MIN]).medianMs, 25 * MIN);
});
check('handles an empty set', () => {
  assert.deepStrictEqual(m.flowBlockStats([]),
    { medianMs: 0, longestMs: 0, deepBlockCount: 0, blockCount: 0, totalMs: 0 });
});

console.log('\nvolumeStability  (robust evenness on active days)');
check('a perfectly steady week scores 1', () => {
  assert.strictEqual(m.volumeStability([60, 60, 60, 60]), 1);
});
check('an erratic week scores lower than a steady one', () => {
  assert.ok(m.volumeStability([5, 200, 10, 180]) < m.volumeStability([50, 55, 60, 55]));
});
check('one outlier day does not collapse the score (MAD, not stddev)', () => {
  // The old 1 - stddev/mean was dominated by the 600-minute day.
  const withOutlier = m.volumeStability([60, 60, 60, 60, 600]);
  assert.ok(withOutlier >= 0.9, `robust to outliers, got ${withOutlier}`);
});
check('never returns a negative value', () => {
  assert.ok(m.volumeStability([1, 1000, 1, 1000]) >= 0);
});
check('returns 0 for no activity', () => {
  assert.strictEqual(m.volumeStability([]), 0);
  assert.strictEqual(m.volumeStability([0, 0]), 0);
});
check('consistencyIndex is still exported as an alias', () => {
  assert.strictEqual(m.consistencyIndex, m.volumeStability);
});

console.log('\nactiveDaysRatio  (cadence — what "consistency" actually means)');
check('5 active days out of 7 is 0.71', () => {
  assert.strictEqual(m.activeDaysRatio(5, 7), 0.71);
});
check('clamps to 1 and never divides by zero', () => {
  assert.strictEqual(m.activeDaysRatio(30, 7), 1);
  assert.strictEqual(m.activeDaysRatio(3, 0), 0);
  assert.strictEqual(m.activeDaysRatio(undefined, 7), 0);
});

console.log('\nqualityStreak  (consecutive days with a deep block)');
check('counts back from today', () => {
  assert.strictEqual(
    m.qualityStreak(['2026-09-10', '2026-09-09', '2026-09-08'], '2026-09-10', '2026-09-09'), 3);
});
check('anchors on yesterday when today has no deep block yet', () => {
  assert.strictEqual(
    m.qualityStreak(['2026-09-09', '2026-09-08'], '2026-09-10', '2026-09-09'), 2);
});
check('a gap ends the streak', () => {
  assert.strictEqual(
    m.qualityStreak(['2026-09-10', '2026-09-08'], '2026-09-10', '2026-09-09'), 1);
});
check('returns 0 when the most recent deep day is older than yesterday', () => {
  assert.strictEqual(m.qualityStreak(['2026-09-01'], '2026-09-10', '2026-09-09'), 0);
});
check('handles an empty set', () => {
  assert.strictEqual(m.qualityStreak([], '2026-09-10', '2026-09-09'), 0);
});

console.log('\ntruePeakWindow  (2-hour window, surviving minutes, sample floor)');
const hour = (h, minutes, linesInserted, churnLines, days) =>
  ({ hour: h, minutes, linesInserted, churnLines, days });

check('prefers the window whose output survived over the merely busy one', () => {
  const best = m.truePeakWindow([
    // 10:00 — less time, but almost nothing thrown away
    hour(10, 60, 100, 5, 10), hour(11, 60, 100, 5, 10),
    // 15:00 — more time, but nearly all of it churned back out
    hour(15, 90, 200, 190, 10), hour(16, 90, 200, 190, 10),
  ]);
  assert.strictEqual(best.startHour, 10);
  assert.strictEqual(best.endHour, 12);
});
check('an hour seen on too few days cannot win', () => {
  const best = m.truePeakWindow([
    hour(3, 300, 500, 0, 1),    // one freak all-nighter
    hour(9, 60, 100, 0, 20), hour(10, 60, 100, 0, 20),
  ]);
  assert.strictEqual(best.startHour, 9, 'the 03:00 outlier must be filtered out');
});
check('respects a custom minDays floor', () => {
  const rows = [hour(9, 60, 100, 0, 4), hour(10, 60, 100, 0, 4)];
  assert.ok(m.truePeakWindow(rows, { minDays: 3 }));
  assert.strictEqual(m.truePeakWindow(rows, { minDays: 5 }), null);
});
check('reports the window bounds, minutes and day count', () => {
  const best = m.truePeakWindow([hour(14, 60, 80, 8, 6), hour(15, 30, 40, 4, 6)]);
  assert.strictEqual(best.startHour, 14);
  assert.strictEqual(best.endHour, 16);
  assert.strictEqual(best.minutes, 90);
  assert.strictEqual(best.days, 6);
  assert.ok(best.score > 0 && best.score <= 90);
});
check('wraps around midnight', () => {
  const best = m.truePeakWindow([hour(23, 60, 100, 0, 8), hour(0, 60, 100, 0, 8)]);
  assert.strictEqual(best.startHour, 23);
  assert.strictEqual(best.endHour, 1);
});
check('churn of 100% scores zero surviving minutes', () => {
  assert.strictEqual(m.truePeakWindow([hour(9, 60, 100, 100, 9), hour(10, 0, 0, 0, 9)]), null);
});
check('returns null with no usable data', () => {
  assert.strictEqual(m.truePeakWindow([]), null);
  assert.strictEqual(m.truePeakWindow(null), null);
  assert.strictEqual(m.truePeakWindow([{ hour: 99, minutes: 10, days: 10 }]), null);
});

console.log('\nestimationCalibration');
check('reports the median ratio and the observed range', () => {
  const r = m.estimationCalibration([
    { estimatedHours: 10, actualHours: 12 },   // 1.2
    { estimatedHours: 10, actualHours: 20 },   // 2.0
    { estimatedHours: 10, actualHours: 16 },   // 1.6
  ]);
  assert.strictEqual(r.factor, 1.6, 'median, not mean');
  assert.strictEqual(r.minFactor, 1.2);
  assert.strictEqual(r.maxFactor, 2);
  assert.strictEqual(r.sampleSize, 3);
});
check('one runaway goal does not distort the headline factor', () => {
  const r = m.estimationCalibration([
    { estimatedHours: 10, actualHours: 11 },
    { estimatedHours: 10, actualHours: 12 },
    { estimatedHours: 10, actualHours: 500 },
  ]);
  assert.strictEqual(r.factor, 1.2);
  assert.strictEqual(r.maxFactor, 50);
});
check('works from a single completed goal (flagged low confidence, not withheld)', () => {
  const r = m.estimationCalibration([{ estimatedHours: 10, actualHours: 12 }]);
  assert.strictEqual(r.factor, 1.2);
  assert.strictEqual(r.sampleSize, 1);
});
check('ignores goals with a zero estimate or zero actual', () => {
  assert.strictEqual(m.estimationCalibration([{ estimatedHours: 0, actualHours: 5 }]), null);
  assert.strictEqual(m.estimationCalibration([{ estimatedHours: 5, actualHours: 0 }]), null);
});
check('returns null with no usable pairs', () => {
  assert.strictEqual(m.estimationCalibration([]), null);
  assert.strictEqual(m.estimationCalibration(null), null);
});

console.log('\nconfidenceFor');
check('grades insufficient / low / high against the threshold pair', () => {
  const t = { min: 3, good: 10 };
  assert.strictEqual(m.confidenceFor(0, t), 'insufficient');
  assert.strictEqual(m.confidenceFor(2, t), 'insufficient');
  assert.strictEqual(m.confidenceFor(3, t), 'low');
  assert.strictEqual(m.confidenceFor(9, t), 'low');
  assert.strictEqual(m.confidenceFor(10, t), 'high');
});
check('treats a non-numeric sample as insufficient', () => {
  assert.strictEqual(m.confidenceFor(undefined, { min: 1, good: 5 }), 'insufficient');
  assert.strictEqual(m.confidenceFor(NaN, { min: 1, good: 5 }), 'insufficient');
});
check('exposes a threshold for every gated metric', () => {
  for (const key of ['deepWorkRatio', 'flowBlocks', 'volumeStability', 'activeDaysRatio',
    'truePeakWindow', 'churnRatio', 'comprehensionLoad', 'contextSwitchesPerHour',
    'estimationCalibration']) {
    assert.ok(m.THRESHOLDS[key], `missing threshold for ${key}`);
    assert.ok(m.THRESHOLDS[key].good >= m.THRESHOLDS[key].min, `${key}: good < min`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
