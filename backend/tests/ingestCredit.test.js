/**
 * Tests for services/ingestCredit.js — the pure anti-cheat planning (roadmap item 5).
 * Run: node tests/ingestCredit.test.js
 */
const assert = require('assert');
const { spreadAcrossWindows, corroboratedSeconds, creditFromCounter, WINDOW_CAP_SECONDS } = require('../services/ingestCredit');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const T = (iso) => new Date(iso).getTime();
const NOW = T('2026-10-03T12:00:00Z');

console.log('\ningestCredit: spreadAcrossWindows');

check('a short upload inside one window stays in that window', () => {
  const s = spreadAcrossWindows(T('2026-10-03T11:21:00Z'), 120, NOW);
  assert.deepStrictEqual(s.map((x) => [x.bucketStart.toISOString(), x.seconds]),
    [['2026-10-03T11:20:00.000Z', 120]]);
});

check('an upload crossing a boundary is split at the boundary', () => {
  const s = spreadAcrossWindows(T('2026-10-03T11:28:00Z'), 300, NOW);
  assert.deepStrictEqual(s.map((x) => [x.bucketStart.toISOString(), x.seconds]),
    [['2026-10-03T11:20:00.000Z', 120], ['2026-10-03T11:30:00.000Z', 180]]);
});

check('a legitimate hour is spread over six windows, not truncated', () => {
  const s = spreadAcrossWindows(T('2026-10-03T10:00:00Z'), 3600, NOW);
  assert.strictEqual(s.length, 6);
  assert.ok(s.every((x) => x.seconds === 600));
  assert.strictEqual(s.reduce((a, x) => a + x.seconds, 0), 3600);
});

check('a span that would run past now is shifted back to end at now', () => {
  const s = spreadAcrossWindows(T('2026-10-03T11:55:00Z'), 600, NOW);
  const end = s[s.length - 1].bucketStart.getTime() + 600000;
  assert.ok(end <= NOW + 600000);
  assert.strictEqual(s[0].bucketStart.toISOString(), '2026-10-03T11:50:00.000Z');
  assert.strictEqual(s.reduce((a, x) => a + x.seconds, 0), 600);
});

check('seconds are whole numbers that add up exactly', () => {
  const s = spreadAcrossWindows(T('2026-10-03T11:03:17Z'), 1001, NOW);
  assert.ok(s.every((x) => Number.isInteger(x.seconds)));
  assert.strictEqual(s.reduce((a, x) => a + x.seconds, 0), 1001);
});

check('zero or invalid seconds yield nothing', () => {
  assert.deepStrictEqual(spreadAcrossWindows(NOW - 1000, 0, NOW), []);
  assert.deepStrictEqual(spreadAcrossWindows(NOW - 1000, NaN, NOW), []);
});

console.log('\ningestCredit: corroboratedSeconds');

check('time is capped at window-focus time plus a 120 s grace', () => {
  assert.strictEqual(corroboratedSeconds(3600, { focusedMs: 600000 }), 720);
});

check('honest uploads (focus >= duration) are not reduced', () => {
  assert.strictEqual(corroboratedSeconds(110, { focusedMs: 105000 }), 110);
  assert.strictEqual(corroboratedSeconds(300, { focusedMs: 300000 }), 300);
});

check('an upload with no focus data gets only the grace', () => {
  assert.strictEqual(corroboratedSeconds(3600, undefined), 120);
  assert.strictEqual(corroboratedSeconds(60, {}), 60);
});

console.log('\ningestCredit: creditFromCounter');

check('credit is what still fits under the cap after this increment', () => {
  assert.strictEqual(WINDOW_CAP_SECONDS, 600);
  assert.strictEqual(creditFromCounter(300, 300), 300);   // 0 -> 300: all fits
  assert.strictEqual(creditFromCounter(500, 700), 400);   // 200 -> 700: 400 fits
  assert.strictEqual(creditFromCounter(100, 900), 0);     // 800 -> 900: window already full
  assert.strictEqual(creditFromCounter(600, 600), 600);   // exactly the cap
});

check('two concurrent uploads never credit more than the cap together', () => {
  // The counter $inc is atomic, so each upload sees its own post-increment total.
  const a = creditFromCounter(400, 400);  // first:  0 -> 400
  const b = creditFromCounter(400, 800);  // second: 400 -> 800
  assert.strictEqual(a + b, 600);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
