# Design — Quick Wins: Tier 1 + Security Batch

**Date:** 2026-09-09
**Branch:** `feat/security-and-insights`
**Status:** approved scope/order; spec under review
**Source list:** `docs/interview-preparation/CodeTrackr_Quick_Wins.md`
**Predecessor:** `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md` (bucketing, sparse docs, DailySummary rollup — already shipped)

---

## 1. Goal

Close the 11 highest-value / lowest-risk items from the Quick Wins list in one coordinated
campaign: fix the things that would embarrass a code walkthrough, wire the security
middleware that is already a dependency, and make the app serverless-honest. Every item
lands as its own commit with a paper-trail entry in `docs/IMPROVEMENT_PLAN.md` — the paper
trail is itself an interview artifact.

### Non-goals (deferred to a follow-up spec)

- **#9** `UserStats` leaderboard rollup — *decision recorded:* live running-total, `$inc` on
  ingest, backfill script, not the `dailysummaries` repoint.
- **#10** idempotency key on ingest.
- **#13** React Query on the dashboard.
- **#14** goal completion + persisted to-dos. (Note: #1 deletes the half-built to-do
  scaffolding in `Goals.tsx`; #14 re-adds it properly.)
- All of **Tier 3** (#16–#25), including `supertest` + `mongodb-memory-server` (#24).

### Delivery constraints

- Code + tests + doc updates on `feat/security-and-insights`. All existing suites stay green.
- **The operator (not this campaign) does:** `git push` (so CI runs), set `JWT_SECRET` and
  `INTERNAL_CRON_SECRET` in Render, wire an external scheduler to hit the new internal
  notifications route, point Render's health check at `/health`.
- No `vsce` publish (no extension code changes in this batch).

---

## 2. Current-state facts (verified 2026-09-09)

| Fact | Evidence |
|---|---|
| `{userId:1,timestamp:-1}` index **already exists**; `date` field/index gone | `backend/models/Activity.js:116` |
| No `.github/workflows/` | `ls` → absent |
| `helmet` / `express-rate-limit` in `package.json`, **zero `require`/`use`** | `grep` `backend/app.js` |
| `JWT_SECRET || 'your_jwt_secret'` in 3 places | `middleware/auth.js:87`, `routes/auth.js:23`, `routes/auth.js:54` |
| Group join `catch` → `res.status(500)` on any error incl. `11000` | `routes/groups.js:251-254` |
| `app.get("/")` returns `{status:"ok"}` unconditionally; no `/health` | `app.js:38` |
| `initScheduler()` + `app.listen()` run unconditionally at module load | `app.js:80,82` |
| `notificationScheduler` runs 2 crons (`0 * * * *`, `30 3 * * *`) + immediate sweep | `services/notificationScheduler.js:90-112` |
| Serverless entry imports `../app` (which starts a server + scheduler as a side effect) | `api/index.js` |
| `Dashboard.tsx` renders hardcoded `repeatedFailuresDaily/Weekly`; real data in `terminalSummary.repeatedFailedCommands` (already `[]` in the object) | `frontend/src/pages/Dashboard.tsx:199,220,228` |
| `frontend` `tsc -b` → **29 errors**: 20× TS6133 unused, 4× TS2322 `string`→`never`, 5× implicit-any in `TextType.tsx` | `npx tsc -b --noEmit` |
| `ingest` handler: `/track` + `/track/batch` (`verifyApiKey`), validation is only `if(!fileName||!language||!duration)` | `routes/extension.js:131,194` |
| **No test loads `app.js` or hits a route** — all suites are pure-function or static source scans | `grep` `backend/tests/` |
| 10 backend suites + 2 extension suites currently green | `backend/package.json` `test` |

---

## 3. Test strategy for this batch

The repo has **no runtime/integration harness** (that is deferred #24). This batch keeps the
existing philosophy and adds coverage in two existing styles:

1. **Static source-scan assertions** (like `tests/routeGuards.test.js` / `tests/ingestWiring.test.js`)
   — read the source of `app.js` / route files and assert the wiring is present. Used for
   #3, #4, #7, #11, #15. Cheap, deterministic, and they *stay* as regression guards (e.g.
   "fails if `helmet` is ever removed").
2. **Pure unit tests** for extracted logic. Used for #12 — the ingest bounds become a pure
   `validateIngestPayload(body)` module that is unit-tested directly, and `express-validator`
   is the thin adapter in the route.

New file: `backend/tests/quickWins.test.js` (source-scan assertions for #3/#4/#7/#11/#15,
plus a scan for #6). New file: `backend/tests/ingestValidation.test.js` (pure, for #12).
Both chained into `backend/package.json` `test`.

- **#1** — the test *is* `npx tsc -b --noEmit` exiting 0 and `vite build` succeeding; enforced by CI (#2).
- **#2** — CI itself; sanity-checked with `yq`/`node -e` YAML parse locally, not runnable without a push.
- **#8** — frontend, no test infra: verified by `tsc -b` clean + `vite build` + reading the diff.

**Regression safety:** because no existing test imports `app.js`, none of the `app.js`
changes (#3, #4, #7, #11, #15) can break the current suite. The risk is purely runtime
behaviour, mitigated by the source scans + a local `node -e "require('./app.js')"` smoke
(with a throwaway `JWT_SECRET`/`MONGO_URI`) at each checkpoint.

---

## 4. Per-item specification

Order is easy → hard. Each row is one commit.

### Item 1 — #5 · Mark `timestamp` index done (docs only)

- **Change:** none in code — `activitySchema.index({ userId:1, timestamp:-1 })` already ships.
- **Docs:** flip the relevant `docs/IMPROVEMENT_PLAN.md` finding to ✅ FIXED (2026-09-08, via
  the DB-write batch); mark `Quick_Wins.md` #5 done; confirm `CONTEXT.md` §DB already reflects it.
- **Commit:** `docs: mark timestamp-index quick-win done (shipped in DB-write batch)`
- **Risk:** none.

### Item 2 — #7 · Fail-fast on missing `JWT_SECRET`

- **Change:**
  - `backend/app.js` top (after `dotenv.config()`): `if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');`
  - Delete `|| 'your_jwt_secret'` in `middleware/auth.js:87`, `routes/auth.js:23`, `routes/auth.js:54`.
- **Test:** `quickWins.test.js` — assert no `'your_jwt_secret'` literal anywhere in `backend/` (excl. `node_modules`, `tests/`, `.env*`); assert `app.js` source contains the `JWT_SECRET` guard.
- **Docs:** `IMPROVEMENT_PLAN.md` finding → FIXED; `Quick_Wins.md` #7; `CONTEXT.md` §security /
  "still open" list; `CodeTrackr_Interview_Cheat_Sheet.md` + `_QA.md` + `_Interview_Preparation.md`
  security sections ("`JWT_SECRET` fallback `'your_jwt_secret'`" → "app refuses to boot without it").
- **Commit:** `fix(security): require JWT_SECRET at boot, drop hardcoded fallback`
- **Risk:** low. Local `.env` already sets it; operator must set it in Render (call out in rollout).

### Item 3 — #6 · 409 (not 500) on duplicate group join

- **Change:** `routes/groups.js` join handler `catch`:
  ```js
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'You are already a member of this group' });
    }
    console.error('Error joining group:', error);
    return res.status(500).json({ message: 'Error joining group' }); // no error.message (see #4)
  }
  ```
  (The pre-check at `:218` stays; this catches the race / double-click.)
- **Test:** `quickWins.test.js` — scan the join handler for `error.code === 11000` and `status(409)`.
- **Docs:** `IMPROVEMENT_PLAN.md` (the "double-join → 500" finding) → FIXED; `Quick_Wins.md` #6;
  `_QA.md` / `_Cheat_Sheet.md` / `_Interview_Preparation.md` §11 / `_Architecture.md` §8
  ("Double-join → unique index → **500** (should be 409)" → "→ **409**").
- **Commit:** `fix(api): return 409 on duplicate group join`
- **Risk:** low.

### Item 4 — #11 · `GET /health` readiness endpoint

- **Change:** `backend/app.js`, near `app.get("/")`:
  ```js
  app.get('/health', (req, res) => {
    const up = mongoose.connection.readyState === 1;
    res.status(up ? 200 : 503).json({ status: up ? 'ok' : 'degraded', db: up });
  });
  ```
  Keep `GET /` as the liveness ping.
- **Test:** `quickWins.test.js` — scan `app.js` for the `/health` route + `readyState` + `503`.
- **Docs:** `IMPROVEMENT_PLAN.md` (new L-item or fold into H-13 note) ; `Quick_Wins.md` #11;
  `CONTEXT.md` §deploy / §API surface; `_Architecture.md` §7.1 endpoint table + §10 deployment
  ("Point Render's health check at `/health`"); `_QA.md` deploy section.
- **Commit:** `feat(backend): add /health readiness endpoint (503 when DB down)`
- **Risk:** low.

### Item 5 — #8 · Real data in the "Repeated Failures" panel

- **Change:** `frontend/src/pages/Dashboard.tsx` — delete `repeatedFailuresDaily` (`:220`) and
  `repeatedFailuresWeekly` (`:228`) mock arrays and the ternary at `:237`; render from
  `currentData?.terminalSummary?.repeatedFailedCommands ?? []`. Match the existing item shape
  (`{ command, count }`); show the existing empty state when the array is empty.
- **Test:** none (no frontend test infra); verify `tsc -b` clean + `vite build` + read diff.
  Confirm backend already returns the field: `routes/analytics.js` `buildTerminalSummary`.
- **Docs:** `IMPROVEMENT_PLAN.md` ("Repeated Failures panel = mock") → FIXED; `Quick_Wins.md` #8;
  `CONTEXT.md` §known-issues / §frontend; **every interview doc that says "the Repeated
  Failures panel is mock data — don't demo it"** (`_Cheat_Sheet.md` traps list, `_QA.md`,
  `_Interview_Preparation.md`, `_Guide_Condensed.md`, `_Architecture.md` §2.3 + §9) → "now
  wired to the real `repeatedFailedCommands`".
- **Commit:** `fix(frontend): wire Repeated Failures panel to real data`
- **Risk:** low-medium (no automated safety net; small, readable change).

### Item 6 — #3 · Wire `helmet` + `express-rate-limit`

- **Change:** `backend/app.js`:
  ```js
  const helmet = require('helmet');
  const rateLimit = require('express-rate-limit');
  // ...after app.set('trust proxy', 1):
  app.use(helmet());
  // ...after the parsers, before routes:
  const skip = () => process.env.NODE_ENV === 'test';
  app.use('/auth', rateLimit({ windowMs: 15*60_000, max: 50, skip, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/extension', rateLimit({ windowMs: 60_000, max: 120, skip, standardHeaders: true, legacyHeaders: false }));
  ```
  `skip` when `NODE_ENV==='test'` is defensive only (no current test hits routes) and keeps a
  future `supertest` suite from flaking.
- **Test:** `quickWins.test.js` — scan `app.js` for `require('helmet')`, `app.use(helmet())`,
  and `rateLimit(` mounted on both `/auth` and `/api/extension`.
- **Docs:** `IMPROVEMENT_PLAN.md` M-3/M-4 → FIXED; `Quick_Wins.md` #3; `CONTEXT.md` §3 tech
  table ("helmet/express-rate-limit installed but NOT wired" → "wired: helmet global,
  rate-limit on /auth + /api/extension") + §security; `_Cheat_Sheet.md` ("No `helmet`, no rate
  limiting anywhere" → scoped), `_QA.md`, `_Interview_Preparation.md` §3 + security, `_Architecture.md` §2.2.
- **Commit:** `feat(security): enable helmet and rate-limit auth + ingest`
- **Risk:** medium — `helmet()` defaults could affect CORS/headers; verify the CORS response
  and a normal `GET /` still work in the local smoke. `trust proxy` is already set (needed for
  correct client IP behind Render).

### Item 7 — #1 · Fix the frontend build

- **Change:** `frontend/src/` —
  - **20× TS6133 unused:** delete unused imports/vars in `Teams.tsx` (`user`), `Groups.tsx`
    (`user`, `data`), `Dashboard.tsx` (`formatRelativeTime`, `Calendar`), `Goals.tsx` (15:
    the half-built to-do scaffolding — `toggleTodo`, `addTodo`, `deleteTodo`, `openTodoModal`,
    `newTodoText`, `showTodoModal`, `selectedGoal`, `setSelectedGoal`, `handleDateClick`,
    `getDateIcon`, `getDateColor`, `getDateColor`, icons `Trash2`/`Plus`/`Circle`/`CheckCircle`).
    Where a setter is used but its state value isn't (or vice-versa), remove the whole
    `useState` line.
  - **4× TS2322 `string`→`never`:** `Groups.tsx:280`, `Profile.tsx:96`, `Goals.tsx`,
    `Dashboard.tsx` — an array/state inferred as `never[]`. Fix by annotating the declaration
    (`useState<string[]>([])`, `const x: number[] = []`, etc.). Inspect each; do **not**
    silence with `as never` / `@ts-ignore`.
  - **5× implicit-any in `TextType.tsx`:** type the destructured props (`text`,
    `onSentenceComplete`, `variableSpeed`) and the `timeout` ref/var
    (`ReturnType<typeof setTimeout> | null`).
- **Test:** `npx tsc -b --noEmit` exits 0; `npm run build` (`tsc -b && vite build`) exits 0.
- **Docs:** `IMPROVEMENT_PLAN.md` M-13 → FIXED; `Quick_Wins.md` #1; `CONTEXT.md` §frontend /
  §known-issues; **every interview doc that says "the frontend build fails / `tsc -b` has 29
  errors"** (`_Cheat_Sheet.md` Q39 + traps, `_QA.md`, `_Interview_Preparation.md` §3 + §16 +
  weaknesses, `_Guide_Condensed.md`, `_Architecture.md` §10) → "build is green".
- **Commit:** `fix(frontend): resolve 29 TypeScript errors, unblock the build`
- **Risk:** low-medium. TS6133 deletions are safe. The 4 `never[]` and 5 any's need a real
  look per file. `Goals.tsx` scaffolding deletion is intentional (see #14 note).

### Item 8 — #2 · CI workflow

- **Change:** `.github/workflows/ci.yml` per the Quick Wins doc — 3 jobs: `backend`
  (`npm ci && npm test`, node 18), `frontend` (`npm ci && npm run build`, node 20),
  `extension` (`npm ci && npm test`, node 18). **No `env:` block** — backend `npm test` runs
  only pure-function / source-scan suites and never loads `app.js`, so `JWT_SECRET` is not
  needed here. The `app.js` import smoke (which *does* need `JWT_SECRET=ci`) is added to the
  `backend` job by #15's commit, once `require('./app.js')` is side-effect-free.
- **Test:** parse the YAML locally (`node -e "require('js-yaml')..."` if available, else eyeball
  + `actionlint` if present). Real validation is the first push (operator).
- **Docs:** `IMPROVEMENT_PLAN.md` ("No CI") → FIXED; `Quick_Wins.md` #2; `CONTEXT.md` §deploy
  ("No CI" → "GitHub Actions: backend+extension tests, frontend build"); `_Cheat_Sheet.md`
  ("No CI"), `_QA.md`, `_Interview_Preparation.md` §16/§17 CI lines, `_Architecture.md` §10.
- **Commit:** `ci: add GitHub Actions workflow (backend + extension tests, frontend build)`
- **Risk:** low (can't fully verify without a push; YAML is copied from a known-good shape).

### Item 9 — #4 · Central error handler

- **Change:**
  - `backend/app.js`, **after all routers, before `module.exports`**:
    ```js
    app.use((err, req, res, next) => {
      const id = Math.random().toString(36).slice(2, 10);
      console.error(`[err:${id}]`, err);
      res.status(err.status || err.statusCode || 500).json({ error: 'Internal server error', id });
    });
    ```
  - Route conversion **policy** (keeps the change reviewable):
    - Replace **only** the generic `catch (e) { res.status(500).json({ message/error: e.message }) }`
      tails with `catch (e) { next(e); }`.
    - **Preserve** every deliberate non-500 status already returned inside handlers (400/401/403/404/409).
    - Do **not** delete the `try/catch` wrappers in this batch (Express 5 auto-forwarding is
      true but removing them is a bigger diff — leave for a later cleanup).
    - Files: `analytics.js`, `auth.js`, `extension.js`, `goals.js`, `groups.js`,
      `leaderboard.js`, `metrics.js`, `notifications.js`, `team.js`, `user.js` — ~28 sites.
- **Test:** `quickWins.test.js` —
  - assert `app.js` source has a 4-arg `app.use((err, req, res, next)` after the route mounts;
  - assert **zero** occurrences of `error: error.message` / `error: err.message` /
    `message: error.message` remain in `backend/routes/`.
- **Docs:** `IMPROVEMENT_PLAN.md` ("routes echo err.message" / "no central error handler") →
  FIXED; `Quick_Wins.md` #4; `CONTEXT.md` §backend / §security; `_Cheat_Sheet.md`
  ("Errors echo `err.message`… No central error handler" → fixed), `_QA.md` error-handling Q,
  `_Interview_Preparation.md` §7.2 middleware + error-handling section, `_Architecture.md` §2.2
  ("`try/catch` → `500 {message, error}`" → central handler + correlation id).
- **Commit:** `refactor(backend): central error handler, stop leaking error.message`
- **Risk:** medium — the mechanical breadth. Mitigation: the grep-for-zero-leaks test, and a
  per-file read of the diff. Some routes build `{ message, error }` in non-catch branches
  (e.g. validation) — those are fine; only the `catch`-tail 500s change.

### Item 10 — #12 · Validate the ingest payload

- **Change:**
  - New pure module `backend/services/ingestValidation.js`:
    ```js
    // returns { ok: true, value } | { ok: false, errors: [...] }
    function validateIngestPayload(body) { /* bounds below */ }
    ```
    Bounds: `duration` finite, `> 0`, `<= 3600`; `fileName` string, `1..255`; `language`
    string, `1..64`; `projectName` optional string `<= 128`; `timestamp` optional, parseable,
    `<= now + 60s` and `>= now - 24h`. (Fixes the `duration:0` false-reject and the
    `duration:1e12` / backdated-timestamp accepts.)
  - `routes/extension.js` `/track` and `/track/batch`: call `validateIngestPayload` at the top
    of the per-item flow; on `!ok` → `400 { error: 'Invalid activity payload', details }`.
    Keep it **ahead of** `planActivityWrite`. For `/track/batch`, validate each element; reject
    the batch if any element fails (current batch semantics are all-or-nothing).
  - Do **not** add `express-validator` middleware — a pure function is more testable and the
    route already has a normalise/plan pipeline. (Quick Wins doc suggested `express-validator`;
    the pure-module choice is a deliberate deviation, noted here.)
- **Test:** `backend/tests/ingestValidation.test.js` — pure unit tests: `duration:0` rejected,
  `duration:1` ok, `duration:3600` ok, `duration:3601` rejected, `duration:-5` rejected,
  `duration:1e12` rejected, missing `fileName` rejected, 300-char `fileName` rejected, future
  `timestamp` (+1h) rejected, `timestamp` now ok, 2-day-old `timestamp` rejected, valid full
  payload ok. Plus `ingestWiring.test.js` gets a scan asserting `/track` calls the validator.
- **Docs:** `IMPROVEMENT_PLAN.md` ("no request validation on ingest" / "duration:0 wrongly
  rejected" / "client sets timestamp") → FIXED (partial — timestamp still client-set but now
  bounded); `Quick_Wins.md` #12; `CONTEXT.md` §ingest / §security; `_Cheat_Sheet.md`
  ("No request validation on ingest — `duration: 1e12` accepted… `duration:0` wrongly
  rejected" → fixed), `_QA.md` (E-section + "cheat the leaderboard" Q — update the answer:
  bounded now, still no per-key rate limit beyond #3), `_Interview_Preparation.md` §5.3 +
  ingest section, `_Architecture.md` §3 step 7 (add the validation gate).
- **Commit:** `feat(security): bounds-check the ingest payload`
- **Risk:** medium — must not reject payloads the current extension legitimately sends. Check
  `extension/src/extension.ts` `buildPayload`: `duration = round(minutes*60)` (≥ ~30s given
  `minFlushMinutes`), `fileName` basename, `projectName` = workspace name. Bounds chosen to
  clear real payloads. `hasSignal`/skip logic already prevents `duration:0` sends.

### Item 11 — #15 · Serverless-safe: guard `app.listen` + externalise the cron

- **Change:**
  - `backend/app.js` bottom:
    ```js
    if (require.main === module) {
      require('./services/notificationScheduler').initScheduler();
      app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
    }
    module.exports = app;
    ```
    (So `require('../app')` from `api/index.js` no longer starts a server or a scheduler.)
  - New route file `backend/routes/internal.js`:
    ```js
    router.post('/run-notifications', requireCronSecret, async (req, res, next) => {
      try {
        await checkUpcomingDeadlines(); await checkOverdueGoals();
        res.json({ ok: true });
      } catch (e) { next(e); }
    });
    router.post('/run-rollup', requireCronSecret, async (req, res, next) => {
      try { const r = await rollupDaily({ apply: true, beforeDays: 2 }); res.json({ ok: true, wrote: r.wrote }); }
      catch (e) { next(e); }
    });
    ```
    `requireCronSecret`: constant-time compare of `req.get('x-internal-secret')` against
    `process.env.INTERNAL_CRON_SECRET`; 404 (not 401) if unset or mismatched, to not advertise
    the route. Mount at `app.use('/api/internal', internalRoutes)`.
  - `services/notificationScheduler.js`: keep `initScheduler` (used only in the
    `require.main` branch for local/long-lived deploys); export `checkUpcomingDeadlines`,
    `checkOverdueGoals`, `rollupDaily` (already exported). Remove the **immediate**
    `checkUpcomingDeadlines()/checkOverdueGoals()` calls from `initScheduler` OR keep them —
    keep them (local dev convenience); the serverless path never calls `initScheduler` now.
  - Add index `{ goalId: 1, type: 1 }` to `models/Notification.js` for `checkOverdueGoals`'s
    per-goal `findOne`.
  - CI (`ci.yml`): add to the `backend` job after `npm test`:
    `- run: cd backend && JWT_SECRET=ci NODE_ENV=test node -e "require('./app.js'); console.log('app import ok')"`
    (safe now that import has no side effects).
- **Test:** `quickWins.test.js` —
  - `app.js` source has `require.main === module` guarding both `initScheduler` and `app.listen`;
  - `app.js` mounts `/api/internal`;
  - `routes/internal.js` exists, references `INTERNAL_CRON_SECRET`, and both handlers are
    behind the guard middleware;
  - `models/Notification.js` declares `{ goalId: 1, type: 1 }`.
  - Pure smoke: `require('./app.js')` in-process with `JWT_SECRET`/`MONGO_URI` set to junk
    does **not** throw and does **not** bind a port (assert `server` isn't listening — or
    simply that the require returns the express app function).
- **Docs:** `IMPROVEMENT_PLAN.md` H-13 → FIXED (or "mitigated"); `Quick_Wins.md` #15;
  `CONTEXT.md` §deploy + §scheduler + §14/§17 (the `node-cron`-on-serverless caveat) +
  §API surface (`/api/internal/*`); `_Cheat_Sheet.md` ("`node-cron` breaks on serverless
  (H-13)" → "guarded + external trigger"), `_QA.md` (H-13 Q + deploy Q), `_Interview_Preparation.md`
  §9 + §22, `_Guide_Condensed.md`, `_Architecture.md` §1 box + §2.2 + §10 (the whole
  serverless-cron paragraph) + §7.1 endpoint table.
- **Commit:** `refactor(backend): serverless-safe bootstrap + external cron trigger`
- **Risk:** medium — the bootstrap reorder. Local `node app.js` must still start the server
  and scheduler (it does — `require.main === module` is true). `api/index.js` path only
  exercised on Vercel. The `render`/long-lived path (primary per `CONTEXT.md`) is unchanged.

---

## 5. Checkpoints

Execution pauses for review at:

| CP | After items | What to review |
|---|---|---|
| **CP1** | 1–6 (#5, #7, #6, #11, #8, #3) | the small batch — 6 commits, `backend npm test` green, local `require('./app.js')` smoke, `vite build` green |
| **CP2** | 7–8 (#1, #2) | `npx tsc -b` clean, `npm run build` green, `ci.yml` shape |
| **CP3** | 9 (#4) | the error-handler diff across 10 route files; the zero-leaks grep test |
| **CP4** | 10–11 (#12, #15) | ingest validation unit tests; serverless bootstrap smoke; full suite green; **all doc updates** |

Doc updates are done **incrementally per item** (each commit includes its own
`IMPROVEMENT_PLAN.md` + `Quick_Wins.md` line), with a **consolidated interview-doc sweep** at
CP1, CP3, and CP4 (batching the prose edits to `_Cheat_Sheet.md` / `_QA.md` /
`_Interview_Preparation.md` / `_Guide_Condensed.md` / `_Architecture.md` / `CONTEXT.md` so
they stay coherent rather than half-edited).

---

## 6. Documentation-update matrix

| Item | `IMPROVEMENT_PLAN.md` | `CONTEXT.md` | Interview docs (which) |
|---|---|---|---|
| #5 | index finding → FIXED | §DB (already noted) | already done in DB-write batch |
| #7 | `JWT_SECRET` fallback → FIXED | §security "still open" list | Cheat/QA/Prep security sections |
| #6 | double-join 500 → FIXED (409) | §consistency/races | QA, Cheat, Prep §11, Arch §8 |
| #11 | new item / H-13 note | §deploy, §API surface | Arch §7.1 + §10, QA deploy |
| #8 | "Repeated Failures = mock" → FIXED | §known-issues, §frontend | Cheat traps, QA, Prep, Condensed, Arch §2.3/§9 |
| #3 | M-3/M-4 → FIXED | §3 tech table, §security | Cheat, QA, Prep §3, Arch §2.2 |
| #1 | M-13 → FIXED | §frontend, §known-issues | Cheat Q39+traps, QA, Prep §3/§16, Condensed, Arch §10 |
| #2 | "No CI" → FIXED | §deploy | Cheat, QA, Prep §16/§17, Arch §10 |
| #4 | "echo err.message" / "no central handler" → FIXED | §backend, §security | Cheat, QA, Prep §7.2, Arch §2.2 |
| #12 | "no ingest validation" → FIXED (partial) | §ingest, §security | Cheat, QA (+cheat-the-leaderboard), Prep §5.3, Arch §3 |
| #15 | H-13 → FIXED/mitigated | §deploy, §scheduler, §API, §14/§17 | Cheat, QA, Prep §9/§22, Condensed, Arch §1/§2.2/§10/§7.1 |

Also: append a `## 10. Quick-wins batch (2026-09-09)` section to
`docs/SESSION-LOG-2026-08-27.md` and update the memory file
`memory/codetrackr-overview.md` + `MEMORY.md` at CP4.

---

## 7. Rollout — what the operator must do after merge

1. Set `JWT_SECRET` in Render (and any other env) — **the app will not boot without it** (#7).
2. Set `INTERNAL_CRON_SECRET` in Render (#15).
3. Wire an external scheduler (GitHub Actions `schedule:` or cron-job.org) to
   `POST https://<api>/api/internal/run-notifications` and `/api/internal/run-rollup` hourly /
   daily with header `x-internal-secret: <INTERNAL_CRON_SECRET>` (#15).
4. Point Render's health check path at `/health` (#11).
5. `git push` so CI runs for the first time (#2); confirm all three jobs green.

---

## 8. File inventory

**New:**
- `.github/workflows/ci.yml`
- `backend/routes/internal.js`
- `backend/services/ingestValidation.js`
- `backend/tests/quickWins.test.js`
- `backend/tests/ingestValidation.test.js`

**Modified (code):**
- `backend/app.js` (helmet, rate-limit, `/health`, error handler, JWT guard, bootstrap guard, `/api/internal` mount)
- `backend/middleware/auth.js`, `backend/routes/auth.js` (drop `JWT_SECRET` fallback)
- `backend/routes/groups.js` (409)
- `backend/routes/*.js` ×10 (`catch → next(e)`)
- `backend/routes/extension.js` (call `validateIngestPayload`)
- `backend/services/notificationScheduler.js` (export surface; no immediate-run change)
- `backend/models/Notification.js` (`{goalId:1,type:1}` index)
- `backend/package.json` (`test` script += 2 suites)
- `frontend/src/pages/{Dashboard,Goals,Groups,Profile,Teams}.tsx`, `frontend/src/components/TextType.tsx`

**Modified (docs):** `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`,
`CODETRACKR_PROJECT_CONTEXT.md`, `docs/interview-preparation/{CodeTrackr_Interview_Preparation,
CodeTrackr_Interview_QA,CodeTrackr_Interview_Cheat_Sheet,CodeTrackr_Interview_Guide_Condensed,
CodeTrackr_Architecture}.md`, `docs/SESSION-LOG-2026-08-27.md`,
`memory/codetrackr-overview.md`, `memory/MEMORY.md`.

**Left alone (pre-existing un-tracked edits, not ours):** `THEME_USER_GUIDE.md`,
`backend/drop-duplicate-index.js`, `backend/package-lock.json`, `extension/extension.js`,
`extension/index.html`, `frontend/package-lock.json`.

---

## 9. Open risks / assumptions

- **`helmet()` defaults** may set headers that interact with the SPA (e.g.
  `Cross-Origin-Resource-Policy`, CSP is **off** by default in helmet so no CSP risk). Verify
  `GET /` + a CORS preflight in the CP1 smoke; if something breaks, scope helmet
  (`helmet({ crossOriginResourcePolicy: false })`) rather than dropping it.
- **`express-rate-limit` behind Render's proxy** needs `trust proxy` (already set to `1`) for
  correct per-client keying; otherwise all traffic shares one bucket. Acceptable either way
  for this scale; noted.
- **CI can't be verified here** — the workflow is shipped on the known-good shape from the
  Quick Wins doc; first real run is the operator's push.
- **`Goals.tsx` scaffolding removal (#1)** is intentional and coordinated with the deferred
  #14 (which re-implements to-dos properly). If #14 is reprioritised, restore from git history.
- No integration test proves the wired middleware works at runtime — that gap is explicitly
  deferred to #24. The source-scan tests guard against *removal*, not *misconfiguration*.
