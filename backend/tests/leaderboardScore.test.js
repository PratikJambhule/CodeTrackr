const assert = require('assert');
const { score, maxOf } = require('../routes/leaderboard');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

(async () => {
  console.log('\nleaderboard — score');

  await check('scales linearly against the best value', async () => {
    assert.strictEqual(score(10, 20), '2.5');
    assert.strictEqual(score(20, 20), '5.0');
    assert.strictEqual(score(0, 20), '0.0');
  });

  await check('clamps a negative value to zero', async () => {
    // `impact` fed netCodeChanges here, which goes negative on a net-deletion
    // window. The old Math.min(5, x) let it through and dragged `overall` under
    // zero, so a refactor showed as negative impact.
    assert.strictEqual(score(-500, 1000), '0.0');
  });

  await check('clamps above the maximum', async () => {
    assert.strictEqual(score(50, 20), '5.0');
  });

  await check('a zero or negative divisor yields 0.0, never NaN or Infinity', async () => {
    assert.strictEqual(score(5, 0), '0.0');
    assert.strictEqual(score(5, -1), '0.0');
  });

  await check('non-finite inputs yield 0.0', async () => {
    assert.strictEqual(score(NaN, 10), '0.0');
    // Infinity is not finite, so it is rejected by the guard rather than
    // clamped to the top of the range -- an infinite total is corrupt data,
    // not a perfect score.
    assert.strictEqual(score(Infinity, 10), '0.0');
    assert.strictEqual(score(10, NaN), '0.0');
    assert.strictEqual(score(undefined, 10), '0.0');
  });

  await check('always returns one decimal place as a string', async () => {
    for (const [v, b] of [[1, 3], [7, 9], [0, 1], [100, 3]]) {
      assert.match(score(v, b), /^\d\.\d$/, `bad shape for ${v}/${b}`);
    }
  });

  console.log('\nleaderboard — maxOf');

  await check('finds the largest value', async () => {
    const rows = [{ n: 3 }, { n: 17 }, { n: 9 }];
    assert.strictEqual(maxOf(rows, r => r.n), 17);
  });

  await check('floors at 1 so it is always a safe divisor', async () => {
    assert.strictEqual(maxOf([{ n: 0 }, { n: 0 }], r => r.n), 1);
    assert.strictEqual(maxOf([], r => r.n), 1);
    assert.strictEqual(maxOf([{ n: -5 }], r => r.n), 1);
  });

  await check('ignores non-finite values instead of poisoning the max', async () => {
    const rows = [{ n: 4 }, { n: NaN }, { n: undefined }, { n: 6 }];
    assert.strictEqual(maxOf(rows, r => r.n), 6);
  });

  await check('survives an array far larger than the argument limit', async () => {
    // The bug: Math.max(...rows.map(...)) throws RangeError once the spread
    // exceeds the engine's argument cap, taking the whole endpoint down.
    const rows = new Array(200000).fill(null).map((_, i) => ({ n: i }));
    assert.strictEqual(maxOf(rows, r => r.n), 199999);
  });

  await check('the old spread approach really does throw at this size', async () => {
    // Documents why maxOf exists. If a future engine raises the cap this test
    // fails loudly rather than silently losing its point.
    const values = new Array(200000).fill(1);
    assert.throws(() => Math.max(...values), RangeError);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
