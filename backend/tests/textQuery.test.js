const assert = require('assert');
const { escapeRegex, containsRegex, exactRegex, MAX_TERM_LENGTH } = require('../services/textQuery');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

(async () => {
  console.log('\ntextQuery — escapeRegex');

  await check('neutralises every metacharacter', async () => {
    const escaped = escapeRegex('.*+?^${}()|[]\\');
    // Each metacharacter must be backslash-prefixed, so a literal match works.
    assert.ok(new RegExp(escaped).test('.*+?^${}()|[]\\'));
  });

  await check('leaves ordinary text alone', async () => {
    assert.strictEqual(escapeRegex('react hooks'), 'react hooks');
  });

  await check('null and undefined become the empty string', async () => {
    assert.strictEqual(escapeRegex(null), '');
    assert.strictEqual(escapeRegex(undefined), '');
  });

  await check('coerces non-strings rather than throwing', async () => {
    assert.strictEqual(escapeRegex(42), '42');
  });

  console.log('\ntextQuery — containsRegex');

  await check('matches a literal substring, case-insensitively', async () => {
    const re = containsRegex('Study');
    assert.ok(re.test('daily study group'));
  });

  await check('a wildcard search matches literally, not as a pattern', async () => {
    // The bug: `$regex: '.*'` matched every group in the database.
    const re = containsRegex('.*');
    assert.ok(re.test('a .* b'), 'should match the literal characters');
    assert.strictEqual(re.test('anything else'), false, 'must not behave as a wildcard');
  });

  await check('a catastrophic-backtracking pattern is defused', async () => {
    // `(a+)+$` against a long non-matching string is the classic ReDoS. Escaped,
    // it is just literal text and returns immediately.
    const re = containsRegex('(a+)+$');
    const started = Date.now();
    const hit = re.test('a'.repeat(4000) + 'b');
    assert.strictEqual(hit, false);
    assert.ok(Date.now() - started < 500, 'escaped pattern should not backtrack');
  });

  await check('empty, blank and null terms yield null so the clause is omitted', async () => {
    assert.strictEqual(containsRegex(''), null);
    assert.strictEqual(containsRegex('   '), null);
    assert.strictEqual(containsRegex(null), null);
    assert.strictEqual(containsRegex(undefined), null);
  });

  await check('trims surrounding whitespace', async () => {
    assert.ok(containsRegex('  study  ').test('STUDY'));
  });

  await check('truncates an over-long term', async () => {
    const re = containsRegex('x'.repeat(MAX_TERM_LENGTH + 50));
    assert.ok(re.source.length <= MAX_TERM_LENGTH, 'term should be capped');
  });

  console.log('\ntextQuery — exactRegex');

  await check('anchors both ends', async () => {
    const re = exactRegex('react');
    assert.ok(re.test('React'), 'should be case-insensitive');
    assert.strictEqual(re.test('react-native'), false, 'must not match a prefix');
    assert.strictEqual(re.test('prefer-react'), false, 'must not match a suffix');
  });

  await check('a metacharacter term stays literal', async () => {
    const re = exactRegex('c++');
    assert.ok(re.test('C++'));
    assert.strictEqual(re.test('c'), false);
  });

  await check('empty and null terms yield null', async () => {
    assert.strictEqual(exactRegex(''), null);
    assert.strictEqual(exactRegex(null), null);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
