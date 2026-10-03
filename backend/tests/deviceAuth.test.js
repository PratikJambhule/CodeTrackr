/**
 * Tests for services/deviceAuth.js — device-code sign-in helpers (roadmap item 13).
 * Run: node tests/deviceAuth.test.js
 */
const assert = require('assert');
const { generateUserCode, normalizeUserCode, USER_CODE_ALPHABET, clientLabel } = require('../services/deviceAuth');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\ndeviceAuth');

check('a user code looks like ABCD-EFGH', () => {
  for (let i = 0; i < 200; i++) assert.match(generateUserCode(), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

check('codes avoid look-alike characters (0/O, 1/I/L)', () => {
  for (const ch of '01OIL') assert.ok(!USER_CODE_ALPHABET.includes(ch), `alphabet contains ${ch}`);
  assert.strictEqual(USER_CODE_ALPHABET.length, 31);
});

check('codes do not repeat in practice', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(generateUserCode());
  assert.strictEqual(seen.size, 5000);
});

check('typed codes are normalised: case, spaces, missing dash', () => {
  assert.strictEqual(normalizeUserCode(' wxyz2345 '), 'WXYZ-2345');
  assert.strictEqual(normalizeUserCode('wxyz-2345'), 'WXYZ-2345');
  assert.strictEqual(normalizeUserCode('WX YZ 23 45'), 'WXYZ-2345');
});

check('anything that cannot be a code normalises to null', () => {
  assert.strictEqual(normalizeUserCode('WXYZ-234'), null);
  assert.strictEqual(normalizeUserCode('WXYZ-2340'), null); // 0 is not in the alphabet
  assert.strictEqual(normalizeUserCode({ $ne: null }), null);
  assert.strictEqual(normalizeUserCode(undefined), null);
});

check('the device label is short, printable and never empty', () => {
  assert.strictEqual(clientLabel('VS Code (win32)'), 'VS Code (win32)');
  assert.strictEqual(clientLabel(''), 'VS Code');
  assert.strictEqual(clientLabel('x'.repeat(200)).length, 60);
  assert.strictEqual(clientLabel('bad\u0000name<script>'), 'badnamescript');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
