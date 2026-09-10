const assert = require('assert');
const UserInsights = require('../models/UserInsights');
const {
  isStale, deltaFrom, getBaseline, BASELINE_DAYS, BASELINE_KEYS, MAX_AGE_MS,
} = require('../services/insightsBaseline');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const realFindOne = UserInsights.findOne.bind(UserInsights);
const realUpdateOne = UserInsights.updateOne.bind(UserInsights);
let writes = [];
function stub({ cached = null, findThrows = false, updateThrows = false } = {}) {
  writes = [];
  UserInsights.findOne = () => ({
    lean: async () => { if (findThrows) throw new Error('read failed'); return cached; },
  });
  UserInsights.updateOne = async (_f, u) => {
    if (updateThrows) throw new Error('write failed');
    writes.push(u.$set); return { acknowledged: true };
  };
}
const restore = () => { UserInsights.findOne = realFindOne; UserInsights.updateOne = realUpdateOne; };

/** A metrics object shaped the way buildMetrics returns one. */
const metricsFixture = (over = {}) => ({
  deepWorkRatio: 0.6,
  volumeStability: 0.8,
  activeDaysRatio: 0.5,
  churnRatio: 0.15,
  comprehensionLoad: 0.3,
  contextSwitchesPerHour: 20,
  interruptionsPerHour: 3,
  activeDays: 45,
  meta: Object.fromEntries(BASELINE_KEYS.map((k) => [k, { confidence: 'high', sampleSize: 100 }])),
  ...over,
});

(async () => {
  console.log('\nisStale');
  const now = Date.now();
  await check('a missing document is stale', () => {
    assert.strictEqual(isStale(null, now), true);
    assert.strictEqual(isStale({}, now), true);
  });
  await check('a document computed just now is fresh', () => {
    assert.strictEqual(isStale({ computedAt: new Date(now - 1000) }, now), false);
  });
  await check('exactly the max age counts as stale', () => {
    assert.strictEqual(isStale({ computedAt: new Date(now - MAX_AGE_MS) }, now), true);
  });
  await check('just under the max age is fresh', () => {
    assert.strictEqual(isStale({ computedAt: new Date(now - MAX_AGE_MS + 1000) }, now), false);
  });

  console.log('\ndeltaFrom');
  await check('reports the signed fractional change', () => {
    assert.strictEqual(deltaFrom(0.6, 0.5), 0.2);   // +20%
    assert.strictEqual(deltaFrom(0.4, 0.5), -0.2);  // -20%
    assert.strictEqual(deltaFrom(0.5, 0.5), 0);
  });
  await check('returns null when a zero baseline would make the change infinite', () => {
    assert.strictEqual(deltaFrom(0.5, 0), null);
  });
  await check('returns null for non-numeric or non-finite inputs', () => {
    assert.strictEqual(deltaFrom(undefined, 0.5), null);
    assert.strictEqual(deltaFrom(0.5, undefined), null);
    assert.strictEqual(deltaFrom(NaN, 0.5), null);
    assert.strictEqual(deltaFrom(Infinity, 0.5), null);
  });
  await check('handles a negative baseline without flipping the sign', () => {
    assert.strictEqual(deltaFrom(-1, -2), 0.5); // moved up by half of |−2|
  });

  console.log('\ngetBaseline — lazy refresh');

  await check('serves a fresh cache without recomputing', async () => {
    stub({ cached: { baseline: { deepWorkRatio: 0.4 }, baselineDays: 90, activeDays: 30, computedAt: new Date() } });
    let called = false;
    const r = await getBaseline('u1', {}, async () => { called = true; return metricsFixture(); });
    assert.strictEqual(called, false, 'must not recompute a fresh baseline');
    assert.strictEqual(r.baseline.deepWorkRatio, 0.4);
    assert.strictEqual(writes.length, 0);
  });

  await check('recomputes and caches when stale', async () => {
    stub({ cached: { baseline: { deepWorkRatio: 0.1 }, computedAt: new Date(Date.now() - 2 * MAX_AGE_MS) } });
    const r = await getBaseline('u2', {}, async () => metricsFixture());
    assert.strictEqual(r.baseline.deepWorkRatio, 0.6, 'used the recomputed value');
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].baselineDays, BASELINE_DAYS);
  });

  await check('computes from scratch when nothing is cached', async () => {
    stub({ cached: null });
    const r = await getBaseline('u3', {}, async () => metricsFixture());
    assert.ok(r && r.baseline.deepWorkRatio === 0.6);
    assert.strictEqual(writes.length, 1);
  });

  await check('asks for a 90-day window regardless of the caller window', async () => {
    stub({ cached: null });
    let seen = null;
    await getBaseline('u4', { timezoneOffset: -330 }, async (_id, opts) => { seen = opts; return metricsFixture(); });
    assert.strictEqual(seen.days, BASELINE_DAYS);
    assert.strictEqual(seen.timezoneOffset, -330, 'timezone is passed through');
  });

  await check('skips metrics the baseline window itself cannot support', async () => {
    stub({ cached: null });
    const fixture = metricsFixture();
    fixture.meta.deepWorkRatio.confidence = 'insufficient';
    await getBaseline('u5', {}, async () => fixture);
    assert.strictEqual(writes[0].baseline.deepWorkRatio, undefined, 'insufficient metric excluded');
    assert.strictEqual(writes[0].baseline.churnRatio, 0.15, 'confident metric kept');
  });

  await check('a metric with no confidence gate is skipped, never assumed confident', async () => {
    stub({ cached: null });
    const fixture = metricsFixture();
    delete fixture.meta.interruptionsPerHour;   // ungated
    await getBaseline('u6', {}, async () => fixture);
    assert.strictEqual(writes[0].baseline.interruptionsPerHour, undefined);
  });

  console.log('\ngetBaseline — failure handling');

  await check('a read failure degrades to no baseline rather than throwing', async () => {
    stub({ findThrows: true });
    assert.strictEqual(await getBaseline('u7', {}, async () => metricsFixture()), null);
  });

  await check('a recompute failure falls back to the stale cache', async () => {
    const old = { baseline: { deepWorkRatio: 0.33 }, baselineDays: 90, computedAt: new Date(Date.now() - 2 * MAX_AGE_MS) };
    stub({ cached: old });
    const r = await getBaseline('u8', {}, async () => { throw new Error('aggregate failed'); });
    assert.strictEqual(r.baseline.deepWorkRatio, 0.33);
    assert.strictEqual(r.stale, true, 'flagged as stale');
  });

  await check('a recompute failure with no cache yields null', async () => {
    stub({ cached: null });
    assert.strictEqual(await getBaseline('u9', {}, async () => { throw new Error('boom'); }), null);
  });

  await check('a cache write failure still returns the computed values', async () => {
    stub({ cached: null, updateThrows: true });
    const r = await getBaseline('u10', {}, async () => metricsFixture());
    assert.strictEqual(r.baseline.deepWorkRatio, 0.6);
  });

  await check('returns null when no compute function is supplied', async () => {
    stub({ cached: null });
    assert.strictEqual(await getBaseline('u11', {}), null);
  });

  restore();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
