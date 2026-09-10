const assert = require('assert');
const { evaluate, validateRules, RULES, GATED_METRICS } = require('../services/rulesEngine');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

/** Build a metrics payload with confident meta for the named metrics. */
function payload(values = {}, confident = [], metaExtras = {}) {
  const meta = {};
  for (const name of confident) {
    meta[name] = { confidence: 'high', sampleSize: 100, unit: 'test', ...(metaExtras[name] || {}) };
  }
  return { windowDays: 30, ...values, meta };
}

const idsOf = (r) => r.findings.map((f) => f.id);
const skipIds = (r) => r.skipped.map((s) => s.id);

(async () => {
  console.log('\nrulesEngine — rule definitions');

  await check('every shipped rule is valid', async () => {
    assert.deepStrictEqual(validateRules(), []);
  });

  await check('a rule requiring an ungated metric is rejected', async () => {
    // The insightsBaseline bug in miniature: a name with no meta entry made the
    // `confidence !== insufficient` guard pass vacuously.
    const problems = validateRules([
      { id: 'bad', severity: 'info', requires: ['qualityStreak'], evaluate: () => null },
    ]);
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /no confidence gate/);
  });

  await check('duplicate ids and bad severities are rejected', async () => {
    const problems = validateRules([
      { id: 'dup', severity: 'info', requires: [], evaluate: () => null },
      { id: 'dup', severity: 'nope', requires: [], evaluate: () => null },
    ]);
    assert.ok(problems.some((p) => /duplicate rule id/.test(p)));
    assert.ok(problems.some((p) => /unknown severity/.test(p)));
  });

  await check('GATED_METRICS covers every name any rule requires', async () => {
    for (const rule of RULES) {
      for (const name of rule.requires || []) {
        assert.ok(GATED_METRICS.has(name), `${rule.id} requires ungated ${name}`);
      }
    }
  });

  console.log('\nrulesEngine — confidence gating');

  await check('an empty payload fires nothing and skips everything gated', async () => {
    const result = evaluate({});
    assert.deepStrictEqual(result.findings, []);
    // Every rule with a `requires` should be skipped for insufficient data.
    const gatedRuleIds = RULES.filter((r) => (r.requires || []).length).map((r) => r.id);
    for (const id of gatedRuleIds) {
      assert.ok(skipIds(result).includes(id), `${id} should have been skipped`);
    }
  });

  await check('an insufficient metric skips its rule rather than firing on zero', async () => {
    const m = payload({ churnRatio: 0.9 }, []);
    m.meta.churnRatio = { confidence: 'insufficient', sampleSize: 2, unit: 'lines inserted' };
    const result = evaluate(m);
    assert.ok(!idsOf(result).includes('churn-spike'));
    const skip = result.skipped.find((s) => s.id === 'churn-spike');
    assert.strictEqual(skip.reason, 'insufficient-data');
    assert.deepStrictEqual(skip.metrics, ['churnRatio']);
  });

  await check('a missing meta entry skips the rule (never passes vacuously)', async () => {
    const result = evaluate({ churnRatio: 0.9, meta: {} });
    assert.ok(!idsOf(result).includes('churn-spike'));
    assert.ok(skipIds(result).includes('churn-spike'));
  });

  console.log('\nrulesEngine — individual rules');

  await check('churn-spike needs both a high ratio and a rise over baseline', async () => {
    const high = payload({ churnRatio: 0.45 }, ['churnRatio'],
      { churnRatio: { baseline: 0.2, delta: 0.25 } });
    assert.ok(idsOf(evaluate(high)).includes('churn-spike'));

    // High, but that is simply normal for this user -> not a spike.
    const normal = payload({ churnRatio: 0.45 }, ['churnRatio'],
      { churnRatio: { baseline: 0.44, delta: 0.01 } });
    assert.ok(!idsOf(evaluate(normal)).includes('churn-spike'));

    // Risen sharply, but still low in absolute terms -> not worth saying.
    const low = payload({ churnRatio: 0.12 }, ['churnRatio'],
      { churnRatio: { baseline: 0.01, delta: 0.11 } });
    assert.ok(!idsOf(evaluate(low)).includes('churn-spike'));
  });

  await check('churn-spike stays silent with no baseline to compare against', async () => {
    const m = payload({ churnRatio: 0.9 }, ['churnRatio']);
    assert.ok(!idsOf(evaluate(m)).includes('churn-spike'));
  });

  await check('churn-low requires high confidence, not merely low churn', async () => {
    const m = payload({ churnRatio: 0.05 }, ['churnRatio']);
    assert.ok(idsOf(evaluate(m)).includes('churn-low'));

    m.meta.churnRatio.confidence = 'low';
    assert.ok(!idsOf(evaluate(m)).includes('churn-low'));
  });

  await check('fragmented-focus fires above 30 switches/hour', async () => {
    assert.ok(idsOf(evaluate(payload({ contextSwitchesPerHour: 42 }, ['contextSwitchesPerHour'])))
      .includes('fragmented-focus'));
    assert.ok(!idsOf(evaluate(payload({ contextSwitchesPerHour: 12 }, ['contextSwitchesPerHour'])))
      .includes('fragmented-focus'));
  });

  await check('deep-work rules are mutually exclusive', async () => {
    const strong = evaluate(payload(
      { deepWorkRatio: 0.72, flowBlocks: { deepBlockCount: 9, blockCount: 12, longestMs: 3.6e6 } },
      ['deepWorkRatio']));
    assert.ok(idsOf(strong).includes('deep-work-strong'));
    assert.ok(!idsOf(strong).includes('deep-work-scarce'));

    const scarce = evaluate(payload(
      { deepWorkRatio: 0.05, flowBlocks: { deepBlockCount: 0, blockCount: 14, longestMs: 600000 } },
      ['deepWorkRatio']));
    assert.ok(idsOf(scarce).includes('deep-work-scarce'));
    assert.ok(!idsOf(scarce).includes('deep-work-strong'));
  });

  await check('peak-window reports the real hours and day count', async () => {
    const m = payload(
      { truePeakWindow: { startHour: 21, endHour: 23, days: 8, score: 140.5 } },
      ['truePeakWindow']);
    const finding = evaluate(m).findings.find((f) => f.id === 'peak-window');
    assert.match(finding.title, /21:00–23:00/);
    assert.strictEqual(finding.evidence.days, 8);
  });

  await check('peak-window stays silent when the metric is null despite confidence', async () => {
    const m = payload({ truePeakWindow: null }, ['truePeakWindow']);
    assert.ok(!idsOf(evaluate(m)).includes('peak-window'));
  });

  await check('quality-streak needs no confidence gate and fires from 3 days', async () => {
    assert.ok(idsOf(evaluate({ qualityStreak: 4, meta: {} })).includes('quality-streak'));
    assert.ok(!idsOf(evaluate({ qualityStreak: 2, meta: {} })).includes('quality-streak'));
  });

  await check('estimation rules split under- from well-estimated', async () => {
    const under = payload(
      { estimationCalibration: { factor: 2.1, minFactor: 1.4, maxFactor: 3.0, sampleSize: 4 } },
      ['estimationCalibration']);
    assert.ok(idsOf(evaluate(under)).includes('estimation-under'));
    assert.ok(!idsOf(evaluate(under)).includes('estimation-accurate'));

    const accurate = payload(
      { estimationCalibration: { factor: 1.02, minFactor: 0.9, maxFactor: 1.1, sampleSize: 3 } },
      ['estimationCalibration']);
    assert.ok(idsOf(evaluate(accurate)).includes('estimation-accurate'));
    assert.ok(!idsOf(evaluate(accurate)).includes('estimation-under'));
  });

  await check('a single completed goal is described in the singular', async () => {
    const m = payload(
      { estimationCalibration: { factor: 1.9, minFactor: 1.9, maxFactor: 1.9, sampleSize: 1 } },
      ['estimationCalibration']);
    const finding = evaluate(m).findings.find((f) => f.id === 'estimation-under');
    assert.match(finding.detail, /1 completed goal[^s]/);
  });

  console.log('\nrulesEngine — output contract');

  await check('findings are ordered warning, then info, then positive', async () => {
    const m = payload({
      churnRatio: 0.5,
      contextSwitchesPerHour: 44,
      deepWorkRatio: 0.02,
      flowBlocks: { deepBlockCount: 0, blockCount: 10, longestMs: 300000 },
      qualityStreak: 5,
    }, ['churnRatio', 'contextSwitchesPerHour', 'deepWorkRatio'],
    { churnRatio: { baseline: 0.2, delta: 0.3 } });

    const severities = evaluate(m).findings.map((f) => f.severity);
    const ranks = severities.map((s) => ({ warning: 0, info: 1, positive: 2 })[s]);
    assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b), `unsorted: ${severities}`);
  });

  await check('the limit caps findings but totalFindings reports the true count', async () => {
    const m = payload({
      churnRatio: 0.5,
      contextSwitchesPerHour: 44,
      interruptionsPerHour: 22,
      deepWorkRatio: 0.02,
      flowBlocks: { deepBlockCount: 0, blockCount: 10, longestMs: 300000 },
      qualityStreak: 5,
      activeDaysRatio: 0.1,
      activeDays: 3,
      volumeStability: 0.2,
    }, ['churnRatio', 'contextSwitchesPerHour', 'interruptionsPerHour', 'deepWorkRatio',
        'activeDaysRatio', 'volumeStability'],
    { churnRatio: { baseline: 0.2, delta: 0.3 } });

    const result = evaluate(m, { limit: 2 });
    assert.strictEqual(result.findings.length, 2);
    assert.ok(result.totalFindings > 2, 'totalFindings should exceed the cap');
  });

  await check('every finding carries evidence and no internal fields leak', async () => {
    const m = payload({ contextSwitchesPerHour: 44 }, ['contextSwitchesPerHour']);
    for (const f of evaluate(m).findings) {
      assert.ok(f.evidence && typeof f.evidence === 'object', `${f.id} has no evidence`);
      assert.ok(!('_order' in f), `${f.id} leaked _order`);
      assert.ok(f.title && f.detail, `${f.id} missing text`);
    }
  });

  await check('a throwing rule is contained, not fatal', async () => {
    const boom = [{
      id: 'boom', category: 'x', severity: 'info', requires: [],
      evaluate() { throw new Error('kaboom'); },
    }];
    const result = evaluate({ meta: {} }, { rules: boom });
    assert.deepStrictEqual(result.findings, []);
    assert.strictEqual(result.skipped[0].reason, 'error');
    assert.strictEqual(result.skipped[0].message, 'kaboom');
  });

  await check('null and undefined payloads do not throw', async () => {
    assert.doesNotThrow(() => evaluate(null));
    assert.doesNotThrow(() => evaluate(undefined));
    assert.deepStrictEqual(evaluate(null).findings, []);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
