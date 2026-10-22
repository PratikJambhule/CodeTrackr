/**
 * Tests for services/commandKinds.js — the server mirror of the extension's command
 * classifier, used to reduce any command text an older extension sends to a kind
 * (plan E1/B5). The case table is shared with extension/tests/commandKinds.test.js.
 * Run: node tests/commandKinds.test.js
 */
const assert = require('assert');
const path = require('path');
const { commandKind, isIgnoredCommand, toKind, kindFailures, normalizeKindCounts, COMMAND_KINDS } = require('../services/commandKinds');

const { cases } = require(path.join(__dirname, '..', '..', 'extension', 'tests', 'fixtures', 'commandKinds.json'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\ncommandKinds');

check(`agrees with the extension on every case in the shared table (${cases.length})`, () => {
  const wrong = [];
  for (const [cmd, want] of cases) {
    const got = isIgnoredCommand(cmd) ? 'ignored' : commandKind(cmd);
    if (got !== want) wrong.push(`"${cmd}": got ${got}, want ${want}`);
  }
  assert.deepStrictEqual(wrong, []);
});

check('same eight kinds as the extension', () => {
  assert.deepStrictEqual(COMMAND_KINDS, ['install', 'run', 'compile', 'build', 'test', 'git', 'docker', 'other']);
});

check('toKind: text from extension 2.5.0 becomes a kind', () => {
  assert.strictEqual(toKind('g++ two_sum.cpp'), 'compile');
  assert.strictEqual(toKind('npm run build'), 'build');
  assert.strictEqual(toKind('curl https://api.site.com/x?token=***'), 'other');
});

check('toKind: a kind from extension 2.6.0 is kept as it is', () => {
  for (const k of COMMAND_KINDS) assert.strictEqual(toKind(k), k);
});

check('toKind: nothing, placeholders and housekeeping give null (nothing stored)', () => {
  for (const v of [undefined, null, '', '   ', 'unknown', 'cd src', 42, { $gt: '' }]) assert.strictEqual(toKind(v), null, String(v));
});

check('kindFailures: text entries become kinds, merged and sorted, top 5', () => {
  const out = kindFailures([
    { command: 'g++ a.cpp', count: 2 }, { command: 'g++ b.cpp', count: 3 }, { command: 'npm test', count: 2 },
    { command: 'cd src', count: 9 }, { command: '', count: 4 }, { command: 'compile', count: 1 }, null, 'x',
  ]);
  assert.deepStrictEqual(out, [{ command: 'compile', count: 6 }, { command: 'test', count: 2 }]);
});

check('kindFailures: not an array, or garbage counts, give an empty list', () => {
  assert.deepStrictEqual(kindFailures(undefined), []);
  assert.deepStrictEqual(kindFailures({ command: 'npm test' }), []);
  assert.deepStrictEqual(kindFailures([{ command: 'npm test', count: -3 }]), []);
});

check('normalizeKindCounts: eight kinds + failed, whole non-negative numbers, unknown keys dropped', () => {
  const k = normalizeKindCounts({ compile: 3, run: '2', test: -1, hacker: 99, failed: { compile: 2.7, other: 'x', evil: 5 } });
  assert.deepStrictEqual(Object.keys(k), [...COMMAND_KINDS, 'failed']);
  assert.strictEqual(k.compile, 3);
  assert.strictEqual(k.run, 2);
  assert.strictEqual(k.test, 0);
  assert.strictEqual(k.hacker, undefined);
  assert.strictEqual(k.failed.compile, 3);
  assert.strictEqual(k.failed.other, 0);
  assert.strictEqual(k.failed.evil, undefined);
});

check('normalizeKindCounts: an old payload without kinds gives all zeros', () => {
  const k = normalizeKindCounts(undefined);
  for (const key of COMMAND_KINDS) { assert.strictEqual(k[key], 0); assert.strictEqual(k.failed[key], 0); }
});

check('normalizeKindCounts: an absurd count is capped', () => {
  assert.strictEqual(normalizeKindCounts({ run: 1e12 }).run, 10000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
