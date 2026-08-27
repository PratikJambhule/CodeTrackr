# Security Batch + Insights Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five open security holes in the deployed backend, and surface the five Phase A derived metrics as a user-facing Insights page.

**Architecture:** Authorization logic is extracted into a dependency-free `services/authorization.js` so it unit tests without Express or Mongoose. Group passwords move to Node's built-in `crypto.scrypt` — no new dependency, which matters because backend `node_modules` is not installed and the deploy target is Vercel serverless. Route protection is verified by a static source-scanning test that fails if a sensitive route ever loses its auth middleware. The frontend gains one new page consuming the existing `GET /api/metrics`.

**Tech Stack:** Node 18 + Express 5 + Mongoose 8 (backend), React 19 + Vite + TS + Tailwind + lucide-react (frontend), plain `node:assert` test scripts (no framework — matches existing tests).

**Spec:** `docs/IMPROVEMENT_PLAN.md` findings H-1, H-2, H-9, H-10, H-11; `docs/TRACKING_ROADMAP.md` Part 3 metrics 1, 4, 14, 16, 18.

## Global Constraints

- **The backend is deployed and live.** Every change must keep legitimate users working. Breaking changes to public endpoints need a compatibility path.
- **Backend `node_modules` is NOT installed.** All tests must be dependency-free: pure logic lives in `backend/services/*.js` and is tested directly; route protection is verified by static source scanning, never by booting Express.
- **No new backend dependencies.** Use `crypto.scrypt` for password hashing, not bcrypt.
- **Frontend `node_modules` is NOT installed.** Task 7 installs them to typecheck; if the install fails, the page still ships but must be recorded as typecheck-unverified.
- **Existing test commands must keep passing:** `npm test` in `backend/` (33 assertions) and `extension/` (32).
- **`Activity.userId` is a String** (hex of `User._id`), while `Goal.userId` and `GroupMember.userId` are ObjectIds. Compare with `.toString()` on both sides, always.
- **Privacy:** friction metrics (churn, comprehension load, context switches) are per-user only and must never appear on the leaderboard.
- Branch: `feat/security-and-insights`, cut from `feat/tracking-phase-a`.
- Every task ends with a commit. Session log updated in Task 8.

---

## File Structure

**Backend — create:**
- `backend/services/authorization.js` — ownership assertions, dependency-free
- `backend/services/passwordHash.js` — scrypt hash/verify, dependency-free
- `backend/tests/authorization.test.js`
- `backend/tests/passwordHash.test.js`
- `backend/tests/routeGuards.test.js` — static scan: sensitive routes must carry auth middleware

**Backend — modify:**
- `backend/middleware/auth.js` — refuse `AUTH_BYPASS` in production (H-10)
- `backend/app.js` — delete the two legacy unauthenticated endpoints (H-2)
- `backend/routes/analytics.js` — auth + ownership on all four routes (H-1)
- `backend/routes/leaderboard.js` — require auth (H-1)
- `backend/routes/goals.js` — ownership on goal progress (H-11)
- `backend/routes/team.js` — membership check (H-11)
- `backend/routes/groups.js` — hashed passwords, strip password from responses (H-9)
- `backend/models/Group.js` — password field documentation
- `backend/package.json` — run the new test files

**Frontend — create:**
- `frontend/src/pages/Insights.tsx` — the five-metric page

**Frontend — modify:**
- `frontend/src/App.tsx` — route + nav link
- `frontend/src/pages/Dashboard.tsx` — add `credentials: 'include'` to 3 fetches
- `frontend/src/pages/Leaderboard.tsx` — add `credentials: 'include'`
- `frontend/src/pages/Teams.tsx` — add `credentials: 'include'`

---

### Task 0: Branch

- [ ] **Step 1: Confirm clean tree on the previous branch**

Run: `git status --short && git branch --show-current`
Expected: no output from status; branch `feat/tracking-phase-a`.

- [ ] **Step 2: Cut the new branch**

```bash
git checkout -b feat/security-and-insights
git log --oneline -1
```

---

### Task 1: Ownership helper + AUTH_BYPASS hardening (H-10)

**Files:**
- Create: `backend/services/authorization.js`
- Create: `backend/tests/authorization.test.js`
- Modify: `backend/middleware/auth.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `sameUser(a, b) -> boolean` — null/undefined-safe string comparison of ids
  - `assertOwnership(requestedId, sessionUserId) -> { ok: true } | { ok: false, status: number, message: string }` — when `requestedId` is falsy the session user is used, so a route may omit the param entirely
  - `isBypassAllowed(env) -> boolean` — true only when `AUTH_BYPASS === 'true'` **and** `NODE_ENV !== 'production'`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/authorization.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node tests/authorization.test.js`
