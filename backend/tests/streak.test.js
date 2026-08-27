/**
 * Tests for the streak + local-day helpers in routes/analytics.js.
 *
 * These functions are the grounding for both the dashboard and the planned AI
 * insights layer, so they are tested against the real shipped source: the
 * helpers are extracted from analytics.js and evaluated with a stubbed
 * Activity.aggregate, rather than being reimplemented here (a reimplementation
 * would pass even if the shipped code broke).
 *
 * Run: node tests/streak.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'analytics.js'), 'utf8');

function extract(name) {
  const start = SRC.indexOf(`function ${name}(`);
  const asyncStart = SRC.indexOf(`async function ${name}(`);
  const from = asyncStart !== -1 ? asyncStart : start;
  assert.notStrictEqual(from, -1, `could not find ${name} in analytics.js`);

  // Walk braces from the first '{' to find the function body end.
  const open = SRC.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') {
      depth--;
      if (depth === 0) return SRC.slice(from, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const WINDOW = Number(/const STREAK_WINDOW_DAYS = (\d+)/.exec(SRC)[1]);

// Build a sandbox holding the real helper source plus a stubbed Activity model.
function buildSandbox(activeDayKeys) {
  const Activity = {
    aggregate: async () =>
      activeDayKeys.map((key) => ({ _id: key, seconds: 3600 }))
  };
  const factory = new Function(
    'Activity',
    'STREAK_WINDOW_DAYS',
    `${extract('localDayInfo')}\n${extract('computeStreak')}\n` +
      'return { localDayInfo, computeStreak };'
  );
  return factory(Activity, WINDOW);
}

const IST = -330; // Date.getTimezoneOffset() for Asia/Kolkata

function keyDaysAgo(n, offset) {
  const offsetMs = offset * 60000;
  return new Date(Date.now() - n * 24 * 3600000 - offsetMs).toISOString().slice(0, 10);
}

let passed = 0;
let failed = 0;

async function check(name, activeDays, offset, expected) {
  const { computeStreak } = buildSandbox(activeDays);
  try {
    const actual = await computeStreak('user-1', offset);
    assert.strictEqual(actual, expected);
    console.log(`  PASS  ${name} -> ${actual}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: expected ${expected}, got ${err.actual}`);
    failed++;
  }
}

(async () => {
  console.log('\ncomputeStreak');

  await check('today + 2 prior days', [keyDaysAgo(0, IST), keyDaysAgo(1, IST), keyDaysAgo(2, IST)], IST, 3);

  // Regression: a day that has not started yet must not break the streak.
  await check('yesterday + day before, nothing today', [keyDaysAgo(1, IST), keyDaysAgo(2, IST)], IST, 2);

  // Regression: the old code seeded streakDays = 1 without a recency check,
  // so a long-inactive user still showed a streak.
  await check('only stale activity 5 days ago', [keyDaysAgo(5, IST)], IST, 0);

  await check('no activity at all', [], IST, 0);

  // Regression: the old code only fetched 7 days, so streaks capped at 7.
  await check(
    '10 consecutive days including today',
    Array.from({ length: 10 }, (_, i) => keyDaysAgo(i, IST)),
    IST,
    10
  );

  await check(
    'gap breaks the streak',
    [keyDaysAgo(0, IST), keyDaysAgo(1, IST), keyDaysAgo(4, IST)],
    IST,
    2
  );

  await check('UTC user, today only', [keyDaysAgo(0, 0)], 0, 1);

  console.log('\nlocalDayInfo');
  const { localDayInfo } = buildSandbox([]);

  // 2026-03-10T20:00Z is 2026-03-11 01:30 IST -> must bucket to the 11th.
  const ist = localDayInfo('2026-03-10T20:00:00.000Z', IST);
  try {
    assert.strictEqual(ist.key, '2026-03-11');
    console.log(`  PASS  late-evening UTC maps to next IST day -> ${ist.key} (${ist.label})`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  expected 2026-03-11, got ${ist.key}`);
    failed++;
  }

  // Same instant for a UTC user stays on the 10th.
  const utc = localDayInfo('2026-03-10T20:00:00.000Z', 0);
  try {
    assert.strictEqual(utc.key, '2026-03-10');
    console.log(`  PASS  same instant stays on the 10th for UTC -> ${utc.key}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  expected 2026-03-10, got ${utc.key}`);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
