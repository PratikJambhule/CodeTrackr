/**
 * Integration test for services/metricsService.buildMetrics.
 *
 * The pure maths is covered by metrics.test.js; this exercises the *wiring* —
 * that each aggregate's output reaches the right formula, that `meta` grades
 * every metric, and that sparse/legacy/empty data degrades safely rather than
 * emitting a confident-looking number.
 *
 * Models are stubbed (no database). The stub dispatches on the shape of the
 * pipeline, mirroring how buildMetrics actually queries.
 */
const assert = require('assert');
const Activity = require('../models/Activity');
const Goal = require('../models/Goal');
const { buildMetrics } = require('../services/metricsService');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const MIN = 60000;
const realAggregate = Activity.aggregate.bind(Activity);
const realGoalFind = Goal.find.bind(Goal);

/** Classify a pipeline the way buildMetrics builds them. */
function kindOf(pipeline) {
  const group = pipeline.find((s) => s.$group)?.$group || {};
  if (group._id === null && group.focusedMs) return 'totals';
  if (group._id === null && group.seconds) return 'goalHours';
  if (group.minutes && group.blocks) return 'daily';
  if (group.dayKeys) return 'hourly';
  return 'unknown';
}

function installStub({ totals, daily, hourly, goals = [], goalHours = 0 }) {
  Activity.aggregate = async (pipeline) => {
    switch (kindOf(pipeline)) {
      case 'totals': return totals ? [totals] : [];
      case 'daily': return daily || [];
      case 'hourly': return hourly || [];
      case 'goalHours': return goalHours ? [{ _id: null, seconds: goalHours }] : [];
      default: return [];
    }
  };
  Goal.find = () => ({ lean: async () => goals });
}
function restore() {
  Activity.aggregate = realAggregate;
  Goal.find = realGoalFind;
}

// A realistic-ish 30-day window: steady weekday work, some deep blocks.
const richTotals = {
  _id: null,
  focusedMs: 40 * 3600000,
  blurredMs: 5 * 3600000,
  blurEvents: 120,
  blocks: [
    [30 * MIN, 45 * MIN, 8 * MIN],
    [26 * MIN, 5 * MIN, 12 * MIN],
    [60 * MIN, 3 * MIN],
    [28 * MIN, 31 * MIN, 4 * MIN, 9 * MIN],
  ],
  churnLines: 400,
  linesInserted: 4000,
  readMs: 12 * 3600000,
  writeMs: 28 * 3600000,
  fileSwitches: 800,
  commits: 62,
  totalSeconds: 44 * 3600,
};
const richDaily = Array.from({ length: 18 }, (_, i) => ({
  _id: `2026-08-${String(i + 10).padStart(2, '0')}`,
  minutes: 130 + (i % 5) * 10,
  blocks: i % 2 === 0 ? [[30 * MIN]] : [[9 * MIN]],
}));
const richHourly = [
  { hour: 9, minutes: 300, commits: 20, linesInserted: 1200, churnLines: 60, days: 14 },
  { hour: 10, minutes: 340, commits: 22, linesInserted: 1400, churnLines: 70, days: 15 },
  { hour: 15, minutes: 400, commits: 8, linesInserted: 900, churnLines: 800, days: 12 },
  { hour: 16, minutes: 380, commits: 6, linesInserted: 800, churnLines: 760, days: 12 },
  { hour: 3, minutes: 200, commits: 12, linesInserted: 900, churnLines: 10, days: 1 },
];

