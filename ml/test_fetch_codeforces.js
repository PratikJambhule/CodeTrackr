/**
 * Tests for ml/fetch_codeforces.js rowsFor(): features come only from before the contest, the label
 * only from the 28 days after it.  Run: node ml/test_fetch_codeforces.js
 */
const assert = require('assert');
const { rowsFor, HORIZON: WINDOW, MIN_CONTESTS } = require('./fetch_codeforces');

const DAY = 86400;
const T0 = 1_700_000_000;
// 8 contests a week apart; rating climbs by 20 each time.
const rating = Array.from({ length: 8 }, (_, i) => ({ contestId: i, t: T0 + i * 7 * DAY, oldRating: 1200 + i * 20, newRating: 1220 + i * 20 }));
const sub = (t, ok, key, r, tags) => ({ t, ok, key, rating: r, tags });
const at = rating[MIN_CONTESTS - 1].t; // the first contest that makes a row
const subs = [
  sub(at - 2 * DAY, true, '1A', 1300, ['dp']),
  sub(at - 2 * DAY, true, '1A', 1300, ['dp']),        // same problem again: counted once
  sub(at - 3 * DAY, false, '1B', 1500, ['graphs']),
  sub(at - 40 * DAY, true, '1C', 900, ['math']),     // the 4 weeks before the window
  sub(at + 1 * DAY, true, '1D', 2000, ['dp']),       // AFTER the contest: must not count
];

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  PASS  ${name}`); };

const rows = rowsFor({ handle: 'x', rating, subs });
const first = rows[0];

check('rows start after the provisional contests and need a contest in the next 28 days', () => {
  assert.strictEqual(first.contests_so_far, MIN_CONTESTS);
  assert.strictEqual(rows.length, rating.length - MIN_CONTESTS); // the last contest has no future
});

check('features use only the 28 days before the contest (nothing after it leaks in)', () => {
  assert.strictEqual(first.subs_28d, 3);
  assert.strictEqual(first.solved_28d, 1);
  assert.strictEqual(first.solved_prev_28d, 1);
  assert.strictEqual(first.solved_rating_max, 1300);
  assert.strictEqual(first.tag_dp, 1);
  assert.ok(Math.abs(first.fail_ratio_28d - 1 / 3) < 1e-9);
});

check('label = rating at the last contest within 28 days minus the current rating', () => {
  const inWindow = rating.filter((r) => r.t > at && r.t <= at + WINDOW);
  assert.strictEqual(first.y_delta, inWindow[inWindow.length - 1].newRating - rating[MIN_CONTESTS - 1].newRating);
  assert.strictEqual(first.future_contests, inWindow.length);
});

console.log(`\n${passed} passed, 0 failed`);
