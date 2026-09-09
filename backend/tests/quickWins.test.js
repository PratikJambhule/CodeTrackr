const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const appSrc = read('app.js');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\nquick-wins: JWT_SECRET fail-fast (#7)');
check('app.js throws if JWT_SECRET is unset', () => {
  assert.ok(/if\s*\(\s*!process\.env\.JWT_SECRET\s*\)\s*\{?\s*throw/.test(appSrc),
    'expected a `if (!process.env.JWT_SECRET) throw ...` guard in app.js');
});
check('no hardcoded JWT fallback remains in backend source', () => {
  const files = ['middleware/auth.js', 'routes/auth.js'];
  for (const f of files) {
    assert.ok(!/your_jwt_secret/.test(read(f)), `${f} still contains 'your_jwt_secret'`);
  }
});

console.log('\nquick-wins: 409 on duplicate group join (#6)');
const groupsSrc = read('routes/groups.js');
check('the join handler maps 11000 to a 409', () => {
  assert.ok(/error\.code\s*===\s*11000/.test(groupsSrc), 'no 11000 check in groups.js');
  const idx = groupsSrc.indexOf('11000');
  const around = groupsSrc.slice(idx - 200, idx + 200);
  assert.ok(/status\(409\)/.test(around), 'no 409 next to the 11000 check');
});
check('the join catch no longer leaks error.message', () => {
  const joinStart = groupsSrc.indexOf("router.post('/:groupId/join'");
  const joinEnd = groupsSrc.indexOf('router.post', joinStart + 10);
  const joinHandler = groupsSrc.slice(joinStart, joinEnd);
  assert.ok(!/error:\s*error\.message/.test(joinHandler), 'join handler still echoes error.message');
});

console.log('\nquick-wins: /health readiness (#11)');
check('app.js exposes GET /health gated on mongoose readyState', () => {
  assert.ok(/app\.get\(\s*['"]\/health['"]/.test(appSrc), 'no GET /health route');
  assert.ok(/mongoose\.connection\.readyState/.test(appSrc), '/health does not check readyState');
  assert.ok(/503/.test(appSrc), '/health never returns 503');
});

console.log('\nquick-wins: helmet + rate-limit (#3)');
check('app.js requires and uses helmet', () => {
  assert.ok(/require\(['"]helmet['"]\)/.test(appSrc), 'helmet not required');
  assert.ok(/app\.use\(\s*helmet\(/.test(appSrc), 'helmet() not used');
});
check('app.js rate-limits /auth and /api/extension', () => {
  assert.ok(/require\(['"]express-rate-limit['"]\)/.test(appSrc), 'express-rate-limit not required');
  assert.ok(/app\.use\(\s*['"]\/auth['"]\s*,\s*rateLimit\(/.test(appSrc), 'no limiter on /auth');
  assert.ok(/app\.use\(\s*['"]\/api\/extension['"]\s*,\s*rateLimit\(/.test(appSrc), 'no limiter on /api/extension');
});
check('rate-limit is skipped under NODE_ENV=test', () => {
  assert.ok(/NODE_ENV\s*===\s*['"]test['"]/.test(appSrc), 'no test-env skip on the limiter');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
