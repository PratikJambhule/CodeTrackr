/**
 * Tests for services/apiKeys.js — hashed, revocable API keys.
 * Run: node tests/apiKeys.test.js
 */
const assert = require('assert');
const keys = require('../services/apiKeys');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\napiKeys');

check('a new key has the ct_<id>_<secret> shape', () => {
  const k = keys.generateKey();
  assert.match(k.token, /^ct_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(k.token, `ct_${k.id}_${k.secret}`);
  assert.strictEqual(k.last4, k.secret.slice(-4));
});

check('the stored hash is not the secret and is deterministic', () => {
  const k = keys.generateKey();
  assert.notStrictEqual(k.hash, k.secret);
  assert.ok(!k.hash.includes(k.secret));
  assert.strictEqual(keys.hashSecret(k.secret), k.hash);
});

check('two keys never collide', () => {
  const a = keys.generateKey();
  const b = keys.generateKey();
  assert.notStrictEqual(a.id, b.id);
  assert.notStrictEqual(a.secret, b.secret);
});

check('parseKey splits a new-format key', () => {
  const k = keys.generateKey();
  assert.deepStrictEqual(keys.parseKey(k.token), { id: k.id, secret: k.secret });
});

check('parseKey returns null for a legacy 64-hex key and for junk', () => {
  assert.strictEqual(keys.parseKey('a'.repeat(64)), null);
  assert.strictEqual(keys.parseKey(''), null);
  assert.strictEqual(keys.parseKey(undefined), null);
  assert.strictEqual(keys.parseKey('ct__x'), null);
  assert.strictEqual(keys.parseKey('ct_zz_' + 'a'.repeat(43)), null);
});

check('verifySecret accepts the right secret only', () => {
  const k = keys.generateKey();
  assert.strictEqual(keys.verifySecret(k.secret, k.hash), true);
  assert.strictEqual(keys.verifySecret(k.secret + 'x', k.hash), false);
  assert.strictEqual(keys.verifySecret('', k.hash), false);
  assert.strictEqual(keys.verifySecret(k.secret, undefined), false);
});

check('hint shows the id and the last 4 characters only', () => {
  const k = keys.generateKey();
  const hint = keys.hint(k.id, k.last4);
  assert.strictEqual(hint, `ct_${k.id}_…${k.last4}`);
  assert.ok(!hint.includes(k.secret));
});

check('legacy keys are looked up by their hash, never stored plain', () => {
  const legacy = 'f'.repeat(64);
  assert.strictEqual(keys.hashSecret(legacy).length, 64);
  assert.notStrictEqual(keys.hashSecret(legacy), legacy);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
