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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
