/**
 * Tests for services/boardWindow.js — the ?from=&to= contest window on group
 * boards (roadmap item 7). Run: node tests/boardWindow.test.js
 */
const assert = require('assert');
const { parseBoardWindow, MAX_WINDOW_DAYS } = require('../services/boardWindow');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const NOW = new Date('2026-10-03T12:00:00Z');

console.log('\nboardWindow');

check('no parameters means all-time', () => {
  assert.deepStrictEqual(parseBoardWindow({}, NOW), { ok: true, from: null, to: null });
});

check('a contest week is accepted', () => {
  const r = parseBoardWindow({ from: '2026-09-28T00:00:00Z', to: '2026-10-05T00:00:00Z' }, NOW);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.to.toISOString(), '2026-10-05T00:00:00.000Z');
});

check('from is floored to the 10-minute bucket grid (M-31)', () => {
  const r = parseBoardWindow({ from: '2026-09-28T09:07:00Z' }, NOW);
  assert.strictEqual(r.from.toISOString(), '2026-09-28T09:00:00.000Z');
});

check('only from: the window runs to now', () => {
  const r = parseBoardWindow({ from: '2026-10-01T00:00:00Z' }, NOW);
  assert.strictEqual(r.to.getTime(), NOW.getTime());
});

check('only to: rejected (a window needs a start)', () => {
  assert.strictEqual(parseBoardWindow({ to: '2026-10-01T00:00:00Z' }, NOW).ok, false);
});

check('garbage dates are rejected', () => {
  assert.strictEqual(parseBoardWindow({ from: 'yesterday' }, NOW).ok, false);
  assert.strictEqual(parseBoardWindow({ from: { $gt: '' } }, NOW).ok, false);
});

check('to before from is rejected', () => {
  assert.strictEqual(parseBoardWindow({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }, NOW).ok, false);
});

check(`a window longer than ${MAX_WINDOW_DAYS} days is rejected`, () => {
  assert.strictEqual(parseBoardWindow({ from: '2024-01-01T00:00:00Z' }, NOW).ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
