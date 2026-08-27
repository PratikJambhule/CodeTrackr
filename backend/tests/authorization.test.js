const assert = require('assert');
const { sameUser, assertOwnership, isBypassAllowed } = require('../services/authorization');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\nsameUser');
check('matches ObjectId-like values across string and object forms', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.strictEqual(sameUser(id, { toString: () => id }), true);
});
check('rejects different ids', () => {
  assert.strictEqual(sameUser('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'), false);
});
check('is false for null or undefined rather than throwing', () => {
  assert.strictEqual(sameUser(null, 'a'), false);
  assert.strictEqual(sameUser(undefined, undefined), false);
});

console.log('\nassertOwnership');
check('allows a user to read their own data', () => {
  const r = assertOwnership('abc', 'abc');
  assert.strictEqual(r.ok, true);
});
check('refuses another user with 403, not 404', () => {
  const r = assertOwnership('abc', 'xyz');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 403);
});
check('treats a missing requested id as "my own data"', () => {
  assert.strictEqual(assertOwnership(undefined, 'abc').ok, true);
  assert.strictEqual(assertOwnership('', 'abc').ok, true);
});
check('refuses when there is no session user', () => {
  const r = assertOwnership('abc', null);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 401);
});

console.log('\nisBypassAllowed');
check('never allows bypass in production', () => {
  assert.strictEqual(isBypassAllowed({ AUTH_BYPASS: 'true', NODE_ENV: 'production' }), false);
});
check('allows bypass in development when explicitly set', () => {
  assert.strictEqual(isBypassAllowed({ AUTH_BYPASS: 'true', NODE_ENV: 'development' }), true);
});
check('is off by default', () => {
  assert.strictEqual(isBypassAllowed({}), false);
  assert.strictEqual(isBypassAllowed({ AUTH_BYPASS: 'false' }), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
