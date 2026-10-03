/**
 * Tests for services/rateLimitKeys.js — rate limits keyed by user or session
 * instead of IP (H-20, and required once the website proxies through Vercel,
 * which hides visitors' IPs). Run: node tests/rateLimitKeys.test.js
 */
const assert = require('assert');
const { userKey, sessionKey } = require('../services/rateLimitKeys');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const campusIp = '203.0.113.7';

console.log('\nrateLimitKeys');

check('two signed-in users on one campus IP get separate join limits', () => {
  const a = userKey({ user: { _id: 'user-a' }, ip: campusIp });
  const b = userKey({ user: { _id: 'user-b' }, ip: campusIp });
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, 'user:user-a');
});

check('without a user, the join key falls back to the IP', () => {
  assert.match(userKey({ ip: campusIp }), /^ip:/);
});

check('two sessions on one IP get separate analytics limits', () => {
  const a = sessionKey({ cookies: { token: 'jwt-one' }, ip: campusIp });
  const b = sessionKey({ cookies: { token: 'jwt-two' }, ip: campusIp });
  assert.notStrictEqual(a, b);
  assert.match(a, /^sess:[0-9a-f]{32}$/);
});

check('the session key never contains the token itself', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.secret-payload.signature';
  assert.ok(!sessionKey({ cookies: { token }, ip: campusIp }).includes('secret-payload'));
});

check('no cookie: the analytics key falls back to the IP', () => {
  assert.match(sessionKey({ cookies: {}, ip: campusIp }), /^ip:/);
  assert.match(sessionKey({ ip: campusIp }), /^ip:/);
});

check('IPv6 addresses are grouped by /56 (express-rate-limit guidance), not per address', () => {
  const k1 = sessionKey({ ip: '2001:db8:abcd:12::1' });
  const k2 = sessionKey({ ip: '2001:db8:abcd:12::2' });
  assert.strictEqual(k1, k2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
