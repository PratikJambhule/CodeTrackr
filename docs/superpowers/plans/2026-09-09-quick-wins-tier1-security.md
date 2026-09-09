# Quick Wins: Tier 1 + Security Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 11 Quick-Wins items (Tier 1 + `#11`/`#12`/`#15`) as 11 focused commits, each with a paper-trail entry, without breaking the green test suite.

**Architecture:** Small surgical changes to an Express 5 / Mongoose 8 backend and a React 19 / Vite frontend. New behaviour on `app.js` (helmet, rate-limit, `/health`, central error handler, boot guards) is covered by **source-scan assertion tests** in the existing `tests/routeGuards.test.js` style, because no test loads `app.js`. New ingest bounds are a **pure module** with real unit tests. Frontend fixes are verified by `tsc -b` + `vite build`.

**Tech Stack:** Node 18, Express 5, Mongoose 8, `helmet`, `express-rate-limit` (both already deps), plain `node:assert` test scripts, React 19 + Vite 7 + TypeScript, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-quick-wins-tier1-security.md` (read it — this plan argues from it)

## Global Constraints

- Branch: `feat/security-and-insights`. One commit per task. Commit messages end with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- All git commands run from repo root `C:\Users\soham\Downloads\codetrackr\CodeTrackr-main` — prefix with `cd` to the repo root because the shell cwd drifts into `backend/` and `frontend/`.
- Backend tests run with `cd backend && npm test`. Extension: `cd extension && npm test`. Frontend build: `cd frontend && npm run build`. Frontend typecheck only: `cd frontend && npx tsc -b --noEmit`.
- **Do not touch** these pre-existing un-tracked edits: `THEME_USER_GUIDE.md`, `backend/drop-duplicate-index.js`, `backend/package-lock.json`, `extension/extension.js`, `extension/index.html`, `frontend/package-lock.json`.
- No `npm install` of new runtime deps in this batch (`helmet` + `express-rate-limit` already present; verify with `grep` in `backend/package.json`). No `vsce` publish. No migration `--apply` runs.
- Every `app.js` edit is followed by a local smoke: `cd backend && JWT_SECRET=smoke MONGO_URI=mongodb://127.0.0.1:1/none node -e "const a=require('./app.js'); if(typeof a!=='function') throw new Error('app export changed'); console.log('smoke ok'); process.exit(0)"` — expect `smoke ok` and exit 0 within ~1s (Mongoose connect fails in the background, that is fine; the process must not hang or throw synchronously).
- After the final task, all suites (10→13 backend, 2 extension) are green and `frontend npm run build` exits 0.

---

## File Structure

**New files:**
| Path | Responsibility |
|---|---|
| `.github/workflows/ci.yml` | CI: backend tests, extension tests, frontend build (+ app-import smoke after Task 14) |
| `backend/services/ingestValidation.js` | Pure `validateIngestPayload(body)` — bounds for `duration`/`fileName`/`language`/`projectName`/`timestamp`. No deps. |
| `backend/routes/internal.js` | `POST /api/internal/run-notifications` + `/run-rollup`, behind a shared-secret guard. Replaces the cron for serverless. |
| `backend/tests/quickWins.test.js` | Source-scan assertions for `#3`, `#4`, `#6`, `#7`, `#11`, `#15`. |
| `backend/tests/ingestValidation.test.js` | Pure unit tests for `validateIngestPayload`. |

**Modified (code):**
| Path | Change |
|---|---|
| `backend/app.js` | helmet, 2× rate-limit, `/health`, central error handler, `JWT_SECRET` boot guard, `require.main` guard on `initScheduler()`+`app.listen()`, mount `/api/internal` |
| `backend/middleware/auth.js` | drop `|| 'your_jwt_secret'` (1 site) |
| `backend/routes/auth.js` | drop `|| 'your_jwt_secret'` (2 sites) |
| `backend/routes/groups.js` | `11000` → 409 in the join `catch` |
| `backend/routes/{analytics,auth,extension,goals,groups,leaderboard,metrics,notifications,team,user}.js` | generic `catch`-tail 500 → `next(e)`; strip `error: error.message` from bodies |
| `backend/routes/extension.js` | call `validateIngestPayload` in `/track` and `/track/batch` |
| `backend/models/Notification.js` | `notificationSchema.index({ goalId: 1, type: 1 })` |
| `backend/services/notificationScheduler.js` | export `checkUpcomingDeadlines`, `checkOverdueGoals` (already exported), `rollupDaily` (already) — no logic change |
| `backend/package.json` | `test` script += `quickWins.test.js` + `ingestValidation.test.js` |
| `frontend/src/pages/Dashboard.tsx` | wire Repeated Failures to real data; remove 2 unused imports |
| `frontend/src/pages/{Goals,Groups,Profile,Teams}.tsx`, `frontend/src/components/TextType.tsx` | resolve TS errors |

**Modified (docs):** `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`, `CODETRACKR_PROJECT_CONTEXT.md`, `docs/interview-preparation/{CodeTrackr_Interview_Preparation,CodeTrackr_Interview_QA,CodeTrackr_Interview_Cheat_Sheet,CodeTrackr_Interview_Guide_Condensed,CodeTrackr_Architecture}.md`, `docs/SESSION-LOG-2026-08-27.md`, `memory/codetrackr-overview.md`, `memory/MEMORY.md`.

---

## Task 1: `#5` — mark the `timestamp` index quick-win done (docs only)

**Files:**
- Modify: `docs/interview-preparation/CodeTrackr_Quick_Wins.md`
- Modify: `docs/IMPROVEMENT_PLAN.md`

**Interfaces:** none (no code).

- [ ] **Step 1: Confirm the index already ships**

Run: `cd backend && grep -n "index({ userId: 1, timestamp: -1 })" models/Activity.js`
Expected: one hit (`activitySchema.index({ userId: 1, timestamp: -1 });`).
If absent, STOP — the DB-write batch is not merged; re-plan.

- [ ] **Step 2: Mark it in `Quick_Wins.md`**

In `docs/interview-preparation/CodeTrackr_Quick_Wins.md`, change the `## 5.` heading line:
```
## 5. Add the missing database index 🟢
```
to:
```
## 5. Add the missing database index 🟢 — ✅ DONE 2026-09-08 (shipped in the DB write-reduction batch)
```
Add directly under that heading:
```
> **Shipped.** `activitySchema.index({ userId: 1, timestamp: -1 })` is in `backend/models/Activity.js`;
> the dead `{userId:1,date:-1}` index and the `date` field are gone. Verified by `activityModel.test.js`.
```

- [ ] **Step 3: Mark it in `IMPROVEMENT_PLAN.md`**

In `docs/IMPROVEMENT_PLAN.md`, the Status section already says "Also folds in the missing `{userId:1,timestamp:-1}` index." Leave it. Add a new line to the end of the **Status** section's write-reduction paragraph list is not needed. Instead, confirm no numbered finding is stale: search `grep -n "timestamp:-1\|date:-1" docs/IMPROVEMENT_PLAN.md` and if any numbered finding still says the index is "missing", append ` — ✅ FIXED 2026-09-08` to that finding line.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add docs/interview-preparation/CodeTrackr_Quick_Wins.md docs/IMPROVEMENT_PLAN.md
git commit -m "docs: mark timestamp-index quick-win done (shipped in DB-write batch)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `#7` — fail fast on missing `JWT_SECRET`

**Files:**
- Modify: `backend/app.js` (after `require("dotenv").config();`, line 7)
- Modify: `backend/middleware/auth.js:87`
- Modify: `backend/routes/auth.js:23`, `backend/routes/auth.js:54`
- Create: `backend/tests/quickWins.test.js`
- Modify: `backend/package.json` (`test` script)
- Modify: `docs/IMPROVEMENT_PLAN.md` (M-9), `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

**Interfaces:**
- Produces: `backend/tests/quickWins.test.js` — a `node:assert` script following the `check(name, fn)` + `passed`/`failed` + `process.exit(failed === 0 ? 0 : 1)` pattern from `tests/ingestWiring.test.js`. Later tasks (`#3`, `#4`, `#6`, `#11`, `#15`) append `check(...)` blocks to it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/quickWins.test.js`:
```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node tests/quickWins.test.js`
Expected: FAIL on both checks (`your_jwt_secret` still present, no guard yet).