Expected: FAIL — `Cannot find module '../services/authorization'`

- [ ] **Step 3: Write the implementation**

Create `backend/services/authorization.js`:

```js
/**
 * Authorization helpers.
 *
 * Dependency-free (no express, no mongoose) so they unit test without
 * installing or booting the server.
 *
 * Activity.userId is a String while Goal/GroupMember userId are ObjectIds,
 * so every comparison normalises through toString().
 */

/** Null-safe identity comparison across String/ObjectId forms. */
function sameUser(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return String(a) === String(b);
}

/**
 * Decide whether the session user may read `requestedId`'s data.
 * A falsy requestedId means "my own data" — routes may drop the param.
 */
function assertOwnership(requestedId, sessionUserId) {
    if (!sessionUserId) {
        return { ok: false, status: 401, message: 'Unauthorized' };
    }
    if (!requestedId) {
        return { ok: true };
    }
    if (!sameUser(requestedId, sessionUserId)) {
        // 403 not 404: the caller is authenticated, just not entitled.
        return { ok: false, status: 403, message: 'You may only access your own data' };
    }
    return { ok: true };
}

/**
 * AUTH_BYPASS disables all authentication and attaches the most active real
 * user. That must never be reachable in production, whatever the env says.
 */
function isBypassAllowed(env = process.env) {
    return env.AUTH_BYPASS === 'true' && env.NODE_ENV !== 'production';
}

module.exports = { sameUser, assertOwnership, isBypassAllowed };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node tests/authorization.test.js`
Expected: `10 passed, 0 failed`

- [ ] **Step 5: Wire the bypass guard into the middleware**

In `backend/middleware/auth.js`, add near the top:

```js
const { isBypassAllowed } = require('../services/authorization');

let bypassWarningLogged = false;
function bypassEnabled() {
    const allowed = isBypassAllowed(process.env);
    if (allowed && !bypassWarningLogged) {
        bypassWarningLogged = true;
        console.warn('⚠️  AUTH_BYPASS is ON — all authentication is disabled. Never use this in production.');
    }
    if (!allowed && process.env.AUTH_BYPASS === 'true') {
        console.error('❌ AUTH_BYPASS was requested but refused because NODE_ENV=production.');
    }
    return allowed;
}
```

Then replace **both** occurrences of:

```js
        const bypassAuth = process.env.AUTH_BYPASS === 'true';
        if (bypassAuth) {
```

with:

```js
        if (bypassEnabled()) {
```

(one in `isAuthenticated`, one in `verifyApiKey`).

- [ ] **Step 6: Verify and update the test script**

Run: `cd backend && node --check middleware/auth.js && grep -c "AUTH_BYPASS === 'true'" middleware/auth.js`
Expected: syntax OK, and the count is `1` (only inside `bypassEnabled`).

In `backend/package.json`:

```json
"test": "node tests/streak.test.js && node tests/ingest.test.js && node tests/metrics.test.js && node tests/authorization.test.js"
```

Run: `cd backend && npm test` — all four suites pass.

- [ ] **Step 7: Commit**

```bash
git add backend/services/authorization.js backend/tests/authorization.test.js backend/middleware/auth.js backend/package.json
git commit -m "fix(security): refuse AUTH_BYPASS in production (H-10)

Adds a dependency-free authorization helper with ownership assertions,
used by the route lockdowns in the following commits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Delete the legacy unauthenticated endpoints (H-2)

**Files:**
- Modify: `backend/app.js`

**Interfaces:**
- Consumes: nothing
- Produces: `POST /api/user-activity`, `GET /api/user-stats/:id` and `GET /api/user-stats/:id/summary` no longer exist

**Why delete rather than gate:** `POST /api/user-activity` accepts a `userId` in the body and writes activity for it with no authentication — leaderboard fraud in one curl. `GET /api/user-stats/:id` dumps a user's entire history unpaginated. Nothing in `extension/src/` or `frontend/src/` calls any of them; the published extension has used `/api/extension/track` since 2.0.0.

- [ ] **Step 1: Prove nothing calls them**

```bash
grep -rn "user-activity\|user-stats" --include=*.ts --include=*.tsx --include=*.js \
  extension/src frontend/src backend/routes backend/services
