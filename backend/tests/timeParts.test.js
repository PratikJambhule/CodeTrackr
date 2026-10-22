/**
 * Tests for services/timeParts.js — payload v3 time parts on the server (plan B1–B3):
 * validation, splitting credited time across windows, and the bucket update.
 * Run: node tests/timeParts.test.js
 */
const assert = require('assert');
const { validateTimeParts, splitParts, timeInc, encodeFileKey, decodeFileKey, MAX_FILES } = require('../services/timeParts');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}
const file = (name, writing, reading = 0, running = 0, extra = {}) =>
  ({ name, language: 'cpp', seconds: writing + reading + running, writing, reading, running, linesInserted: 0, linesDeleted: 0, ...extra });
const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);

console.log('\ntimeParts');

check('an extension 2.5.0 upload has no parts and is valid', () => {
  assert.deepStrictEqual(validateTimeParts({ duration: 120 }, 120), { errors: [], value: { kinds: null, files: null } });
});

check('a correct v3 upload is accepted, files merged by name, biggest first', () => {
  const r = validateTimeParts({ writingSec: 100, readingSec: 50, runningSec: 0,
    perFile: [file('a.js', 50), file('t.js', 50, 30), file('t.js', 0, 20)] }, 150);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.value.kinds, { writingSec: 100, readingSec: 50, runningSec: 0 });
  assert.deepStrictEqual(r.value.files.map((f) => [f.name, f.seconds, f.writing, f.reading]), [['t.js', 100, 50, 50], ['a.js', 50, 50, 0]]);
});

check('kinds that do not add up to the duration are refused', () => {
  const r = validateTimeParts({ writingSec: 100, readingSec: 50, runningSec: 0 }, 300);
  assert.ok(r.errors.some((e) => /add up/.test(e)), r.errors.join());
});

check('a small rounding difference (up to 2 s) is allowed', () => {
  assert.deepStrictEqual(validateTimeParts({ writingSec: 61, readingSec: 60, runningSec: 0 }, 120).errors, []);
});

check('more than 30 files, a path instead of a name, or bad numbers are refused', () => {
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => file(`f${i}.js`, 1));
  assert.ok(validateTimeParts({ perFile: many }, MAX_FILES + 1).errors.length);
  assert.ok(validateTimeParts({ perFile: [file('src/a.js', 10)] }, 10).errors.some((e) => /base name/.test(e)));
  assert.ok(validateTimeParts({ perFile: [file('C:\\x\\a.js', 10)] }, 10).errors.length);
  assert.ok(validateTimeParts({ perFile: [{ ...file('a.js', 10), writing: -5 }] }, 10).errors.length);
  assert.ok(validateTimeParts({ perFile: [{ ...file('a.js', 10), seconds: 99 }] }, 10).errors.length, 'seconds must equal its parts');
  assert.ok(validateTimeParts({ perFile: 'nope' }, 10).errors.length);
  assert.ok(validateTimeParts({ writingSec: 'x', readingSec: 0, runningSec: 0 }, 10).errors.length);
});

check('per-file seconds that do not add up to the duration are refused', () => {
  assert.ok(validateTimeParts({ perFile: [file('a.js', 10)] }, 100).errors.some((e) => /add up/.test(e)));
});

check('splitParts: fully credited in one window keeps the parts as they came', () => {
  const parts = { kinds: { writingSec: 100, readingSec: 50, runningSec: 0 }, files: [file('a.js', 50), file('t.js', 50, 50)] };
  const [w] = splitParts(parts, [150]);
  assert.deepStrictEqual(w.kinds, { writingSec: 100, readingSec: 50, runningSec: 0 });
  assert.deepStrictEqual(w.files.map((f) => [f.name, f.seconds, f.writing, f.reading]), [['a.js', 50, 50, 0], ['t.js', 100, 50, 50]]);
});

check('splitParts: credited less than claimed scales every part down, and the parts still add up', () => {
  const parts = { kinds: { writingSec: 100, readingSec: 50, runningSec: 0 }, files: [file('a.js', 50), file('t.js', 50, 50)] };
  const [w] = splitParts(parts, [75]);
  assert.strictEqual(sum(w.files, 'seconds'), 75);
  assert.strictEqual(w.kinds.writingSec + w.kinds.readingSec + w.kinds.runningSec, 75);
  assert.strictEqual(w.kinds.writingSec, 50);
  assert.strictEqual(w.kinds.readingSec, 25);
  for (const f of w.files) assert.strictEqual(f.writing + f.reading + f.running, f.seconds);
});

check('splitParts: an upload spread over windows splits its parts; every window adds up to its credit', () => {
  const parts = { kinds: { writingSec: 300, readingSec: 200, runningSec: 100 }, files: [file('a.js', 300, 100), file('b.js', 0, 100, 100)] };
  const windows = splitParts(parts, [250, 0, 337]);
  assert.strictEqual(windows.length, 3);
  windows.forEach((w, i) => {
    const credit = [250, 0, 337][i];
    assert.strictEqual(sum(w.files, 'seconds'), credit, `window ${i}`);
    assert.strictEqual(w.kinds.writingSec + w.kinds.readingSec + w.kinds.runningSec, credit);
  });
  assert.deepStrictEqual(windows[1], { kinds: { writingSec: 0, readingSec: 0, runningSec: 0 }, files: [] });
});

check('splitParts: lines and "edited" stay with the first window (they are not time)', () => {
  const parts = { kinds: null, files: [file('a.js', 100, 0, 0, { linesInserted: 12, edited: true })] };
  const [w0, w1] = splitParts(parts, [60, 40]);
  assert.strictEqual(w0.files[0].linesInserted, 12);
  assert.strictEqual(w1.files[0].linesInserted, 0);
});

check('splitParts: an old upload (no parts) gives no parts', () => {
  assert.deepStrictEqual(splitParts({ kinds: null, files: null }, [100, 20]), [{ kinds: null, files: null }, { kinds: null, files: null }]);
});

check('file keys: dots, dollars and percent survive a round trip and are safe as field names', () => {
  for (const name of ['two_sum.cpp', '$weird.%name.js', '.env', 'a..b']) {
    const k = encodeFileKey(name);
    assert.ok(!k.includes('.') && !k.startsWith('$'), k);
    assert.strictEqual(decodeFileKey(k), name);
  }
});

check('timeInc: the bucket update adds kinds and per-file time', () => {
  const u = timeInc({ kinds: { writingSec: 50, readingSec: 25, runningSec: 0 }, files: [file('two_sum.cpp', 50, 25, 0, { linesInserted: 3 })] });
  assert.strictEqual(u.$inc.writingSec, 50);
  assert.strictEqual(u.$inc.readingSec, 25);
  assert.ok(!('runningSec' in u.$inc), 'zeros are left out');
  assert.strictEqual(u.$inc['fileTime.two_sum%2Ecpp.seconds'], 75);
  assert.strictEqual(u.$inc['fileTime.two_sum%2Ecpp.linesInserted'], 3);
  assert.strictEqual(u.$set['fileTime.two_sum%2Ecpp.language'], 'cpp');
  assert.deepStrictEqual(u.files, ['two_sum.cpp']);
});

check('timeInc: nothing to add gives an empty update', () => {
  assert.deepStrictEqual(timeInc({ kinds: null, files: null }), { $inc: {}, $set: {}, files: [] });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
