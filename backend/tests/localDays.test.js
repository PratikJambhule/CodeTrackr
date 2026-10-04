'use strict';

// Local-day helpers behind the redesign's history view and group day cells
// (services/historyView.js, services/groupDaily.js). Pure: no database.
const assert = require('assert');
const { localMidnightUtc, clampOffset } = require('../services/historyView');
const { localDates, MAX_DAYS } = require('../services/groupDaily');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const IST = -330; // Date.getTimezoneOffset() in India

test('local midnight in India is 18:30 UTC the day before', () => {
  // 01:30 IST on 4 Oct = 20:00 UTC on 3 Oct.
  const m = localMidnightUtc(Date.UTC(2026, 9, 3, 20, 0), IST);
  assert.strictEqual(m.toISOString(), '2026-10-03T18:30:00.000Z');
});

test('local midnight west of UTC (New York, UTC-4 in October)', () => {
  const m = localMidnightUtc(Date.UTC(2026, 9, 4, 2, 0), 240); // 22:00 on 3 Oct in New York
  assert.strictEqual(m.toISOString(), '2026-10-03T04:00:00.000Z');
});

test('offsets outside real time zones are treated as UTC', () => {
  assert.strictEqual(clampOffset(-330), -330);
  assert.strictEqual(clampOffset(99999), 0);
  assert.strictEqual(clampOffset('nope'), 0);
  assert.strictEqual(localMidnightUtc(Date.UTC(2026, 9, 3, 20, 0), 99999).toISOString(), '2026-10-03T00:00:00.000Z');
});

test('a contest week gives one local date per day, end exclusive', () => {
  const from = new Date(Date.UTC(2026, 8, 27, 18, 30)); // Mon 28 Sep 00:00 IST
  const to = new Date(Date.UTC(2026, 9, 4, 18, 30));    // Mon 5 Oct 00:00 IST
  const dates = localDates(from, to, IST);
  assert.deepStrictEqual(dates, ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
});

test('a window that starts mid-day still includes that day', () => {
  const from = new Date(Date.UTC(2026, 9, 1, 6, 0)); // 11:30 IST on 1 Oct
  const to = new Date(Date.UTC(2026, 9, 2, 6, 0));   // 11:30 IST on 2 Oct
  assert.deepStrictEqual(localDates(from, to, IST), ['2026-10-01', '2026-10-02']);
});

test(`windows longer than ${MAX_DAYS} days get no day cells`, () => {
  const from = new Date(Date.UTC(2026, 0, 1));
  const to = new Date(from.getTime() + (MAX_DAYS + 5) * 864e5);
  assert.strictEqual(localDates(from, to, 0), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