- [ ] **Step 3: Add the boot guard**

In `backend/app.js`, immediately after line 7 (`require("dotenv").config();`) and before `const app = express();`:
```js

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required — set it in the environment before starting the API.');
}
```

- [ ] **Step 4: Remove the fallbacks**

- `backend/middleware/auth.js:87` — change `jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret')` to `jwt.verify(token, process.env.JWT_SECRET)`.
- `backend/routes/auth.js:23` — change `jwt.sign(payload, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1d' })` to `jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' })`.
- `backend/routes/auth.js:54` — change `jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret')` to `jwt.verify(token, process.env.JWT_SECRET)`.

- [ ] **Step 5: Wire the new test into `npm test`**

In `backend/package.json`, append ` && node tests/quickWins.test.js` to the end of the `test` script string.

- [ ] **Step 6: Run tests**

Run: `cd backend && node tests/quickWins.test.js`
Expected: PASS (2 checks).
Run: `cd backend && npm test`
Expected: all suites PASS.

- [ ] **Step 7: Smoke `app.js`**

Run: `cd backend && JWT_SECRET=smoke MONGO_URI=mongodb://127.0.0.1:1/none node -e "const a=require('./app.js'); if(typeof a!=='function') throw new Error('bad export'); console.log('smoke ok'); process.exit(0)"`
Expected: `smoke ok`, exit 0.
Run: `cd backend && MONGO_URI=x node -e "try{require('./app.js')}catch(e){console.log('threw:',e.message);process.exit(0)} process.exit(1)"`
Expected: `threw: JWT_SECRET is required ...` (proves fail-fast).

- [ ] **Step 8: Docs**

- `docs/IMPROVEMENT_PLAN.md` — change the `M-9` line to start with `- **M-9. ✅ FIXED 2026-09-09.** ` and reword to past tense ("`JWT_SECRET` had a literal fallback `'your_jwt_secret'`; the app now refuses to boot without the env var.").
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to the `## 7.` heading.

- [ ] **Step 9: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/app.js backend/middleware/auth.js backend/routes/auth.js backend/tests/quickWins.test.js backend/package.json docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "fix(security): require JWT_SECRET at boot, drop hardcoded fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `#6` — return 409, not 500, on a duplicate group join