(async () => {
  console.log('\nbuildMetrics — populated window');

  installStub({ totals: richTotals, daily: richDaily, hourly: richHourly });
  const rich = await buildMetrics('u1', { days: 30, timezoneOffset: 0 });

  await check('deepWorkRatio is a share of block time, bounded [0,1]', () => {
    assert.ok(rich.deepWorkRatio > 0 && rich.deepWorkRatio <= 1,
      `got ${rich.deepWorkRatio}`);
  });
  await check('deepWorkRatio ignores focusedMs entirely', () => {
    // deep = 30+45+26+60+28+31 = 220 min of 261 total block minutes.
    // focusedMs is 40h; the old formula would have produced 220/2400 = 0.09.
    assert.strictEqual(rich.deepWorkRatio, 0.84);
  });
  await check('flowBlocks reports the distribution and total', () => {
    assert.strictEqual(rich.flowBlocks.blockCount, 12);
    assert.strictEqual(rich.flowBlocks.deepBlockCount, 6);
    assert.strictEqual(rich.flowBlocks.longestMs, 60 * MIN);
    assert.strictEqual(rich.flowBlocks.totalMs, 261 * MIN);
  });
  await check('truePeakWindow picks the surviving-output window, not the busiest', () => {
    // 15:00-17:00 has the most minutes but ~89% churn; 09:00-11:00 wins.
    assert.strictEqual(rich.truePeakWindow.startHour, 9);
    assert.strictEqual(rich.truePeakWindow.endHour, 11);
  });
  await check('a one-off 03:00 session cannot win the peak window', () => {
    assert.notStrictEqual(rich.truePeakWindow.startHour, 3);
    assert.notStrictEqual(rich.truePeakWindow.startHour, 2);
  });
  await check('churnRatio is a bounded fraction, not a percentage', () => {
    assert.strictEqual(rich.churnRatio, 0.1); // 400 / 4000
    assert.ok(rich.churnRatio >= 0 && rich.churnRatio <= 1);
  });
  await check('comprehensionLoad is readMs / (readMs + writeMs)', () => {
    assert.strictEqual(rich.comprehensionLoad, 0.3); // 12h of 40h
  });
  await check('activeDaysRatio and activeDays reflect the daily rows', () => {
    assert.strictEqual(rich.activeDays, 18);
    assert.ok(rich.activeDaysRatio > 0 && rich.activeDaysRatio <= 1);
  });
  await check('qualityStreak counts only days containing a deep block', () => {
    assert.ok(Number.isInteger(rich.qualityStreak));
    assert.ok(rich.qualityStreak >= 0);
  });
  await check('interruptionsPerHour is derived from blurEvents', () => {
    assert.strictEqual(rich.interruptionsPerHour, 3); // 120 / 40h
  });
  await check('totalHours and focusedHours are hours, not seconds', () => {
    assert.strictEqual(rich.totalHours, 44);
    assert.strictEqual(rich.focusedHours, 40);
  });
  await check('meta grades every gated metric', () => {
    for (const key of ['deepWorkRatio', 'flowBlocks', 'volumeStability', 'activeDaysRatio',
      'truePeakWindow', 'churnRatio', 'comprehensionLoad', 'contextSwitchesPerHour',
      'estimationCalibration']) {
      assert.ok(rich.meta[key], `meta.${key} missing`);
      assert.ok(['insufficient', 'low', 'high'].includes(rich.meta[key].confidence),
        `meta.${key}.confidence = ${rich.meta[key].confidence}`);
      assert.ok(typeof rich.meta[key].sampleSize === 'number');
    }
  });
  await check('a well-populated window reports high confidence on the headline metrics', () => {
    assert.strictEqual(rich.meta.deepWorkRatio.confidence, 'high');
    assert.strictEqual(rich.meta.churnRatio.confidence, 'high');
  });
  await check('consistencyIndex is retained as a back-compat alias', () => {
    assert.strictEqual(rich.consistencyIndex, rich.volumeStability);
  });

  console.log('\nbuildMetrics — empty window (a brand-new user)');
  installStub({ totals: null, daily: [], hourly: [] });
  const empty = await buildMetrics('u2', { days: 30, timezoneOffset: 0 });

  await check('returns zeros and nulls rather than NaN', () => {
    assert.strictEqual(empty.deepWorkRatio, 0);
    assert.strictEqual(empty.churnRatio, 0);
    assert.strictEqual(empty.comprehensionLoad, 0);
    assert.strictEqual(empty.contextSwitchesPerHour, 0);
    assert.strictEqual(empty.totalHours, 0);
    assert.strictEqual(empty.truePeakWindow, null);
    assert.strictEqual(empty.estimationCalibration, null);
  });
  await check('no field is NaN or Infinity', () => {
    for (const [k, v] of Object.entries(empty)) {
      if (typeof v === 'number') {
        assert.ok(Number.isFinite(v), `${k} = ${v}`);
      }
    }
  });
  await check('every metric is graded insufficient on an empty window', () => {
    for (const key of Object.keys(empty.meta)) {
      assert.strictEqual(empty.meta[key].confidence, 'insufficient', key);
    }
  });

  console.log('\nbuildMetrics — sparse/legacy documents (missing sub-docs)');
  installStub({
    // Legacy per-flush docs predate the analytics sub-documents entirely.
    totals: { _id: null, totalSeconds: 3600, blocks: [[], null] },
    daily: [{ _id: '2026-09-09', minutes: 60, blocks: [null] }],
    hourly: [{ hour: 11, minutes: 60, days: 1 }],
  });
  const legacy = await buildMetrics('u3', { days: 7, timezoneOffset: 0 });

  await check('survives documents with no analytics sub-documents', () => {
    assert.strictEqual(legacy.deepWorkRatio, 0);
    assert.strictEqual(legacy.flowBlocks.blockCount, 0);
    assert.strictEqual(legacy.totalHours, 1);
    assert.ok(Number.isFinite(legacy.contextSwitchesPerHour));
  });
  await check('a single low-sample hour does not produce a peak window', () => {
    assert.strictEqual(legacy.truePeakWindow, null);
    assert.strictEqual(legacy.meta.truePeakWindow.confidence, 'insufficient');
  });

  console.log('\nbuildMetrics — estimation calibration (the previously dead flow)');
  installStub({
    totals: richTotals, daily: richDaily, hourly: richHourly,
    goals: [
      { techStack: 'typescript', targetHours: 10, createdAt: new Date('2026-08-01'), completedAt: new Date('2026-08-20') },
      { techStack: 'typescript', targetHours: 5, createdAt: new Date('2026-08-01'), completedAt: new Date('2026-08-20') },
    ],
    goalHours: 15 * 3600, // 15h matched per goal
  });
  const withGoals = await buildMetrics('u4', { days: 30, timezoneOffset: 0 });

  await check('completed goals now produce a calibration factor', () => {
    assert.ok(withGoals.estimationCalibration, 'expected a calibration result');
    assert.strictEqual(withGoals.estimationCalibration.sampleSize, 2);
  });
  await check('the factor is the median actual/estimate ratio', () => {
    // 15/10 = 1.5 and 15/5 = 3.0 -> median of two = 2.25
    assert.strictEqual(withGoals.estimationCalibration.factor, 2.25);
  });
  await check('a goal whose stack matches no activity is skipped, not scored 0', () => {
    installStub({
      totals: richTotals, daily: richDaily, hourly: richHourly,
      goals: [{ techStack: 'cobol', targetHours: 10, createdAt: new Date('2026-08-01'), completedAt: new Date('2026-08-20') }],
      goalHours: 0,
    });
    return buildMetrics('u5', { days: 30, timezoneOffset: 0 }).then((r) => {
      assert.strictEqual(r.estimationCalibration, null, 'must not fabricate a 0-hour goal');
    });
  });
  await check('goals with no techStack are ignored', () => {
    installStub({
      totals: richTotals, daily: richDaily, hourly: richHourly,
      goals: [{ techStack: '', targetHours: 10, createdAt: new Date('2026-08-01') }],
      goalHours: 9999,
    });
    return buildMetrics('u6', { days: 30, timezoneOffset: 0 }).then((r) => {
      assert.strictEqual(r.estimationCalibration, null);
    });
  });

  restore();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
