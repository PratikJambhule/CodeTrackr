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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
