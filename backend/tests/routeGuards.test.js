/**
 * Static route-protection scan.
 *
 * Backend node_modules is not installed, so this reads route source directly
 * rather than booting Express. It fails if a sensitive route ever loses its
 * auth middleware — the H-1 regression guard.
 *
 * Limitation: this proves the middleware is declared, not that it behaves
 * correctly at runtime. A live smoke test is still worthwhile.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'routes');
const read = (f) => fs.readFileSync(path.join(ROUTES, f), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

/** Remove // and /* *\/ comments so a scan can't match prose about old code. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every router.<verb>('path', ...) declaration in a file. */
function routeDeclarations(src) {
  const out = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*(['"`])(.*?)\2\s*,([^\n]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ method: m[1], routePath: m[3], rest: m[4] });
  }
  return out;
}

console.log('\nanalytics routes');
const analytics = read('analytics.js');
check('every analytics route requires authentication', () => {
  const unguarded = routeDeclarations(analytics)
    .filter((r) => !/isAuthenticated/.test(r.rest))
    .map((r) => `${r.method.toUpperCase()} ${r.routePath}`);
  assert.deepStrictEqual(unguarded, [], `unguarded: ${unguarded.join(', ')}`);
});

check('every analytics route enforces ownership', () => {
  const count = (analytics.match(/resolveOwnedUserId/g) || []).length;
  const routes = routeDeclarations(analytics).length;
  // one helper definition + one call per route
  assert.ok(count >= routes, `${routes} routes but only ${count} ownership references`);
});

console.log('\nleaderboard route');
check('leaderboard requires authentication', () => {
  const unguarded = routeDeclarations(read('leaderboard.js'))
    .filter((r) => !/isAuthenticated/.test(r.rest));
  assert.strictEqual(unguarded.length, 0, 'leaderboard is public');
});

console.log('\nmetrics route');
check('metrics route takes no user id from the request', () => {
  const src = read('metrics.js');
  assert.ok(!/req\.params/.test(src), 'metrics route reads req.params');
  assert.ok(/isAuthenticated/.test(src), 'metrics route is unguarded');
});

console.log('\ngoals and teams');
check('every goals route requires authentication', () => {
  const unguarded = routeDeclarations(read('goals.js'))
    .filter((r) => !/isAuthenticated/.test(r.rest))
    .map((r) => `${r.method.toUpperCase()} ${r.routePath}`);
  assert.deepStrictEqual(unguarded, [], `unguarded: ${unguarded.join(', ')}`);
});
check('goal progress scopes the lookup to the session user', () => {
  const src = read('goals.js');
  assert.ok(
    /Goal\.findOne\(\s*\{[^}]*userId/s.test(src),
    'goal progress must look up by { _id, userId }, not findById'
  );
});
check('every goals route that mutates a goal is owner-scoped', () => {
  const src = read('goals.js');
  // Each PATCH handler must resolve the goal through an owner-scoped findOne
  // before writing; findById would let anyone complete anyone else's goal.
  const patches = routeDeclarations(src).filter((r) => r.method === 'patch');
  assert.ok(patches.length >= 2, 'expected the complete/reopen transitions to exist');
  assert.ok(!/Goal\.findById\(/.test(src), 'goals.js must not use findById');
});
check('goal activity is matched within the goal lifetime, not all history', () => {
  // Strip comments first: these files document the defects they fixed, and a
  // naive scan would match the description of the old code.
  const src = stripComments(read('goals.js'));
  // Regression: `{ language: goal.techStack, timestamp: { $lte: deadline } }`
  // had no lower bound, so a goal was scored against every hour ever logged.
  assert.ok(/\$gte:\s*from/.test(src), 'goal activity query needs a lower time bound');
  assert.ok(!/language:\s*goal\.techStack/.test(src), 'exact free-text language match removed');
});
check('single-team read checks membership', () => {
  const src = read('team.js');
  assert.ok(/isMember|sameUser/.test(src), 'GET /:teamId does not check membership');
});

console.log('\ngroup passwords');
check('no plaintext password comparison remains', () => {
  const src = read('groups.js');
  assert.ok(!/password\s*!==\s*group\.password/.test(src), 'plaintext comparison still present');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
