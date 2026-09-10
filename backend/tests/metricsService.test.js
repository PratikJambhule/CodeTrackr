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
const UserInsights = require('../models/UserInsights');
const { buildMetrics } = require('../services/metricsService');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const MIN = 60000;
const realAggregate = Activity.aggregate.bind(Activity);
const realActivityFind = Activity.find.bind(Activity);
const realGoalFind = Goal.find.bind(Goal);
const realInsightsFind = UserInsights.findOne.bind(UserInsights);
const realInsightsUpdate = UserInsights.updateOne.bind(UserInsights);

/** Classify a pipeline the way buildMetrics builds them. */
function kindOf(pipeline) {
  const group = pipeline.find((s) => s.$group)?.$group || {};
  if (group._id === null && group.focusedMs) return 'totals';
  if (group._id === null && group.seconds) return 'goalHours';
  if (group.minutes && group.blocks) return 'daily';
  if (group.dayKeys) return 'hourly';
  return 'unknown';
}

let lastBaselineWrite = null;

function installStub({
  totals, daily, hourly, goals = [], goalHours = 0,
  sessionDocs = [], cachedInsights = null,
}) {
  Activity.aggregate = async (pipeline) => {
    switch (kindOf(pipeline)) {
      case 'totals': return totals ? [totals] : [];
      case 'daily': return daily || [];
      case 'hourly': return hourly || [];
      case 'goalHours': return goalHours ? [{ _id: null, seconds: goalHours }] : [];
      default: return [];
    }
  };
  // Chainable find(...).sort(...).lean() used for sessionization.
  Activity.find = () => ({ sort: () => ({ lean: async () => sessionDocs }) });
  Goal.find = () => ({ lean: async () => goals });

  lastBaselineWrite = null;
  UserInsights.findOne = () => ({ lean: async () => cachedInsights });
  UserInsights.updateOne = async (_filter, update) => {
    lastBaselineWrite = update?.$set || null;
    return { acknowledged: true };
  };
}
function restore() {
  Activity.aggregate = realAggregate;
  Activity.find = realActivityFind;
  Goal.find = realGoalFind;
  UserInsights.findOne = realInsightsFind;
  UserInsights.updateOne = realInsightsUpdate;
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

  console.log('\nbuildMetrics — sessions and archetypes');
  const S0 = Date.UTC(2026, 8, 10, 9, 0, 0);
  const bucket = (min, over = {}) => ({
    bucketStart: new Date(S0 + min * 60000),
    timestamp: new Date(S0 + min * 60000),
    duration: 600,
    projectName: 'app',
    language: 'typescript',
    editorAnalytics: { linesInserted: 0, churnLines: 0, readMs: 0, writeMs: 0, fileSwitches: 0, ...over.editor },
    focusAnalytics: { focusedMs: 0, blurEvents: 0, flowBlocksMs: [], ...over.focus },
    gitAnalytics: { commits: 0, filesChanged: 0 },
    terminalAnalytics: { totalCommands: 0, buildRuns: 0, failedBuilds: 0, debuggingSessions: 0, ...over.terminal },
  });

  installStub({
    totals: richTotals, daily: richDaily, hourly: richHourly,
    sessionDocs: [
      bucket(0, { editor: { linesInserted: 120, churnLines: 6, writeMs: 500000, readMs: 100000 }, focus: { flowBlocksMs: [35 * MIN] } }),
      bucket(10, { editor: { linesInserted: 90, churnLines: 4, writeMs: 500000, readMs: 100000 } }),
      // long break, then a debugging stretch
      bucket(240, { editor: { linesInserted: 5, churnLines: 3, writeMs: 200000, readMs: 400000 }, terminal: { totalCommands: 9, buildRuns: 4, failedBuilds: 4, debuggingSessions: 1 } }),
      bucket(250, { editor: { linesInserted: 3, churnLines: 2, writeMs: 200000, readMs: 400000 }, terminal: { totalCommands: 6, buildRuns: 3, failedBuilds: 2 } }),
    ],
  });
  const withSessions = await buildMetrics('u7', { days: 30, timezoneOffset: 0 });

  await check('splits the raw buckets into sessions', () => {
    assert.strictEqual(withSessions.sessionCount, 2);
  });
  await check('labels each session with an archetype and a reason', () => {
    const kinds = withSessions.recentSessions.map((s) => s.archetype);
    assert.ok(kinds.includes('deep-build'), `got ${kinds.join(', ')}`);
    assert.ok(kinds.includes('debug-grind'), `got ${kinds.join(', ')}`);
    assert.ok(withSessions.recentSessions.every((s) => typeof s.reason === 'string' && s.reason));
  });
  await check('reports the archetype mix in sessions and minutes', () => {
    assert.strictEqual(withSessions.archetypeMix['deep-build'].sessions, 1);
    assert.strictEqual(withSessions.archetypeMix['debug-grind'].sessions, 1);
    assert.strictEqual(withSessions.archetypeMix['deep-build'].minutes, 20);
  });
  await check('recentSessions is newest-first and capped', () => {
    assert.ok(withSessions.recentSessions.length <= 20);
    assert.ok(withSessions.recentSessions[0].startMs >= withSessions.recentSessions[1].startMs);
  });
  await check('the session window is capped independently of the metrics window', () => {
    assert.strictEqual(withSessions.sessionWindowDays, 30);
  });
  await check('a 365-day metrics window still caps sessionization at 30 days', async () => {
    const wide = await buildMetrics('u7', { days: 365, timezoneOffset: 0 });
    assert.strictEqual(wide.sessionWindowDays, 30);
  });

  console.log('\nbuildMetrics — 90-day baseline (lazily cached)');

  await check('a fresh cached baseline is used without recomputing', async () => {
    installStub({
      totals: richTotals, daily: richDaily, hourly: richHourly,
      cachedInsights: {
        userId: 'u8',
        baseline: { deepWorkRatio: 0.5, churnRatio: 0.2 },
        baselineDays: 90,
        activeDays: 60,
        computedAt: new Date(),           // fresh
      },
    });
    const r = await buildMetrics('u8', { days: 30, timezoneOffset: 0 });
    assert.strictEqual(r.meta.deepWorkRatio.baseline, 0.5);
    assert.strictEqual(lastBaselineWrite, null, 'must not rewrite a fresh cache');
  });

  await check('delta is the signed fractional change from the baseline', async () => {
    installStub({
      totals: richTotals, daily: richDaily, hourly: richHourly,
      cachedInsights: {
        userId: 'u9', baseline: { churnRatio: 0.2 }, baselineDays: 90,
        computedAt: new Date(),
      },
    });
    const r = await buildMetrics('u9', { days: 30, timezoneOffset: 0 });
    // current churnRatio is 0.1 against a 0.2 baseline -> -50%
    assert.strictEqual(r.meta.churnRatio.delta, -0.5);
  });

  await check('a stale cache is recomputed and written back', async () => {
    installStub({
      totals: richTotals, daily: richDaily, hourly: richHourly,
      cachedInsights: {
        userId: 'u10', baseline: { deepWorkRatio: 0.1 }, baselineDays: 90,
        computedAt: new Date(Date.now() - 40 * 3600 * 1000), // 40h old
      },
    });
    const r = await buildMetrics('u10', { days: 30, timezoneOffset: 0 });
    assert.ok(lastBaselineWrite, 'expected a cache write');
    assert.ok(lastBaselineWrite.computedAt instanceof Date);
    assert.strictEqual(lastBaselineWrite.baselineDays, 90);
    // Recomputed from the same fixtures, so it now matches the live value.
    assert.strictEqual(r.meta.deepWorkRatio.baseline, r.deepWorkRatio);
  });

  await check('no cache at all is computed from scratch', async () => {
    installStub({ totals: richTotals, daily: richDaily, hourly: richHourly, cachedInsights: null });
    const r = await buildMetrics('u11', { days: 30, timezoneOffset: 0 });
    assert.ok(lastBaselineWrite, 'expected the first computation to be cached');
    assert.ok(typeof r.baselineDays === 'number');
  });

  await check('a metric with an insufficient baseline gets no comparison', async () => {
    installStub({ totals: null, daily: [], hourly: [], cachedInsights: null });
    const r = await buildMetrics('u12', { days: 30, timezoneOffset: 0 });
    // Empty window -> every metric insufficient -> nothing worth baselining.
    assert.deepStrictEqual(lastBaselineWrite.baseline, {});
    assert.strictEqual(r.meta.deepWorkRatio.baseline, undefined);
    assert.strictEqual(r.meta.deepWorkRatio.delta, undefined);
  });

  await check('a baseline read failure degrades to no comparison, not an error', async () => {
    installStub({ totals: richTotals, daily: richDaily, hourly: richHourly });
    UserInsights.findOne = () => { throw new Error('mongo down'); };
    const r = await buildMetrics('u13', { days: 30, timezoneOffset: 0 });
    assert.ok(r.deepWorkRatio > 0, 'metrics still computed');
    assert.strictEqual(r.meta.deepWorkRatio.baseline, undefined);
  });

  restore();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