**Files:**
- Modify: `backend/routes/groups.js:251-254` (the `/:groupId/join` `catch`)
- Modify: `backend/tests/quickWins.test.js` (append)
- Modify: `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

**Interfaces:**
- Consumes: `check(name, fn)` + `read()` helpers from `quickWins.test.js` (Task 2).

- [ ] **Step 1: Add the failing test**

In `backend/tests/quickWins.test.js`, before the final `console.log(\`\n${passed}...\`)` line, add:
```js
console.log('\nquick-wins: 409 on duplicate group join (#6)');
const groupsSrc = read('routes/groups.js');
check('the join handler maps 11000 to a 409', () => {
  assert.ok(/error\.code\s*===\s*11000/.test(groupsSrc), 'no 11000 check in groups.js');
  // the 409 must appear in the same handler as the 11000 check
  const around = groupsSrc.slice(groupsSrc.indexOf('11000') - 200, groupsSrc.indexOf('11000') + 200);
  assert.ok(/status\(409\)/.test(around), 'no 409 next to the 11000 check');
});
check('the join catch no longer leaks error.message', () => {
  const joinStart = groupsSrc.indexOf("router.post('/:groupId/join'");
  const joinEnd = groupsSrc.indexOf('router.post', joinStart + 10);
  const joinHandler = groupsSrc.slice(joinStart, joinEnd);
  assert.ok(!/error:\s*error\.message/.test(joinHandler), 'join handler still echoes error.message');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node tests/quickWins.test.js`
Expected: FAIL on the two new `#6` checks.

- [ ] **Step 3: Implement**

Replace `backend/routes/groups.js:251-254`:
```js
    } catch (error) {
        console.error('Error joining group:', error);
        res.status(500).json({ message: 'Error joining group', error: error.message });
    }
```
with:
```js
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ message: 'You are already a member of this group' });
        }
        console.error('Error joining group:', error);
        return res.status(500).json({ message: 'Error joining group' });
    }
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node tests/quickWins.test.js` → PASS.
Run: `cd backend && npm test` → all PASS (`routeGuards.test.js` still green — the auth middleware is untouched).

- [ ] **Step 5: Docs**

- `docs/IMPROVEMENT_PLAN.md` — under `## MEDIUM`, add a new bullet:
  `- **M-14. ✅ FIXED 2026-09-09.** A duplicate group join (double-click / race) returned 500. The \`groupmembers\` unique compound index throws \`11000\`; the join handler now maps that to \`409 Conflict\`.`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to the `## 6.` heading.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/routes/groups.js backend/tests/quickWins.test.js docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "fix(api): return 409 on duplicate group join

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `#11` — `GET /health` readiness endpoint

**Files:**
- Modify: `backend/app.js` (after the `app.get("/")` line, ~line 38)
- Modify: `backend/tests/quickWins.test.js` (append)
- Modify: `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

- [ ] **Step 1: Add the failing test**

In `backend/tests/quickWins.test.js`, before the final summary log, add:
```js
console.log('\nquick-wins: /health readiness (#11)');
check('app.js exposes GET /health gated on mongoose readyState', () => {
  assert.ok(/app\.get\(\s*['"]\/health['"]/.test(appSrc), 'no GET /health route');
  assert.ok(/mongoose\.connection\.readyState/.test(appSrc), '/health does not check readyState');
  assert.ok(/503/.test(appSrc), '/health never returns 503');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node tests/quickWins.test.js` → FAIL on the `#11` check.

- [ ] **Step 3: Implement**

In `backend/app.js`, immediately after line 38 (`app.get("/", (req, res) => res.json({ status: "ok", service: "CodeTrackr API" }));`):
```js

// Readiness: 503 when the DB connection isn't usable, so the platform
// doesn't route traffic to a broken instance. `GET /` stays the liveness ping.
app.get('/health', (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? 'ok' : 'degraded', db: up });
});
```

- [ ] **Step 4: Run tests + smoke**

Run: `cd backend && node tests/quickWins.test.js` → PASS.
Run: `cd backend && npm test` → all PASS.
Run the `app.js` smoke from Global Constraints → `smoke ok`.

- [ ] **Step 5: Docs**

- `docs/IMPROVEMENT_PLAN.md` — new bullet under `## LOW`:
  `- **L-8. ✅ FIXED 2026-09-09.** \`GET /\` returned \`{status:'ok'}\` even with Mongo down. Added \`GET /health\` returning 503 when \`mongoose.connection.readyState !== 1\`. Point the platform health check at it.`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 11.`.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/app.js backend/tests/quickWins.test.js docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "feat(backend): add /health readiness endpoint (503 when DB down)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `#8` — wire the "Repeated Failures" panel to real data

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx` (delete lines 220-238 mock arrays; edit render at ~1163; remove 2 unused imports if they become unused)
- Modify: `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

**Interfaces:**
- Consumes: backend `terminalSummary.repeatedFailedCommands` — array of `{ command: string, count: number, timestamps: string[] }`, already returned by `buildTerminalSummary` in `backend/routes/analytics.js` (sorted desc by count, sliced to 5).

- [ ] **Step 1: Confirm the backend shape**

Run: `cd backend && node -e "const s=require('fs').readFileSync('routes/analytics.js','utf8'); console.log(/repeatedFailedCommands = Array.from/.test(s), /command: key, count: 0/.test(s))"`
Expected: `true true` (shape is `{command, count, timestamps}`).

- [ ] **Step 2: Replace the mock arrays with the real source**

In `frontend/src/pages/Dashboard.tsx`, delete lines 220-238 (the `repeatedFailuresDaily`, `repeatedFailuresWeekly`, and `repeatedFailuresMock` declarations) and replace with:
```tsx
  const repeatedFailures = (currentData?.terminalSummary?.repeatedFailedCommands ?? []) as Array<{
    command: string;
    count: number;
  }>;
```

- [ ] **Step 3: Update the render**

At `frontend/src/pages/Dashboard.tsx` ~line 1162-1180, replace the `repeatedFailuresMock.map(...)` block with:
```tsx
            <div className="space-y-3">
              {repeatedFailures.length === 0 && (
                <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
                  No repeated command failures in this period.
                </div>
              )}
              {repeatedFailures.map((entry, idx) => (
                <div
                  key={`${entry.command}-${idx}`}
                  className="rounded-lg px-4 py-3 border"
                  style={{
                    backgroundColor: `${theme.colors.surface}70`,
                    borderColor: `${theme.colors.accent}55`,
                  }}
                >
                  <div className="text-sm font-semibold" style={{ color: theme.colors.text }}>
                    {entry.command}
                  </div>
                  <div className="text-xs" style={{ color: theme.colors.textSecondary }}>
                    Failed {entry.count} {entry.count === 1 ? 'time' : 'times'}
                  </div>
                </div>
              ))}
            </div>
```
(The `· {entry.time}` fragment is gone — the real data has no display-time string.)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep -c "error TS"`
Expected: `29` **or fewer** — this change must not *add* errors. If `formatRelativeTime` / `Calendar` were the only newly-unused symbols, leave them for Task 8 (`#1`). Note the exact count.

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: still fails at `tsc -b` (the other 29 errors) — that is expected until Task 8. Confirm the failure list does **not** mention `Dashboard.tsx` line ~1163 or `repeatedFailures`.

- [ ] **Step 6: Docs**

- `docs/IMPROVEMENT_PLAN.md` — new bullet under `## MEDIUM`:
  `- **M-15. ✅ FIXED 2026-09-09.** \`Dashboard.tsx\` rendered a hardcoded \`repeatedFailuresDaily/Weekly\` mock. The backend already computed \`terminalSummary.repeatedFailedCommands\`; the panel is now wired to it with an empty state.`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 8.`.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add frontend/src/pages/Dashboard.tsx docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "fix(frontend): wire Repeated Failures panel to real data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `#3` — enable `helmet` + rate-limit `/auth` and `/api/extension`

**Files:**
- Modify: `backend/app.js`
- Modify: `backend/tests/quickWins.test.js` (append)
- Modify: `docs/IMPROVEMENT_PLAN.md` (M-3), `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

- [ ] **Step 1: Confirm the deps exist**

Run: `cd backend && node -e "require('helmet'); require('express-rate-limit'); console.log('ok')"`
Expected: `ok`. If it throws, STOP (spec assumed they are installed).

- [ ] **Step 2: Add the failing test**

Append to `backend/tests/quickWins.test.js` before the summary:
```js
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && node tests/quickWins.test.js` → FAIL on the three `#3` checks.

- [ ] **Step 4: Implement**

In `backend/app.js`:

(a) after line 6 (`const passport = require('passport');`):
```js
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
```

(b) after `app.set("trust proxy", 1);` (line 12):
```js

// Standard security headers (HSTS, nosniff, no X-Powered-By, frameguard).
// CSP is off by default in helmet — the SPA is served from Vercel, not here.
app.use(helmet());
```

(c) after `app.use(passport.initialize());` (line 35), before the `app.get("/")` health route:
```js

// Per-IP rate limits on the two abuse-prone surfaces. Skipped in tests.
const rlSkip = () => process.env.NODE_ENV === 'test';
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 50, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
}));
app.use('/api/extension', rateLimit({
  windowMs: 60 * 1000, max: 120, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
}));
```

- [ ] **Step 5: Run tests + smoke**

Run: `cd backend && node tests/quickWins.test.js` → PASS.
Run: `cd backend && npm test` → all PASS.
Run the `app.js` smoke → `smoke ok`.
Run a header check:
```
cd backend && JWT_SECRET=smoke MONGO_URI=mongodb://127.0.0.1:1/none node -e "
const http=require('http'); const app=require('./app.js');
const srv=app.listen(0,()=>{
  http.get({port:srv.address().port,path:'/'},r=>{
    console.log('x-powered-by:', r.headers['x-powered-by'] || '(absent - good)');
    console.log('x-content-type-options:', r.headers['x-content-type-options']);
    srv.close(); process.exit(0);
  });
});"
```
Expected: `x-powered-by: (absent - good)` and `x-content-type-options: nosniff`.

- [ ] **Step 6: Docs**

- `docs/IMPROVEMENT_PLAN.md` — `M-3` line → `- **M-3. ✅ FIXED 2026-09-09.** \`helmet()\` is now applied globally; \`express-rate-limit\` guards \`/auth\` (50 / 15 min) and \`/api/extension\` (120 / min), skipped under \`NODE_ENV=test\`.`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 3.`.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/app.js backend/tests/quickWins.test.js docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "feat(security): enable helmet and rate-limit auth + ingest

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: CP1 — interview-doc sweep for `#5`, `#7`, `#6`, `#11`, `#8`, `#3` + checkpoint

**Files:**
- Modify: `CODETRACKR_PROJECT_CONTEXT.md`
- Modify: `docs/interview-preparation/CodeTrackr_Interview_Cheat_Sheet.md`, `CodeTrackr_Interview_QA.md`, `CodeTrackr_Interview_Preparation.md`, `CodeTrackr_Interview_Guide_Condensed.md`, `CodeTrackr_Architecture.md`

**Interfaces:** none (docs). This task has no test cycle — its "test" is a `grep` sweep proving no stale claim remains, plus a human checkpoint.

- [ ] **Step 1: Find every stale claim**

Run each and note the hits:
```
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
grep -rn "no helmet\|no rate limit\|helmet.*not\|not.*wired\|rate limiting anywhere" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "your_jwt_secret\|fallback.*jwt\|JWT_SECRET.*fallback" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "double-join\|double join\|Double-join\|500 (should be 409)\|500 not 409" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "Repeated Failures.*mock\|mock data\|hardcoded.*fail\|fake command" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "status.*ok.*unconditional\|health.*even when\|/health" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
```

- [ ] **Step 2: `CODETRACKR_PROJECT_CONTEXT.md`**

- §3 tech table: change the helmet/rate-limit note from "installed but NOT wired in (M‑3/M‑4)" to "`helmet` wired globally; `express-rate-limit` on `/auth` + `/api/extension` (2026‑09‑09). `express-validator` still unused — ingest uses a pure validator (see §ingest)."
- §security / "still open" list: remove the `JWT_SECRET` fallback item; add to the "fixed" side "app fails fast without `JWT_SECRET`". Remove "no `helmet`, no rate limiting".
- Consistency/races section: "double-join → 500" → "double-join → **409** (2026‑09‑09)".
- Known-issues / frontend: remove "Repeated Failures panel is mock"; note "wired to real `repeatedFailedCommands` (2026‑09‑09)".
- API surface / deploy: add `GET /health` (503 when DB down).

- [ ] **Step 3: `CodeTrackr_Interview_Cheat_Sheet.md`**

- "Security — one page" → **STILL OPEN** list: delete "No `helmet`, no rate limiting anywhere"; delete the `JWT_SECRET` fallback bullet; move any now-fixed item to a short "**FIXED 2026‑09‑09**" sub-list (helmet+rate-limit, fail-fast JWT, 409 on dup join, `/health`, real Repeated-Failures data).
- "Things NOT to claim / traps": delete "The Dashboard 'Repeated Failures' panel is **mock data** — don't demo it as real."
- "Database — one page": `groupmembers` row — "Double-join → unique index → **500** (should be 409)" → "→ **409**".
- Top-40: Q26 "Double-join? → 500 (should be 409)" → "→ **409** (detects `11000`)".

- [ ] **Step 4: `CodeTrackr_Interview_QA.md`**

- Security section: JWT_SECRET answer → past tense ("had a fallback; now fails fast"). helmet/rate-limit answer → "wired 2026‑09‑09".
- The "double-join" Q → 409.
- Any "Repeated Failures is mock" mention → "now real".
- Add a one-line Q/A: **"What's your readiness check?"** → `GET /health` returns 503 when `mongoose.connection.readyState !== 1`; `GET /` stays liveness.

- [ ] **Step 5: `CodeTrackr_Interview_Preparation.md`**

- §3 (tech stack) — the "`helmet`/`express-rate-limit`/`express-validator` installed, NOT used" line → "`helmet` + `express-rate-limit` wired 2026‑09‑09; `express-validator` still unused (ingest validated by a pure module)".
- §7.2 middleware pipeline — add helmet + the two limiters + `/health`.
- §11 (Groups) §11.3 — "Double-join race: unique index catches it → **500** (should be 409)" → "→ **409** (the handler detects `error.code === 11000`)".
- Security section — move JWT fallback + helmet + rate-limit to a "fixed" subsection.
- §16 weaknesses / traps — drop the Repeated-Failures-mock caveat.

- [ ] **Step 6: `CodeTrackr_Interview_Guide_Condensed.md` + `CodeTrackr_Architecture.md`**

- Condensed: weaknesses list — renumber/reword to drop "no helmet / no rate limit", "JWT fallback", "Repeated Failures mock"; the "double-join 500" line → 409.
- Architecture §2.2 — route table: note the central pieces (helmet, limiters, `/health`) in `app.js`'s row. §8 — "Double-join → **500**" → "**409**". §7.1 endpoint table — add `GET /health`.

- [ ] **Step 7: Verify no stale claim remains**

Re-run the Step 1 greps. Every remaining hit must be either (a) in a spec/plan file under `docs/superpowers/` (fine — historical), or (b) explicitly phrased as "was … now …". No bare present-tense stale claim.

- [ ] **Step 8: Full green check**

Run: `cd backend && npm test` → all PASS.
Run: `cd extension && npm test` → all PASS.
Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep -c "error TS"` → note count (~29, unchanged — Task 8 fixes it).

- [ ] **Step 9: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add CODETRACKR_PROJECT_CONTEXT.md docs/interview-preparation/
git commit -m "docs: sync interview docs for quick-wins batch 1 (#5,#7,#6,#11,#8,#3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 10: CHECKPOINT — stop for review**

Report to the user: 6 items done (`#5`, `#7`, `#6`, `#11`, `#8`, `#3`), 7 commits, all suites green, `app.js` smoke + header check pass, docs synced. Wait for approval before Task 8.

---

## Task 8: `#1` — fix the 29 frontend TypeScript errors

**Files:**
- Modify: `frontend/src/pages/Goals.tsx`, `frontend/src/pages/Groups.tsx`, `frontend/src/pages/Profile.tsx`, `frontend/src/pages/Teams.tsx`, `frontend/src/pages/Dashboard.tsx`, `frontend/src/components/TextType.tsx`
- Modify: `docs/IMPROVEMENT_PLAN.md` (M-13), `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

**Interfaces:** none. The deliverable test is `npx tsc -b --noEmit` exiting 0 and `npm run build` exiting 0.

- [ ] **Step 1: Capture the exact error list**

Run: `cd frontend && npx tsc -b --noEmit 2>&1 | grep "error TS" > /tmp/ts-errors.txt; cat /tmp/ts-errors.txt; wc -l /tmp/ts-errors.txt`
Expected: 29 lines. Categorise: `TS6133` (unused — ~20), `TS2322` `string`→`never` (4: `Groups.tsx`, `Profile.tsx`, `Goals.tsx`, `Dashboard.tsx`), `TS7031/7034/7005` implicit-any (5, all `TextType.tsx`).

- [ ] **Step 2: Fix the `TS6133` unused symbols**

For each `TS6133` line, open the file at that line and remove the unused import specifier or the unused declaration:
- `Teams.tsx` — remove `user` (unused destructure from a hook or unused var).
- `Groups.tsx` — remove `user` and `data`.
- `Dashboard.tsx` — remove `formatRelativeTime` and `Calendar` from their imports.
- `Goals.tsx` — remove the 15 unused symbols: `toggleTodo`, `addTodo`, `deleteTodo`, `openTodoModal`, `newTodoText`, `showTodoModal`, `selectedGoal`, `setSelectedGoal`, `handleDateClick`, `getDateIcon`, `getDateColor`, and the icon imports `Trash2`, `Plus`, `Circle`, `CheckCircle`. These are the half-built to-do feature. If a `useState` pair is `[x, setX]` and only one is flagged, check whether the other is used elsewhere; if neither is used, delete the whole `const [x, setX] = useState(...)` line. If `setX` is used inside a now-dead handler you are also deleting, delete both.
  **Do not delete** anything the JSX still references — grep the file for each symbol first: `grep -n "toggleTodo\|addTodo\|..." src/pages/Goals.tsx`. If the JSX references it, the symbol is not actually unused — re-read the tsc error; more likely it is a sibling.
- After each file, re-run `npx tsc -b --noEmit 2>&1 | grep "Goals.tsx"` (etc.) to watch the count drop.

- [ ] **Step 3: Fix the 4 `TS2322` `string`→`never`**

These are almost always `useState([])` inferred as `never[]`, then `setState(['a','b'])`. For each:
- `Groups.tsx:~280` — find the `useState` whose setter receives a `string`; annotate: `useState<string[]>([])`.
- `Profile.tsx:~96` — same pattern; annotate the state or the array literal with its real element type.
- `Goals.tsx` — same.
- `Dashboard.tsx` — same.
Inspect each declaration; use the real element type (`string[]`, `number[]`, or a named interface already in the file). **Never** use `as never`, `as any`, or `@ts-ignore`.

- [ ] **Step 4: Fix the 5 implicit-any in `TextType.tsx`**

- `text`, `onSentenceComplete`, `variableSpeed` destructured props: add a `type TextTypeProps = { text: string | string[]; onSentenceComplete?: (sentence: string, index: number) => void; variableSpeed?: { min: number; max: number }; /* keep existing props */ }` and type the component `({ ... }: TextTypeProps)`. Read the component body to get the real shapes; match what the callers in the codebase pass (`grep -rn "TextType" src/`).
- `timeout` var (`TS7034`/`TS7005`): declare it `let timeout: ReturnType<typeof setTimeout> | null = null;` (or `useRef<ReturnType<typeof setTimeout> | null>(null)` if it is a ref).

- [ ] **Step 5: Verify typecheck is clean**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Verify the build**

Run: `cd frontend && npm run build`
Expected: exit 0; `dist/` produced. Note any Vite warnings but they are not failures.

- [ ] **Step 7: Docs**

- `docs/IMPROVEMENT_PLAN.md` — `M-13` → `- **M-13. ✅ FIXED 2026-09-09.** 29 \`tsc -b\` errors resolved (dead imports/vars + 4 \`never[]\` state annotations + 5 implicit-any in \`TextType.tsx\`). \`npm run build\` is green. The half-built to-do scaffolding in \`Goals.tsx\` was removed (see deferred #14).` Also update the "New finding — the frontend does not compile" callout near the top to `— ✅ FIXED 2026-09-09`.
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 1.`.

- [ ] **Step 8: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add frontend/src docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "fix(frontend): resolve 29 TypeScript errors, unblock the build

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: `#2` — GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm ci
        working-directory: backend
      - run: npm test
        working-directory: backend

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
        working-directory: frontend
      - run: npm run build
        working-directory: frontend

  extension:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm ci
        working-directory: extension
      - run: npm test
        working-directory: extension
```
(No `env:` block — the backend suite runs only pure/source-scan tests and never loads `app.js`. Task 14 adds an `app.js` import-smoke step with `JWT_SECRET`.)

- [ ] **Step 2: Validate the YAML locally**

Run: `node -e "const y=require('js-yaml'); const d=y.load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log(Object.keys(d.jobs))"`
Expected: `[ 'backend', 'frontend', 'extension' ]`.
If `js-yaml` is not installed, run `python -c "import yaml,sys; print(list(yaml.safe_load(open('.github/workflows/ci.yml'))['jobs']))"`.
If neither is available, eyeball for tab characters: `grep -nP "\t" .github/workflows/ci.yml` must return nothing.

- [ ] **Step 3: Sanity-check that the three commands work locally**

Run: `cd backend && npm ci --dry-run 2>&1 | tail -1` (confirms the lockfile resolves — do NOT actually run `npm ci`, it wipes `node_modules`).
Run: `cd extension && npm test` → PASS.
The frontend build was verified green in Task 8.

- [ ] **Step 4: Docs**

- `docs/IMPROVEMENT_PLAN.md` — new bullet under `## LOW`:
  `- **L-9. ✅ FIXED 2026-09-09.** Added \`.github/workflows/ci.yml\` — backend + extension \`npm test\` and \`frontend npm run build\` on every push / PR. First real run is on the next push.`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 2.`.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add .github/workflows/ci.yml docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "ci: add GitHub Actions workflow (backend + extension tests, frontend build)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: CP2 — interview-doc sweep for `#1` + `#2` + checkpoint

**Files:**
- Modify: `CODETRACKR_PROJECT_CONTEXT.md`, and the 5 interview docs

- [ ] **Step 1: Find stale "build fails" / "no CI" claims**

```
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
grep -rn "29 .*error\|tsc -b.*fail\|build is red\|does not compile\|frontend build.*fail\|npm run build.*fail" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "no CI\|No CI\|nothing enforced\|no automated\|no \.github" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
```

- [ ] **Step 2: Update every hit**

For each doc (`CONTEXT.md`, `Cheat_Sheet.md`, `QA.md`, `Preparation.md` §3/§16/§17, `Guide_Condensed.md`, `Architecture.md` §10):
- "`tsc -b` has 29 pre-existing errors / build fails (M-13)" → "build is green as of 2026‑09‑09; CI keeps it that way".
- "No CI / no `.github/workflows`" → "GitHub Actions: backend + extension tests, frontend build on every push (2026‑09‑09)".
- `Cheat_Sheet.md` Q39 "Frontend build? → **fails**" → "→ green (was 29 `tsc -b` errors, fixed 2026‑09‑09)".
- `Cheat_Sheet.md` traps "Don't claim the frontend builds" → delete (it now does).

- [ ] **Step 3: Verify**

Re-run Step 1 greps — every remaining hit is historical (spec/plan files) or "was…now…".

- [ ] **Step 4: Checkpoint green check**

Run: `cd backend && npm test` → PASS. `cd extension && npm test` → PASS. `cd frontend && npm run build` → exit 0.

- [ ] **Step 5: Commit + CHECKPOINT**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add CODETRACKR_PROJECT_CONTEXT.md docs/interview-preparation/
git commit -m "docs: sync interview docs for green build + CI (#1, #2)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
Report: build green, CI added, docs synced. Wait for approval before Task 11.

---

## Task 11: `#4` — central error handler; stop leaking `error.message`

**Files:**
- Modify: `backend/app.js` (add handler after the route mounts, before `module.exports`)
- Modify: `backend/routes/analytics.js`, `auth.js`, `extension.js`, `goals.js`, `groups.js`, `leaderboard.js`, `metrics.js`, `notifications.js`, `team.js`, `user.js`
- Modify: `backend/tests/quickWins.test.js` (append)
- Modify: `docs/IMPROVEMENT_PLAN.md` (M-10), `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

- [ ] **Step 1: Add the failing test**

Append to `backend/tests/quickWins.test.js` before the summary:
```js
console.log('\nquick-wins: central error handler (#4)');
check('app.js registers a 4-arg error handler after the routers', () => {
  assert.ok(/app\.use\(\s*\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)\s*=>/.test(appSrc),
    'no (err, req, res, next) handler');
  const handlerIdx = appSrc.search(/app\.use\(\s*\(\s*err\s*,/);
  const lastRouteIdx = appSrc.lastIndexOf("app.use('/auth'");
  assert.ok(handlerIdx > lastRouteIdx, 'error handler is not after the route mounts');
});
check('no route echoes error.message / err.message to the client', () => {
  const routesDir = path.join(__dirname, '..', 'routes');
  const offenders = [];
  for (const f of fs.readdirSync(routesDir)) {
    if (!f.endsWith('.js')) continue;
    const s = fs.readFileSync(path.join(routesDir, f), 'utf8');
    if (/error:\s*(error|err)\.message/.test(s) || /message:\s*(error|err)\.message/.test(s)) {
      offenders.push(f);
    }
  }
  assert.strictEqual(offenders.length, 0, `still leak error.message: ${offenders.join(', ')}`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node tests/quickWins.test.js`
Expected: FAIL — no handler, ~20 files leak `error.message`.

- [ ] **Step 3: Add the handler to `app.js`**

In `backend/app.js`, after the last `app.use('/auth', authRoutes);` line and before `const PORT = ...`:
```js

// Central error handler — one place that logs the full error with a short
// correlation id and returns a generic body. Routes call `next(err)`.
app.use((err, req, res, next) => {
  const id = Math.random().toString(36).slice(2, 10);
  console.error(`[err:${id}] ${req.method} ${req.originalUrl}`, err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : (err.publicMessage || 'Request failed'), id });
});
```

- [ ] **Step 4: Convert the route catch-tails, one file at a time**

For **each** of the 10 route files, apply this transformation and re-run `node tests/quickWins.test.js` after each so you catch a mistake immediately:

- Find every `catch` block whose body is *only* a `console.error(...)` (optional) followed by
  `res.status(500).json({ ... error/message: (error|err).message ... })`.
- Replace the whole block body with `return next(error);` (match the caught variable name — some files use `err`).
- **Leave untouched:** any `res.status(400|401|403|404|409)` inside the handler body (deliberate), and any `{ message: '...' }` with a **string literal** (not `.message`).
- If a `catch` does extra work (cleanup, a specific domain response), keep that work and change only the generic 500 tail to `next(error)`.

Reference — `routes/extension.js` `/track` catch becomes:
```js
    } catch (error) {
        return next(error);
    }
```
and the handler signature gains `next`: `router.post('/track', verifyApiKey, async (req, res, next) => {`.
Do the same for `/track/batch`. (Every converted handler needs `next` in its signature — add it.)

- [ ] **Step 5: Run the full suite**

Run: `cd backend && node tests/quickWins.test.js` → PASS (handler present, 0 leak offenders).
Run: `cd backend && npm test` → all PASS. Pay attention to `routeGuards.test.js` and `ingestWiring.test.js` — they scan the same route files; if either regexes for a pattern you changed, fix the test's expectation only if the behaviour is genuinely still correct (it should be — you only touched `catch` tails).

- [ ] **Step 6: Smoke**

Run the `app.js` smoke → `smoke ok`.
Run an error-path check:
```
cd backend && JWT_SECRET=smoke MONGO_URI=mongodb://127.0.0.1:1/none node -e "
const http=require('http'); const app=require('./app.js');
app.get('/__boom',()=>{ throw new Error('secret internal detail'); });
const srv=app.listen(0,()=>{
  http.get({port:srv.address().port,path:'/__boom'},r=>{
    let b=''; r.on('data',d=>b+=d); r.on('end',()=>{
      console.log('status', r.statusCode, 'body', b);
      if (/secret internal detail/.test(b)) { console.error('LEAK'); process.exit(1); }
      srv.close(); process.exit(0);
    });
  });
});"
```
Expected: `status 500 body {"error":"Internal server error","id":"..."}`, no leak.

- [ ] **Step 7: Docs**

- `docs/IMPROVEMENT_PLAN.md` — `M-10` → `- **M-10. ✅ FIXED 2026-09-09.** Added a central \`(err,req,res,next)\` handler that logs the full error with a correlation id and returns \`{error, id}\`. All ~20 route \`catch\` tails that echoed \`error.message\` now \`next(err)\`. \`try/catch\` wrappers kept (Express-5 auto-forward cleanup deferred).`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 4.`.

- [ ] **Step 8: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/app.js backend/routes/*.js backend/tests/quickWins.test.js docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "refactor(backend): central error handler, stop leaking error.message

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: CP3 — interview-doc sweep for `#4` + checkpoint

**Files:** `CODETRACKR_PROJECT_CONTEXT.md`, the 5 interview docs.

- [ ] **Step 1: Find stale claims**

```
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
grep -rn "echo.*err.message\|echoes error.message\|leak.*internal\|no central error\|no error-handling middleware\|per-route try/catch\|500 {message, error" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
```

- [ ] **Step 2: Update**

- `CONTEXT.md` §backend / §security — "every route try/catches and echoes `error.message`" → "central error handler with correlation ids (2026‑09‑09); routes `next(err)`".
- `Cheat_Sheet.md` "Security — one page": "Errors echo `err.message` (internal leak). No central error handler." → move to the FIXED sub-list.
- `QA.md` "Error handling?" answer → rewrite: "one central `(err,req,res,next)` handler, correlation id, generic body; routes forward with `next(err)`."
- `Preparation.md` §7.2 — replace the "per-route `try/catch` → `500 {message, error}`" description.
- `Architecture.md` §2.2 — `routes/*.js` row: "`try/catch` → `500 {message, error}`" → "`try/catch` → `next(err)` → central handler → `500 {error, id}`".
- `Guide_Condensed.md` — the error-handling line + weaknesses list.

- [ ] **Step 3: Verify + green check**

Re-run Step 1 grep (only historical/was-now hits remain).
Run: `cd backend && npm test` → PASS.

- [ ] **Step 4: Commit + CHECKPOINT**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add CODETRACKR_PROJECT_CONTEXT.md docs/interview-preparation/
git commit -m "docs: sync interview docs for central error handler (#4)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
Report: `#4` done, ~20 files converted, leak-check + error-path smoke pass. Wait for approval before Task 13.

---

## Task 13: `#12` — bounds-check the ingest payload (pure validator)

**Files:**
- Create: `backend/services/ingestValidation.js`
- Create: `backend/tests/ingestValidation.test.js`
- Modify: `backend/routes/extension.js` (`/track` and `/track/batch`)
- Modify: `backend/tests/ingestWiring.test.js` (append one scan)
- Modify: `backend/package.json` (`test` script)
- Modify: `docs/IMPROVEMENT_PLAN.md` (M-4), `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

**Interfaces:**
- Produces: `validateIngestPayload(body) → { ok: true, value: {...} } | { ok: false, errors: string[] }`
  - `value` echoes the accepted primitive fields (`duration` as Number, `fileName`, `language`, `projectName`, `timestamp` as the original string or undefined).
  - Consumed by `routes/extension.js` `/track` (whole body) and `/track/batch` (each element).

- [ ] **Step 1: Write the failing unit tests**

Create `backend/tests/ingestValidation.test.js`:
```js
const assert = require('assert');
const { validateIngestPayload } = require('../services/ingestValidation');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const base = { fileName: 'app.js', language: 'javascript', duration: 60 };
const okCases = [
  ['minimal valid', base],
  ['duration 1', { ...base, duration: 1 }],
  ['duration 3600', { ...base, duration: 3600 }],
  ['timestamp now', { ...base, timestamp: new Date().toISOString() }],
  ['timestamp 23h ago', { ...base, timestamp: new Date(Date.now() - 23 * 3600e3).toISOString() }],
  ['projectName present', { ...base, projectName: 'CodeTrackr' }],
];
const badCases = [
  ['duration 0', { ...base, duration: 0 }],
  ['duration -5', { ...base, duration: -5 }],
  ['duration 3601', { ...base, duration: 3601 }],
  ['duration 1e12', { ...base, duration: 1e12 }],
  ['duration NaN', { ...base, duration: 'abc' }],
  ['missing fileName', { language: 'js', duration: 10 }],
  ['missing language', { fileName: 'a.js', duration: 10 }],
  ['fileName 300 chars', { ...base, fileName: 'a'.repeat(300) }],
  ['language 100 chars', { ...base, language: 'x'.repeat(100) }],
  ['timestamp +2h (future)', { ...base, timestamp: new Date(Date.now() + 2 * 3600e3).toISOString() }],
  ['timestamp 2 days ago', { ...base, timestamp: new Date(Date.now() - 48 * 3600e3).toISOString() }],
  ['timestamp garbage', { ...base, timestamp: 'not-a-date' }],
];

console.log('\ningestValidation: accepts valid payloads');
for (const [n, c] of okCases) check(n, () => {
  const r = validateIngestPayload(c);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});
console.log('\ningestValidation: rejects out-of-bounds payloads');
for (const [n, c] of badCases) check(n, () => {
  const r = validateIngestPayload(c);
  assert.strictEqual(r.ok, false, `expected reject, got ok for ${n}`);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node tests/ingestValidation.test.js`
Expected: FAIL — `Cannot find module '../services/ingestValidation'`.

- [ ] **Step 3: Implement the validator**

Create `backend/services/ingestValidation.js`:
```js
'use strict';

const MAX_DURATION = 3600;        // 1 hour per flush is already generous
const FUTURE_SKEW_MS = 60 * 1000; // allow 60s of clock skew
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;

function isNonEmptyString(v, max) {
  return typeof v === 'string' && v.trim().length >= 1 && v.length <= max;
}

/**
 * Bounds-check one ingest payload. Pure — no I/O.
 * @returns {{ok:true,value:object} | {ok:false,errors:string[]}}
 */
function validateIngestPayload(body) {
  const errors = [];
  const b = body || {};

  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) {
    errors.push(`duration must be a number in (0, ${MAX_DURATION}]`);
  }
  if (!isNonEmptyString(b.fileName, 255)) errors.push('fileName must be a string of 1..255 chars');
  if (!isNonEmptyString(b.language, 64)) errors.push('language must be a string of 1..64 chars');
  if (b.projectName !== undefined && !isNonEmptyString(b.projectName, 128)) {
    errors.push('projectName, if present, must be a string of 1..128 chars');
  }

  if (b.timestamp !== undefined) {
    const t = new Date(b.timestamp).getTime();
    if (!Number.isFinite(t)) {
      errors.push('timestamp must be a parseable date');
    } else if (t > Date.now() + FUTURE_SKEW_MS) {
      errors.push('timestamp must not be in the future');
    } else if (t < Date.now() - MAX_BACKDATE_MS) {
      errors.push('timestamp must be within the last 24h');
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      duration,
      fileName: b.fileName,
      language: b.language,
      projectName: b.projectName,
      timestamp: b.timestamp,
    },
  };
}

module.exports = { validateIngestPayload, MAX_DURATION };
```

- [ ] **Step 4: Run the unit tests**

Run: `cd backend && node tests/ingestValidation.test.js`
Expected: all PASS (6 ok + 12 bad).

- [ ] **Step 5: Wire it into `/track`**

In `backend/routes/extension.js`:
- Add to the require block near the top: `const { validateIngestPayload } = require('../services/ingestValidation');`
- In `/track`, **replace** the existing check:
  ```js
        // Validate required fields
        if (!fileName || !language || !duration) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: fileName, language, and duration are required'
            });
        }
  ```
  with:
  ```js
        const v = validateIngestPayload(req.body);
        if (!v.ok) {
            return res.status(400).json({ success: false, message: 'Invalid activity payload', details: v.errors });
        }
  ```
  (Keep the destructure above it; `duration` is still used via `Number(duration)` below — that is fine, `v` has already bounded it.)

- [ ] **Step 6: Wire it into `/track/batch`**

In `/track/batch`, right after the `Array.isArray(activities)` check, add:
```js
        for (let i = 0; i < activities.length; i++) {
            const v = validateIngestPayload(activities[i]);
            if (!v.ok) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid activity at index ${i}`,
                    details: v.errors,
                });
            }
        }
```
(The batch stays all-or-nothing, matching its existing write semantics.)

- [ ] **Step 7: Add the wiring scan**

Append to `backend/tests/ingestWiring.test.js` (before its final summary):
```js
check('/track validates the payload with ingestValidation', () => {
  assert.ok(/require\(['"]\.\.\/services\/ingestValidation['"]\)/.test(src), 'validator not required');
  assert.ok(/validateIngestPayload\(req\.body\)/.test(src), '/track does not call the validator');
  assert.ok(/validateIngestPayload\(activities\[i\]\)/.test(src), '/track/batch does not validate each element');
});
```

- [ ] **Step 8: Wire the new suite into `npm test`**

In `backend/package.json`, append ` && node tests/ingestValidation.test.js` to the `test` script.

- [ ] **Step 9: Run everything**

Run: `cd backend && npm test`
Expected: all PASS, including `ingestValidation` and the updated `ingestWiring`.
Run the `app.js` smoke → `smoke ok`.

- [ ] **Step 10: Docs**

- `docs/IMPROVEMENT_PLAN.md` — `M-4` → `- **M-4. ✅ FIXED 2026-09-09 (partial).** Ingest is bounds-checked by a pure \`validateIngestPayload\`: \`duration\` in \`(0, 3600]\` (fixes the \`0\` false-reject and the \`1e12\` accept), \`fileName\`/\`language\`/\`projectName\` length caps, \`timestamp\` must be within \`[now-24h, now+60s]\`. \`timestamp\` is still client-supplied but no longer unbounded. Not \`express-validator\` — a pure module is more testable.`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 12.`; note the `express-validator`→pure-module deviation in one line under the heading.

- [ ] **Step 11: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/services/ingestValidation.js backend/tests/ingestValidation.test.js backend/tests/ingestWiring.test.js backend/routes/extension.js backend/package.json docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "feat(security): bounds-check the ingest payload

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: `#15` — serverless-safe bootstrap + external cron trigger

**Files:**
- Modify: `backend/app.js` (guard `initScheduler()` + `app.listen()`; mount `/api/internal`)
- Create: `backend/routes/internal.js`
- Modify: `backend/models/Notification.js` (index)
- Modify: `backend/tests/quickWins.test.js` (append)
- Modify: `.github/workflows/ci.yml` (add the app-import smoke to the backend job)
- Modify: `docs/IMPROVEMENT_PLAN.md` (H-13), `docs/interview-preparation/CodeTrackr_Quick_Wins.md`

**Interfaces:**
- Consumes: `notificationScheduler` exports `checkUpcomingDeadlines`, `checkOverdueGoals`, `rollupDaily` (all already exported at `services/notificationScheduler.js:114`).
- Produces: `POST /api/internal/run-notifications` and `POST /api/internal/run-rollup`, both requiring header `x-internal-secret: <process.env.INTERNAL_CRON_SECRET>`; 404 when the secret is unset or wrong.

- [ ] **Step 1: Add the failing test**

Append to `backend/tests/quickWins.test.js` before the summary:
```js
console.log('\nquick-wins: serverless-safe bootstrap (#15)');
check('initScheduler and app.listen are guarded by require.main === module', () => {
  assert.ok(/require\.main\s*===\s*module/.test(appSrc), 'no require.main guard');
  const guardIdx = appSrc.indexOf('require.main === module');
  const tail = appSrc.slice(guardIdx);
  assert.ok(/initScheduler\(\)/.test(tail), 'initScheduler() not inside the guard');
  assert.ok(/app\.listen\(/.test(tail), 'app.listen() not inside the guard');
  // and NOT called at top level
  const head = appSrc.slice(0, guardIdx);
  assert.ok(!/^\s*initScheduler\(\);/m.test(head), 'initScheduler() still called at top level');
});
check('app.js mounts /api/internal', () => {
  assert.ok(/app\.use\(\s*['"]\/api\/internal['"]/.test(appSrc), '/api/internal not mounted');
});
const internalSrc = read('routes/internal.js');
check('internal routes require a shared secret', () => {
  assert.ok(/INTERNAL_CRON_SECRET/.test(internalSrc), 'no INTERNAL_CRON_SECRET check');
  assert.ok(/run-notifications/.test(internalSrc) && /run-rollup/.test(internalSrc), 'missing routes');
  assert.ok(/status\(404\)/.test(internalSrc), 'unauthenticated hit should 404, not 401');
});
check('Notification model indexes {goalId, type}', () => {
  const n = read('models/Notification.js');
  assert.ok(/index\(\s*\{\s*goalId:\s*1,\s*type:\s*1\s*\}/.test(n), 'missing {goalId:1,type:1} index');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node tests/quickWins.test.js` → FAIL on the four `#15` checks (`routes/internal.js` missing → the `read` throws; wrap the whole `#15` block is fine, the harness catches it per-check — but the top-level `read('routes/internal.js')` runs outside a `check`. Move it inside: change the test to `const internalSrc = fs.existsSync(path.join(__dirname,'..','routes','internal.js')) ? read('routes/internal.js') : '';`).

- [ ] **Step 3: Create `routes/internal.js`**

```js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  checkUpcomingDeadlines,
  checkOverdueGoals,
  rollupDaily,
} = require('../services/notificationScheduler');

// Constant-time secret check. 404 (not 401) so the route isn't discoverable.
function requireCronSecret(req, res, next) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  const got = req.get('x-internal-secret') || '';
  if (!expected) return res.status(404).json({ error: 'Not found' });
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

router.post('/run-notifications', requireCronSecret, async (req, res, next) => {
  try {
    await checkUpcomingDeadlines();
    await checkOverdueGoals();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/run-rollup', requireCronSecret, async (req, res, next) => {
  try {
    const r = await rollupDaily({ apply: true, beforeDays: 2 });
    res.json({ ok: true, wrote: r && r.wrote });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 4: Mount it + guard the bootstrap in `app.js`**

- Add to the route requires block (near line 61): `const internalRoutes = require('./routes/internal');`
- Add to the route mounts (near line 73, after `/auth`): `app.use('/api/internal', internalRoutes);`
- Replace lines 78-84:
  ```js
  // Initialize notification scheduler
  const { initScheduler } = require('./services/notificationScheduler');
  initScheduler();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
  ```
  with:
  ```js
  // Only start a server + in-process scheduler when run directly (`node app.js`).
  // Under a serverless handler this module is `require`d, and the schedule is
  // driven externally via POST /api/internal/run-* (see IMPROVEMENT_PLAN H-13).
  if (require.main === module) {
    const { initScheduler } = require('./services/notificationScheduler');
    initScheduler();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  }
  ```

- [ ] **Step 5: Add the Notification index**

In `backend/models/Notification.js`, before `module.exports`:
```js

// Supports checkOverdueGoals()'s per-goal `findOne({ goalId, type })`.
notificationSchema.index({ goalId: 1, type: 1 });
```

- [ ] **Step 6: Run tests + smoke**

Run: `cd backend && node tests/quickWins.test.js` → PASS.
Run: `cd backend && npm test` → all PASS.
Run: `cd backend && JWT_SECRET=smoke MONGO_URI=mongodb://127.0.0.1:1/none node -e "const a=require('./app.js'); if(typeof a!=='function') throw 0; setTimeout(()=>{console.log('no server started, smoke ok'); process.exit(0)}, 300)"`
Expected: `no server started, smoke ok` and the process exits on its own (proves `app.listen` did not run).

- [ ] **Step 7: Add the app-import smoke to CI**

In `.github/workflows/ci.yml`, in the `backend` job, after the `npm test` step:
```yaml
      - name: app.js imports without side effects
        working-directory: backend
        env:
          JWT_SECRET: ci-placeholder
          MONGO_URI: mongodb://127.0.0.1:1/none
        run: node -e "const a=require('./app.js'); if(typeof a!=='function'){process.exit(1)} setTimeout(()=>process.exit(0),500)"
```

- [ ] **Step 8: Docs**

- `docs/IMPROVEMENT_PLAN.md` — `### H-13` → append to the heading ` — ✅ FIXED 2026-09-09` and add a line: `**Done:** \`initScheduler()\` + \`app.listen()\` guarded by \`require.main === module\`; \`POST /api/internal/run-notifications\` + \`/run-rollup\` behind \`INTERNAL_CRON_SECRET\` (404 when unset/wrong); \`{goalId:1,type:1}\` index added. Operator wires an external scheduler (see rollout).`
- `docs/interview-preparation/CodeTrackr_Quick_Wins.md` — append ` — ✅ DONE 2026-09-09` to `## 15.`.

- [ ] **Step 9: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add backend/app.js backend/routes/internal.js backend/models/Notification.js backend/tests/quickWins.test.js .github/workflows/ci.yml docs/IMPROVEMENT_PLAN.md docs/interview-preparation/CodeTrackr_Quick_Wins.md
git commit -m "refactor(backend): serverless-safe bootstrap + external cron trigger

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: CP4 — final doc sweep + session log + memory + verification

**Files:**
- Modify: `CODETRACKR_PROJECT_CONTEXT.md`, the 5 interview docs (for `#12`, `#15`)
- Modify: `docs/SESSION-LOG-2026-08-27.md`
- Modify: `memory/codetrackr-overview.md`, `memory/MEMORY.md`
- Modify: `docs/superpowers/plans/2026-09-09-quick-wins-tier1-security.md` (tick boxes + STATUS banner)

- [ ] **Step 1: Interview-doc sweep for `#12` + `#15`**

```
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
grep -rn "no.*validation on ingest\|duration: 1e12\|duration:0 wrongly\|billion-second\|no real validation" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "node-cron.*serverless\|broken on serverless\|H-13\|cron.*never fires\|scheduler assumes" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
grep -rn "app.listen.*unconditional\|initScheduler.*unconditional" docs/interview-preparation/ CODETRACKR_PROJECT_CONTEXT.md
```
Update every hit:
- ingest validation → "bounds-checked by `validateIngestPayload` (2026‑09‑09): duration (0,3600], length caps, timestamp within 24h. Still no per-key rate limit beyond the `/api/extension` IP limiter."
- `Cheat_Sheet.md` "cheat the leaderboard?" Q → "harder now: duration capped at 3600/flush and the ingest route is IP-rate-limited; still no idempotency key or per-key quota (see #10, deferred)."
- H-13 / serverless-cron everywhere → "fixed 2026‑09‑09: `require.main` guard + external trigger route".
- `Architecture.md` §1 box, §2.2, §10 (the whole serverless paragraph), §7.1 endpoint table (`/api/internal/*`, `/health`).

- [ ] **Step 2: Session log**

Append to `docs/SESSION-LOG-2026-08-27.md`:
```markdown

## 10. Quick-wins batch — Tier 1 + security (2026-09-09)

11 items from `docs/interview-preparation/CodeTrackr_Quick_Wins.md`, one commit each,
spec + plan under `docs/superpowers/`:

- #5 timestamp index — already shipped in the DB-write batch, marked done.
- #7 `JWT_SECRET` fail-fast; dropped the `'your_jwt_secret'` fallback (M-9).
- #6 duplicate group join → 409 not 500 (M-14).
- #11 `GET /health` readiness — 503 when Mongo down (L-8).
- #8 "Repeated Failures" panel wired to real `repeatedFailedCommands` (M-15).
- #3 `helmet` + `express-rate-limit` on `/auth` and `/api/extension` (M-3).
- #1 fixed 29 frontend `tsc -b` errors; `npm run build` green (M-13).
- #2 `.github/workflows/ci.yml` — backend/extension tests + frontend build (L-9).
- #4 central error handler + correlation id; ~20 route catch-tails → `next(err)` (M-10).
- #12 pure `validateIngestPayload` — duration/length/timestamp bounds (M-4).
- #15 `require.main` bootstrap guard + `POST /api/internal/run-*` behind `INTERNAL_CRON_SECRET`;
  `{goalId:1,type:1}` index (H-13).

New tests: `backend/tests/quickWins.test.js` (source scans), `backend/tests/ingestValidation.test.js`
(pure). Backend suites 10 → 12. Deferred: #9, #10, #13, #14, Tier 3.

**Operator TODO after merge:** set `JWT_SECRET` + `INTERNAL_CRON_SECRET` in Render; wire an
external scheduler to `POST /api/internal/run-notifications` (hourly) + `/run-rollup` (daily)
with `x-internal-secret`; point the platform health check at `/health`; push for CI.
```

- [ ] **Step 3: Memory**

- `memory/codetrackr-overview.md` — update the "honest findings" line: `helmet`/rate-limit now wired, build green, CI added, central error handler, ingest bounded, serverless-safe. Keep the still-true ones (plaintext API key, O(n) leaderboard, no idempotency key, insights not cached).
- `memory/MEMORY.md` — if the one-line pointer mentions "broken frontend build" or "no CI", update it.

- [ ] **Step 4: Full verification**

Run and confirm all green:
```
cd backend && npm test
cd extension && npm test
cd frontend && npm run build
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main" && git status
```
Expected: backend 12 suites PASS, extension 2 PASS, frontend build exit 0, working tree clean except this plan file.

- [ ] **Step 5: Tick the plan + STATUS banner**

In this plan file, check every `- [ ]` box that is done and add at the top under the header:
`> **STATUS: COMPLETE 2026-09-09** — all 11 items shipped, 15 commits, all suites green.`

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\soham\Downloads\codetrackr\CodeTrackr-main"
git add CODETRACKR_PROJECT_CONTEXT.md docs/interview-preparation/ docs/SESSION-LOG-2026-08-27.md docs/superpowers/plans/2026-09-09-quick-wins-tier1-security.md memory/
git commit -m "docs: sync interview docs + session log for quick-wins batch (#12, #15)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: FINAL CHECKPOINT**

Report to the user: 11 items done, 15 commits, full suite green, doc + memory synced, operator TODO list surfaced. Then invoke `superpowers:finishing-a-development-branch` to decide how to integrate (the branch already has unrelated prior work, so likely "keep as-is" or a squash-merge decision is the user's).

---

## Self-Review

**Spec coverage:**
- Spec §4 items #5/#7/#6/#11/#8/#3/#1/#2/#4/#12/#15 → Tasks 1/2/3/4/5/6/8/9/11/13/14. ✅
- Spec §5 checkpoints CP1/CP2/CP3/CP4 → Tasks 7/10/12/15. ✅
- Spec §3 test strategy (source-scan + pure unit) → `quickWins.test.js` (Tasks 2,3,4,6,11,14), `ingestValidation.test.js` (Task 13). ✅
- Spec §6 doc matrix → folded into each task's "Docs" step + the four sweep tasks. ✅
- Spec §7 rollout → surfaced in Task 15 Step 2 (session log) and the final checkpoint. ✅
- Spec §2 "left alone" files → Global Constraints. ✅
- Spec "record #9 preference" → not a code task; it is already in the spec §1. No plan task needed. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 8 (#1) intentionally
describes a *procedure* rather than 29 literal diffs — the errors are machine-enumerated in Step 1
and each fix rule is explicit; this is the correct level for a mechanical batch. Task 11 (#4) same
— the transformation rule is exact and the zero-leak test is the gate.

**Type consistency:**
- `validateIngestPayload(body) → {ok, value|errors}` — defined in Task 13 Step 3, consumed in
  Steps 5-6 and the Task 13 interface block. Consistent.
- `check(name, fn)` / `read(...)` / `appSrc` — defined in Task 2 Step 1, reused verbatim in
  Tasks 3, 4, 6, 11, 14. Consistent (Task 14 Step 2 notes the `routes/internal.js` existence
  guard so `read` doesn't throw outside a `check`).
- `requireCronSecret`, `/run-notifications`, `/run-rollup` — Task 14, consistent between the
  test (Step 1), the implementation (Step 3), and the interface block.
- Commit message trailer identical across all tasks. ✅