```
Expected: no matches. If anything matches, stop and gate the endpoint instead of deleting it.

- [ ] **Step 2: Delete the three route handlers**

In `backend/app.js`, remove the whole block from the line:

```js
app.post("/api/user-activity", async (req, res) => {
```

through the closing of the summary handler — i.e. everything up to but not including:

```js
const PORT = process.env.PORT || 5050;
```

Also remove the now-unused helper and import if nothing else references them:

```js
function toIstIsoString(date) { ... }
```

Run `grep -n "toIstIsoString\|Activity" backend/app.js` first; delete `toIstIsoString` and the `const Activity = require('./models/Activity');` line only if they have no remaining references.

- [ ] **Step 3: Verify**

```bash
cd backend && node --check app.js
grep -c "api/user-activity\|api/user-stats" app.js
```
Expected: syntax OK; count `0`.

- [ ] **Step 4: Commit**

```bash
git add backend/app.js
git commit -m "fix(security): remove unauthenticated legacy activity endpoints (H-2)

POST /api/user-activity accepted an arbitrary userId with no auth, allowing
anyone to fabricate leaderboard activity. GET /api/user-stats/:id dumped a
user's full history. Nothing calls either.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Lock down analytics and leaderboard (H-1)

**Files:**
- Modify: `backend/routes/analytics.js`
- Modify: `backend/routes/leaderboard.js`
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/pages/Leaderboard.tsx`
- Modify: `frontend/src/pages/Teams.tsx`
- Create: `backend/tests/routeGuards.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `assertOwnership` from Task 1
- Produces: all four analytics routes and the leaderboard require a session; `:userId` is accepted but must equal the session user

**Compatibility note:** the `:userId` path parameter is kept (the deployed dashboard sends it) but is now *verified* rather than trusted. It can be dropped in a later release.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/routeGuards.test.js`:

```js
/**
 * Static route-protection scan.
 *
 * Backend node_modules is not installed, so this reads route source directly
 * rather than booting Express. It fails if a sensitive route ever loses its
 * auth middleware — the H-1 regression guard.
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
  const count = (analytics.match(/assertOwnership/g) || []).length;
  const routes = routeDeclarations(analytics).length;
  assert.ok(count >= routes, `${routes} routes but only ${count} ownership checks`);
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
check('goal progress scopes the lookup to the session user', () => {
  const src = read('goals.js');
  assert.ok(
    /Goal\.findOne\(\s*\{[^}]*userId/s.test(src),
    'goal progress must look up by { _id, userId }, not findById'
  );
});
check('single-team read checks membership', () => {
  const src = read('team.js');
  assert.ok(/members:\s*req\.user\.id|isMember|sameUser/.test(src),
    'GET /:teamId does not check membership');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node tests/routeGuards.test.js`
Expected: FAIL — analytics routes unguarded, leaderboard public, goals/teams checks missing.

- [ ] **Step 3: Guard the analytics routes**

In `backend/routes/analytics.js`, the auth import already exists. Add the ownership helper below it:

```js
const { assertOwnership } = require('../services/authorization');
```

Add this helper above the first route:

```js
/**
 * Verifies the caller owns :userId. Returns the id to query, or null when a
 * response has already been sent.
 *
 * The :userId param is retained for compatibility with the deployed dashboard
 * but is now verified against the session rather than trusted.
 */
function resolveOwnedUserId(req, res) {
    const sessionUserId = req.user?._id?.toString();
    const verdict = assertOwnership(req.params.userId, sessionUserId);
    if (!verdict.ok) {
        res.status(verdict.status).json({ message: verdict.message });
        return null;
    }
    return req.params.userId || sessionUserId;
}
```

Then for **each** of the four routes:

1. Add `isAuthenticated` as middleware. For example:
   ```js
   router.get('/:userId', isAuthenticated, async (req, res) => {
   ```
   Do the same for `/weekly/:userId`, `/timeslot/:userId`, and `/summary/:userId` (which already has `isAuthenticated` — leave it).

2. Replace the line that derives the id. Each route currently has:
   ```js
   const userIdStr = userId.toString();
   ```
   Replace with:
   ```js
   const userIdStr = resolveOwnedUserId(req, res);
   if (!userIdStr) return;
   ```
   In `/summary/:userId` the same substitution applies.

- [ ] **Step 4: Guard the leaderboard**

In `backend/routes/leaderboard.js`, add the import:

```js
const { isAuthenticated } = require('../middleware/auth');
```

and change the route declaration:

```js
router.get('/', isAuthenticated, async (req, res) => {
```

The leaderboard is a shared board, so no ownership check — but it must not be readable by anonymous callers, because it publishes the user ids that make the other IDORs exploitable.

- [ ] **Step 5: Send credentials from the frontend**

Five fetches currently omit `credentials` and will start returning 401. Add `credentials: 'include'` to each:

`frontend/src/pages/Dashboard.tsx` — three calls, each currently shaped like:
```ts
      const res = await fetch(`${API_URL}/api/analytics/...`, {
        cache: 'no-cache',
```
becomes:
```ts
      const res = await fetch(`${API_URL}/api/analytics/...`, {
        credentials: 'include',
        cache: 'no-cache',
```

`frontend/src/pages/Leaderboard.tsx`:
```ts
      const res = await fetch(`${API_URL}/api/leaderboard`, { credentials: 'include' });
```

`frontend/src/pages/Teams.tsx`:
```ts
      const res = await fetch(`${API_URL}/api/teams`, { credentials: 'include' });
```

- [ ] **Step 6: Verify**

```bash
cd backend && node --check routes/analytics.js && node --check routes/leaderboard.js
cd ../frontend && grep -c "credentials: 'include'" src/pages/Dashboard.tsx
```
Expected: syntax OK; Dashboard count is `3`.

Then confirm no fetch is left unauthenticated:
```bash
cd frontend && grep -rn "fetch(\`\${API_URL}" --include=*.tsx src | while read -r l; do
  f=$(echo "$l"|cut -d: -f1); n=$(echo "$l"|cut -d: -f2)
  sed -n "${n},$((n+6))p" "$f" | grep -q credentials || echo "MISSING: $l"
done
```
Expected: no `MISSING` lines.

- [ ] **Step 7: Run the guard test (goals/teams still expected to fail)**

Run: `cd backend && node tests/routeGuards.test.js`
Expected: analytics, leaderboard and metrics checks PASS; goals and teams still FAIL — they are Task 4.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/analytics.js backend/routes/leaderboard.js backend/tests/routeGuards.test.js frontend/src/pages/
git commit -m "fix(security): require auth and ownership on analytics and leaderboard (H-1)

The :userId param is now verified against the session instead of trusted.
Frontend fetches send credentials. Adds a static route-guard test so a
future edit cannot silently unprotect these routes again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Fix the IDORs on goals and teams (H-11)

**Files:**
- Modify: `backend/routes/goals.js`
- Modify: `backend/routes/team.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `sameUser` from Task 1
- Produces: goal progress and single-team reads are scoped to the caller

- [ ] **Step 1: Scope the goal lookup**

In `backend/routes/goals.js`, replace:

```js
        const goal = await Goal.findById(goalId);

        if (!goal) {
            return res.status(404).json({ message: 'Goal not found' });
        }
```

with:

```js
        // Scope by owner: findById leaked another user's goal title,
        // description, targetHours and deadline.
        const goal = await Goal.findOne({ _id: goalId, userId: req.user.id });

        if (!goal) {
            return res.status(404).json({ message: 'Goal not found' });
        }
```

- [ ] **Step 2: Check team membership**

In `backend/routes/team.js`, add the import:

```js
const { sameUser } = require('../services/authorization');
```

and replace the body of `GET /:teamId`:

```js
        const team = await Team.findById(teamId).populate('members', 'name email profilePictureUrl');
        if (!team) {
            return res.status(404).json({ message: 'Team not found' });
        }
        res.json(team);
```

with:

```js
        const team = await Team.findById(teamId).populate('members', 'name email profilePictureUrl');
        if (!team) {
            return res.status(404).json({ message: 'Team not found' });
        }

        // Membership check: this returns every member's name and email.
        const isMember = (team.members || []).some((m) => sameUser(m?._id ?? m, req.user.id));
        if (!isMember) {
            return res.status(403).json({ message: 'You must be a team member to view this team' });
        }

        res.json(team);
```

- [ ] **Step 3: Run the guard test**

Run: `cd backend && node tests/routeGuards.test.js`
Expected: `7 passed, 0 failed`

- [ ] **Step 4: Add to the test script and run everything**

In `backend/package.json`:

```json
"test": "node tests/streak.test.js && node tests/ingest.test.js && node tests/metrics.test.js && node tests/authorization.test.js && node tests/routeGuards.test.js"
```

Run: `cd backend && npm test`
Expected: all five suites pass.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/goals.js backend/routes/team.js backend/package.json
git commit -m "fix(security): scope goal progress and team reads to the caller (H-11)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Hash group passwords (H-9)

**Files:**
- Create: `backend/services/passwordHash.js`
- Create: `backend/tests/passwordHash.test.js`
- Modify: `backend/routes/groups.js`
- Modify: `backend/models/Group.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `hashPassword(plain) -> Promise<string>` — format `scrypt$<saltHex>$<hashHex>`
  - `verifyPassword(plain, stored) -> Promise<boolean>` — accepts both the hashed format and a legacy plaintext value
  - `isHashed(stored) -> boolean`

**Why scrypt, not bcrypt:** adding bcrypt means a native dependency and an `npm install` in an environment where backend `node_modules` is absent, and native modules complicate the Vercel serverless build. `crypto.scrypt` is built into Node, is a legitimate password KDF, and keeps the tests dependency-free.

**Migration:** existing groups hold plaintext. `verifyPassword` accepts a plaintext match so nobody is locked out, and the join route upgrades the stored value to a hash on the next successful join.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/passwordHash.test.js`:

```js
const assert = require('assert');
const { hashPassword, verifyPassword, isHashed } = require('../services/passwordHash');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

(async () => {
  console.log('\npasswordHash');

  await check('hash then verify round-trips', async () => {
    const stored = await hashPassword('correct horse');
    assert.strictEqual(await verifyPassword('correct horse', stored), true);
  });

  await check('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse');
    assert.strictEqual(await verifyPassword('wrong horse', stored), false);
  });

  await check('never stores the plaintext', async () => {
    const stored = await hashPassword('hunter2');
    assert.ok(!stored.includes('hunter2'), 'plaintext present in stored value');
    assert.ok(stored.startsWith('scrypt$'), `unexpected format: ${stored}`);
  });

  await check('two hashes of the same password differ (salted)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notStrictEqual(a, b);
  });

  await check('still accepts a legacy plaintext value', async () => {
    assert.strictEqual(await verifyPassword('oldpass', 'oldpass'), true);
    assert.strictEqual(await verifyPassword('nope', 'oldpass'), false);
  });

  await check('isHashed distinguishes the two formats', async () => {
    assert.strictEqual(isHashed(await hashPassword('x')), true);
    assert.strictEqual(isHashed('plaintext'), false);
    assert.strictEqual(isHashed(null), false);
  });

  await check('handles empty and null stored values safely', async () => {
    assert.strictEqual(await verifyPassword('x', null), false);
    assert.strictEqual(await verifyPassword('x', ''), false);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node tests/passwordHash.test.js`
Expected: FAIL — `Cannot find module '../services/passwordHash'`

- [ ] **Step 3: Write the implementation**

Create `backend/services/passwordHash.js`:

```js
/**
 * Group password hashing.
 *
 * Uses Node's built-in crypto.scrypt — no native dependency, which keeps the
 * Vercel serverless build simple and lets these tests run without npm install.
 *
 * Stored format: scrypt$<saltHex>$<hashHex>
 *
 * Legacy groups stored passwords in plaintext. verifyPassword accepts a
 * plaintext match so existing members are not locked out; routes/groups.js
 * upgrades the stored value on the next successful join.
 */

const crypto = require('crypto');

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(plain, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(plain, salt, KEY_LENGTH, (err, derived) => {
            if (err) reject(err);
            else resolve(derived);
        });
    });
}

function isHashed(stored) {
    return typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);
}

async function hashPassword(plain) {
    if (typeof plain !== 'string' || plain.length === 0) {
        throw new Error('password must be a non-empty string');
    }
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const derived = await scrypt(plain, salt);
    return `${PREFIX}$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(plain, stored) {
    if (typeof plain !== 'string' || typeof stored !== 'string' || stored.length === 0) {
        return false;
    }

    if (!isHashed(stored)) {
        // Legacy plaintext. Length-safe comparison.
        const a = Buffer.from(plain);
        const b = Buffer.from(stored);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    const [, salt, hashHex] = stored.split('$');
    if (!salt || !hashHex) return false;

    const derived = await scrypt(plain, salt);
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword, isHashed };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node tests/passwordHash.test.js`
Expected: `7 passed, 0 failed`

- [ ] **Step 5: Use it in the group routes**

In `backend/routes/groups.js`, add the import:

```js
const { hashPassword, verifyPassword, isHashed } = require('../services/passwordHash');
```

**5a — hash on create.** Replace:

```js
        const group = new Group({
            name: groupName,
            description: groupDescription,
            visibility,
            password: visibility === 'private' ? password : null,
            createdBy: req.user._id
        });
```

with:

```js
        const group = new Group({
            name: groupName,
            description: groupDescription,
            visibility,
            password: visibility === 'private' ? await hashPassword(password) : null,
            createdBy: req.user._id
        });
```

**5b — never return the password.** In the same handler, replace `res.status(201).json({ success: true, message: 'Group created successfully', group });` with:

```js
        const { password: _omit, ...safeGroup } = group.toObject();
        res.status(201).json({
            success: true,
            message: 'Group created successfully',
            group: safeGroup
        });
```

**5c — verify on join, and upgrade legacy plaintext.** Replace:

```js
        if (group.visibility === 'private') {
            if (!password) {
                return res.status(400).json({ message: 'Password is required for private groups' });
            }
            if (password !== group.password) {
                return res.status(401).json({ message: 'Incorrect password' });
            }
        }
```

with:

```js
        if (group.visibility === 'private') {
            if (!password) {
                return res.status(400).json({ message: 'Password is required for private groups' });
            }
            const ok = await verifyPassword(password, group.password);
            if (!ok) {
                return res.status(401).json({ message: 'Incorrect password' });
            }
            // Opportunistic migration off legacy plaintext.
            if (!isHashed(group.password)) {
                group.password = await hashPassword(password);
                await group.save();
            }
        }
```

**5d — strip the password from the join response.** Replace `res.json({ success: true, message: 'Successfully joined the group', group });` with:

```js
        const { password: _omitJoin, ...safeJoined } = group.toObject();
        res.json({
            success: true,
            message: 'Successfully joined the group',
            group: safeJoined
        });
```

**5e — never list passwords.** In `GET /discover`, add `.select('-password')`:

```js
        const groups = await Group.find(query)
            .select('-password')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });
```

and in `GET /my-groups`, add `select` to the populate:

```js
            .populate({
                path: 'groupId',
                select: '-password',
                populate: { path: 'createdBy', select: 'name email' }
            });
```

- [ ] **Step 6: Document the field**

In `backend/models/Group.js`, replace the `password` field with:

```js
    // scrypt hash in the form scrypt$<salt>$<hash>. Legacy rows may still hold
    // plaintext; services/passwordHash.js accepts both and routes/groups.js
    // upgrades on the next successful join. Never return this field.
    password: {
        type: String,
        default: null,
        select: false
    },
```

**Important:** `select: false` means `Group.findById(...)` no longer returns `password`. The join route needs it, so in `POST /:groupId/join` change the lookup to:

```js
        const group = await Group.findById(groupId).select('+password');
```

- [ ] **Step 7: Verify**

```bash
cd backend && node --check routes/groups.js && node --check models/Group.js
grep -n "password !== group.password" routes/groups.js || echo "plaintext comparison gone"
```
Expected: syntax OK; the plaintext comparison is gone.

Update `backend/package.json`:
```json
"test": "node tests/streak.test.js && node tests/ingest.test.js && node tests/metrics.test.js && node tests/authorization.test.js && node tests/routeGuards.test.js && node tests/passwordHash.test.js"
```

Run: `cd backend && npm test` — all six suites pass.

- [ ] **Step 8: Commit**

```bash
git add backend/services/passwordHash.js backend/tests/passwordHash.test.js backend/routes/groups.js backend/models/Group.js backend/package.json
git commit -m "fix(security): hash group passwords with scrypt (H-9)

Passwords were stored and compared in plaintext and returned by /discover.
Now salted-scrypt hashed, select:false, and stripped from every response.
Legacy plaintext still verifies and is upgraded on the next join.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Insights page

**Files:**
- Create: `frontend/src/pages/Insights.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/metrics?days=<n>&timezone=<offset>` from the Phase A work, which returns
  `{ success: true, metrics: { windowDays, deepWorkRatio, flowBlocks{medianMs,longestMs,deepBlockCount,blockCount}, consistencyIndex, truePeakWindow{hour,score}|null, estimationCalibration{factor,sampleSize}|null, churnRatio, comprehensionLoad, contextSwitchesPerHour, commits, totalHours } }`
- Produces: `/insights` route and nav entry

**Critical UX requirement:** `deepWorkRatio`, `flowBlocks` and the friction metrics are **0 for activity recorded before extension 2.1.0**. The page must distinguish "no data yet" from "your score is zero" — showing a confident 0% to a user who simply has not upgraded would be a lie. Use `flowBlocks.blockCount === 0` as the signal that focus data has not started arriving.

- [ ] **Step 1: Write the page**

Create `frontend/src/pages/Insights.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Brain, Timer, Activity, Sunrise, Target, RefreshCw } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import { API_URL } from '../config';

interface Metrics {
  windowDays: number;
  deepWorkRatio: number;
  flowBlocks: { medianMs: number; longestMs: number; deepBlockCount: number; blockCount: number };
  consistencyIndex: number;
  truePeakWindow: { hour: number; score: number } | null;
  estimationCalibration: { factor: number; sampleSize: number } | null;
  churnRatio: number;
  comprehensionLoad: number;
  contextSwitchesPerHour: number;
  commits: number;
  totalHours: number;
}

const minutes = (ms: number) => Math.round(ms / 60000);

const hourLabel = (hour: number) => {
  const start = ((hour % 24) + 24) % 24;
  const end = (start + 1) % 24;
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${fmt(start)}–${fmt(end)}`;
};

export default function Insights() {
  const { theme } = useTheme();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timezone = new Date().getTimezoneOffset();
      const res = await fetch(`${API_URL}/api/metrics?days=${days}&timezone=${timezone}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'Please sign in again to view your insights.' : 'Could not load your insights.');
        return;
      }
      const data = await res.json();
      setMetrics(data.metrics);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const card = {
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.primary}33`,
  } as const;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: theme.colors.background }}>
        <div className="text-2xl animate-pulse font-semibold" style={{ color: theme.colors.text }}>
          Working out your insights...
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ backgroundColor: theme.colors.background }}>
        <p style={{ color: theme.colors.text }}>{error ?? 'No insights available.'}</p>
        <button onClick={fetchMetrics} className="cursor-target px-4 py-2 rounded-lg"
          style={{ color: theme.colors.text, border: `1px solid ${theme.colors.primary}55` }}>
          Try again
        </button>
      </div>
    );
  }

  // Focus data only exists from extension 2.1.0 onward. Showing a confident
  // 0% to someone who simply has not upgraded would be misleading.
  const hasFocusData = metrics.flowBlocks.blockCount > 0;

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: theme.colors.background }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold" style={{ color: theme.colors.text }}>
            <GradientText animationSpeed={5}>Your Insights</GradientText>
          </h1>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-1 rounded-lg text-sm"
              style={{ backgroundColor: theme.colors.surface, color: theme.colors.text, border: `1px solid ${theme.colors.primary}55` }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button onClick={fetchMetrics} aria-label="Refresh insights" className="cursor-target p-2 rounded-lg"
              style={{ color: theme.colors.textSecondary, border: `1px solid ${theme.colors.primary}55` }}>
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="mb-6 text-sm" style={{ color: theme.colors.textSecondary }}>
          Based on {metrics.totalHours} hours tracked over the last {metrics.windowDays} days.
        </p>

        {!hasFocusData && (
          <div className="mb-6 p-4 rounded-xl" style={{ ...card, borderColor: `${theme.colors.primary}66` }}>
            <p style={{ color: theme.colors.text }}>
              Focus and flow metrics need CodeTrackr <strong>2.1.0 or newer</strong>. Update the
              extension and they will start filling in — the other insights below work already.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Deep work ratio */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Brain className="w-5 h-5" />
              <h2 className="font-semibold">Deep work</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {hasFocusData ? `${Math.round(metrics.deepWorkRatio * 100)}%` : '—'}
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {hasFocusData
                ? 'Share of your focused time spent in unbroken stretches of 25 minutes or more.'
                : 'Waiting for data from extension 2.1.0.'}
            </p>
          </div>

          {/* 2. Flow blocks */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Timer className="w-5 h-5" />
              <h2 className="font-semibold">Flow blocks</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {hasFocusData ? `${minutes(metrics.flowBlocks.longestMs)} min` : '—'}
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {hasFocusData
                ? `Longest unbroken stretch. Typical block ${minutes(metrics.flowBlocks.medianMs)} min across ${metrics.flowBlocks.blockCount} sessions.`
                : 'Waiting for data from extension 2.1.0.'}
            </p>
          </div>

          {/* 3. Consistency */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Activity className="w-5 h-5" />
              <h2 className="font-semibold">Consistency</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {Math.round(metrics.consistencyIndex * 100)}%
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {metrics.consistencyIndex >= 0.6
                ? 'You code at a steady daily rhythm.'
                : 'Your daily coding time swings a lot. Steady beats heroic.'}
            </p>
          </div>

          {/* 4. True peak hours */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Sunrise className="w-5 h-5" />
              <h2 className="font-semibold">Peak hour</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {metrics.truePeakWindow ? hourLabel(metrics.truePeakWindow.hour) : '—'}
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {metrics.truePeakWindow
                ? 'Your most productive hour, scored on commits and low rework — not simply the hour you are busiest.'
                : 'Not enough data yet.'}
            </p>
          </div>

          {/* 5. Estimation accuracy */}
          <div className="p-5 rounded-xl md:col-span-2" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Target className="w-5 h-5" />
              <h2 className="font-semibold">Estimation accuracy</h2>
            </div>
            {metrics.estimationCalibration ? (
              <>
                <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
                  {metrics.estimationCalibration.factor}×
                </p>
                <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
                  {metrics.estimationCalibration.factor > 1.1
                    ? `You take about ${metrics.estimationCalibration.factor}× longer than you estimate.`
                    : metrics.estimationCalibration.factor < 0.9
                    ? 'You finish goals faster than you estimate.'
                    : 'Your estimates are close to reality.'}
                  {' '}Based on {metrics.estimationCalibration.sampleSize} completed goals.
                </p>
              </>
            ) : (
              <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
                Complete at least two goals with a tech stack set, and this will compare your
                estimates against the hours you actually logged.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route and nav link**

In `frontend/src/App.tsx`:

Add to the imports beside the other pages:
```tsx
import Insights from './pages/Insights';
```

Add `Sparkles` to the existing `lucide-react` import list.

Add the nav link after the Dashboard one:
```tsx
                    <NavLink to="/insights" icon={<Sparkles className="w-4 h-4" />}>Insights</NavLink>
```

Add the route after the dashboard route:
```tsx
            <Route path="/insights" element={<Insights />} />
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npm install --no-audit --no-fund && npx tsc -b --noEmit 2>&1 | tail -20
```
Expected: no errors.

If `npm install` fails (network or native build), skip the typecheck, and record in the session log that `Insights.tsx` shipped **typecheck-unverified**. Do not claim it compiles without having run this.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Insights.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add Insights page for the five derived metrics

Deep work ratio, flow blocks, consistency, true peak hour and estimation
accuracy. Distinguishes 'no data yet' from a genuine zero, since focus
metrics only exist from extension 2.1.0 onward.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Update docs and the session log

**Files:**
- Modify: `docs/IMPROVEMENT_PLAN.md` — mark H-1, H-2, H-9, H-10, H-11 fixed
- Modify: `docs/ARCHITECTURE.md` — API surface table auth column
- Modify: `docs/SESSION-LOG-2026-08-27.md` — append this batch
- Modify: `~/.claude/projects/.../memory/codetrackr-project.md`

- [ ] **Step 1: Mark the findings fixed**

In `docs/IMPROVEMENT_PLAN.md`, append `— ✅ FIXED 2026-08-28` to the H-1, H-2, H-9, H-10 and H-11 headings, and add a Batch 3 entry to the Status section listing the commits and the new test files.

- [ ] **Step 2: Correct the API surface table**

In `docs/ARCHITECTURE.md` section 5, change the `**none**` auth cells for the analytics routes and the leaderboard to `isAuthenticated + ownership`, and delete the `POST /api/user-activity`, `GET /api/user-stats/:id` row.

- [ ] **Step 3: Append to the session log**

Add a `## 8. Security batch + Insights page (2026-08-28)` section to `docs/SESSION-LOG-2026-08-27.md` covering: what was fixed, the scrypt-over-bcrypt decision and why, the plaintext migration path, the frontend credentials coupling, any errors hit during execution, and whether the frontend typecheck actually ran.

- [ ] **Step 4: Update memory**

Update the memory file with the new branch name, the new test count, and the fact that the security batch is closed.

- [ ] **Step 5: Final verification**

```bash
cd backend && npm test
cd ../extension && npm test
```
Expected: backend six suites pass, extension two suites pass.

- [ ] **Step 6: Commit**

```bash
git add docs/ && git commit -m "docs: record security batch and Insights page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification checklist

- [ ] `cd backend && npm test` — six suites green
- [ ] `cd extension && npm test` — two suites green
- [ ] `grep -rn "api/user-activity\|api/user-stats" backend/` returns nothing
- [ ] `grep -n "password !== group.password" backend/routes/groups.js` returns nothing
- [ ] No frontend `fetch` to `API_URL` lacks `credentials: 'include'`
- [ ] `routeGuards.test.js` passes — no sensitive route is unprotected
- [ ] `AUTH_BYPASS=true NODE_ENV=production` does not bypass (covered by `authorization.test.js`)

## Known limitations to record, not fix

- Route protection is verified by **static source scanning**, not by issuing real HTTP requests. It catches a missing middleware but cannot prove runtime behaviour; a live smoke test against a deployed instance is still worthwhile.
- Legacy group passwords remain plaintext until each group's next successful join. A one-off migration script would close this faster.
- `GET /api/leaderboard` now requires a session but is still a full-collection scan (H-7, unfixed).
- The Insights page reads metrics that are zero for pre-2.1.0 activity; the empty state explains this but cannot backfill it.
