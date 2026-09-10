# CodeTrackr — Improvement Plan

_Findings from the Phase 1 codebase audit. Every item was verified against source, not inferred._
_Companion doc: `ARCHITECTURE.md`._

## Status

**Write-reduction batch — DB write volume + redundancy: DONE 2026-09-08.**
Levers #3 (10-minute bucket-on-write via atomic `$inc` upsert), #2 (skip signal-less flushes,
extension 2.3.0), #4 (sparse analytics sub-docs + drop the dead `date` field/index), #6
(`DailySummary` model + nightly `scripts/rollup-daily.js` + 400-day safety TTL on
`activities.createdAt`), #1 (`minFlushMinutes` default 0.5 → 2). Also folds in the missing
`{userId:1,timestamp:-1}` index. `ACTIVITY_BUCKET_MS=0` restores per-flush inserts.
Verified by `activityBucket` (21), `activityModel` (10), `ingestWiring` (9), `rollup` (7)
suites + extension `activation`. Spec/plan under `docs/superpowers/`.
**Follow-up (bundle with `UserStats`):** tighten the raw TTL and repoint the all-time reads
(`/leaderboard`, `/api/analytics/summary`, `/api/metrics` beyond 90d) at `dailysummaries`.
Migrations to run on the live DB: `node backend/scripts/migrate-drop-date.js --apply`, then
`node backend/scripts/rollup-daily.js --apply`.

**Batch 1 — data accuracy (H-3, H-4, H-5, H-6, M-2): DONE 2026-08-27.**
Verified by `backend/tests/streak.test.js` (9 assertions, run with `npm test` in `backend/`),
which extracts the shipped helpers from `routes/analytics.js` and exercises them against a
stubbed aggregate. Remaining batches are unstarted.

Files changed: `backend/routes/goals.js`, `backend/routes/extension.js`,
`backend/routes/analytics.js`, `backend/app.js`, `backend/package.json`,
`frontend/src/pages/Dashboard.tsx`, `backend/tests/streak.test.js` (new).

**Batch 2 — extension correctness (H-12, L-2, L-7, M-5 partial): DONE 2026-08-27, version 2.0.11.**
Verified by `extension/tests/activation.test.js` (11 assertions, `npm test` in `extension/`), which
loads the built `dist/extension.js` against a stubbed vscode API. Additional fixes beyond the plan,
found during the extension audit: production `apiBase` default restored (had regressed to localhost
after 2.0.6), `vscode:prepublish` now compiles TypeScript, `setupApiKey`/`showInfo` commands
implemented (contributed but never registered), 401 handling surfaced to the user, debug counts
routed into the activity payload, activity stamped with interval start.

⚠️ **Unverified assumption:** the production backend URL was taken from CHANGELOG 2.0.6
(`https://codetrackr-backend-uckp.onrender.com`). Confirm it is current before publishing.

**Batch 3 — security + Insights page (H-1, H-2, H-9, H-10, H-11): DONE 2026-08-28.**
Branch `feat/security-and-insights`. Verified by 57 backend assertions across six suites,
including a new `routeGuards.test.js` that statically scans route source and fails if any
sensitive route loses its auth middleware. Group passwords use Node's built-in `crypto.scrypt`
rather than bcrypt — no native dependency, which keeps the Vercel build simple and lets the
tests run without `npm install`. Legacy plaintext passwords still verify and are upgraded to a
hash on the next successful join. A new `/insights` page surfaces the Phase A metrics. *(Every formula was corrected 2026‑09‑10 — see `docs/INSIGHTS_METRICS.md`.)*

**Quick-wins batch — Tier 1 + security: DONE 2026-09-09.** 11 items, one commit each, on
`feat/security-and-insights`. Spec/plan under
`docs/superpowers/{specs,plans}/2026-09-09-quick-wins-tier1-security.md`.
Fixed: **M-9** (`JWT_SECRET` fail-fast), **M-14** (409 on duplicate group join), **L-8**
(`GET /health` readiness), **M-15** (real "Repeated Failures" data), **M-3** (`helmet` +
rate-limit on `/auth`+`/api/extension`), **M-13** (29 frontend `tsc` errors → build green),
**L-9** (GitHub Actions CI), **M-10** (central error handler), **M-4** partial (pure ingest
bounds-check), **H-13** (serverless-safe bootstrap + `POST /api/internal/run-*` cron trigger).
Plus `#5` (the `{userId:1,timestamp:-1}` index, folded from the DB-write batch).
Verified by new `backend/tests/quickWins.test.js` (14) + `ingestValidation.test.js` (23);
backend suites 10 → 12. **Deferred to a follow-up:** `#9` `UserStats` leaderboard rollup
(decided: live running-total), `#10` idempotency key, `#13` React Query, `#14` goal
completion, all of Tier 3 (incl. the `supertest` + `mongodb-memory-server` integration test).
**Operator TODO:** set `JWT_SECRET` + `INTERNAL_CRON_SECRET` in Render; wire an external
scheduler to the two internal routes; point the health check at `/health`; push for CI.

**Frontend build — ✅ FIXED 2026-09-09 (M-13).** `npm run build` (`tsc -b && vite build`) had
**29 pre-existing TypeScript errors** (16 in `Goals.tsx`, 5 in `TextType.tsx`, 3 each in
`Groups.tsx`/`Dashboard.tsx`, 1 each in `Teams.tsx`/`Profile.tsx`). All resolved: dead
imports/vars removed, `TextType.tsx` given a `TextTypeProps` interface (which also fixed the 4
`string`→`never` errors in the pages that pass `textColors`), and the half-built `Goals.tsx`
to-do scaffolding removed. `npm run build` is green; CI (#2) keeps it that way.

**Production-readiness batch — DONE 2026-09-10.** Full audit in `docs/AUDIT-2026-09-10.md`;
metric definitions in `docs/INSIGHTS_METRICS.md`. Fixed **H-14** (extension data loss),
**H-15** (idle inflating every focus metric), **M-16** (four wrong metric formulas), **M-17**
(goal completion — the state transition that made estimation calibration reachable at all).
Added sessionization + rule-based archetypes (`services/sessionize.js`) and a lazily-cached
90-day baseline (`services/insightsBaseline.js`, `UserInsights`, no cron). Extension **2.4.0**.

**Social-surface sweep + rules engine — DONE 2026-09-10.** The leaderboard, groups and
notifications routes had only been audited shallowly. Fixed **H-16** (regex injection / ReDoS in
group discovery), **H-17** (the leaderboard reported flush counts as commits), **H-18**
(`Math.max(...)` spread crash), **M-18** (negative impact scores), **M-19** (malformed `:id` →
500), **M-20** (notifications bypassing the central error handler; delete reporting false
success), **M-21** (group leaderboard now surfaces build/command failures — the feature the
project's stated motive was built around). Added `services/rulesEngine.js`: declarative
threshold rules over the derived metrics, gated on the same confidence sidecar, each finding
carrying the evidence that fired it. Deliberately not a model and not an LLM — see
`docs/RULES_ENGINE.md`. Backend 15 → **18 suites / 292 assertions**; extension **3 / 52**
(unchanged this batch).

⚠️ **H-7 remains open.** The leaderboard still aggregates the whole `activities` collection and
loads every user with no cache. This batch fixed its *correctness*, not its complexity; the fix
is the deferred `UserStats` running-total rollup.

⚠️ **Two findings that block production regardless of code quality** (see `AUDIT` §7):
1. **Nothing on this branch is deployed.** 0 of 7034 activity documents carry `bucketStart`,
   which the 2026‑09‑08 ingest writes on every insert — so Render is still serving pre‑09‑08 code.
2. **The live extension is not sending analytics.** Rich sub-documents exist in only 140
   documents, all 2026‑07‑15 → 2026‑08‑27. The newest stored document is
   `{ duration: 120, language: "latex" }` and nothing else. Every focus-derived metric has no
   live input; confidence gating makes that visible as "—" rather than a fabricated 0.

**A backfill is still outstanding for H-5:** rows written before this fix have `date` set to
their ingest day. Recompute with `date = timestamp` before anything starts trusting `date`.
Read paths all query `timestamp`, so nothing is broken in the meantime.

---

## HIGH — correctness, security, data accuracy, scalability

### H-1. Analytics and leaderboard endpoints are unauthenticated — ✅ FIXED 2026-08-28
**Problem:** `GET /api/analytics/:userId`, `/weekly/:userId`, `/timeslot/:userId` and `GET /api/leaderboard` have no auth middleware. Anyone with a user's `_id` (which the leaderboard hands out in plaintext) can read that user's full coding history, projects, languages and hours. `/api/analytics/summary/:userId` requires a session but never checks that `:userId === req.user.id`.
**Why:** Auth was added per-route as features shipped; the analytics routes predate it and the dashboard fetches them without `credentials:'include'`, so adding auth was never forced.
**Fix:** Add `isAuthenticated` to all analytics routes plus an ownership guard (`req.params.userId === req.user._id.toString()`, else 403). Drop `:userId` from the path and read from `req.user` — that removes the IDOR class entirely. Send `credentials:'include'` from `Dashboard.tsx`.
**Files:** `backend/routes/analytics.js`, `backend/routes/leaderboard.js`, `frontend/src/pages/Dashboard.tsx`.
**Risk:** Breaks any caller relying on the open endpoints. Keep the `:userId` param accepted-but-verified for one release for backward compatibility.

### H-2. Legacy unauthenticated write + read endpoints in `app.js` — ✅ FIXED 2026-08-28
**Problem:** `POST /api/user-activity` lets anyone insert activity for **any** `userId` — leaderboard fraud in one curl. `GET /api/user-stats/:id` dumps a user's entire activity history unauthenticated and unpaginated.
**Fix:** Delete both, or gate behind `verifyApiKey` and force `userId = req.user._id`. Nothing in `extension/src/` or `frontend/src/` calls them.
**Files:** `backend/app.js`.
**Risk:** Low — the published extension v2.x uses `/api/extension/track`. Confirm no v1.x installs remain before deleting.

### H-3. Goal progress is 60× overstated — ✅ FIXED 2026-08-27
**Problem:** `routes/goals.js` sums `duration` (seconds) into a variable named `totalMinutes`, then reports `currentHours: totalMinutes / 60`. That yields seconds/60 = minutes, labelled as hours.
**Fix:** `currentHours = totalSeconds / 3600`.
**Files:** `backend/routes/goals.js:56-62`.
**Risk:** Existing goals will visibly drop to their true progress. Intended.

### H-4. `/api/user-stats/:id/summary` always returns zero — ✅ FIXED 2026-08-27
**Problem:** Three `$group` stages sum `"$codingTime"`, a field that does not exist on the schema (it is `duration`). Every total, today figure and weekly bucket returns 0.
**Fix:** Sum `"$duration"` and divide by 3600 for hours. Or delete the endpoint with H-2.
**Files:** `backend/app.js:150-200`.

### H-5. `date` field is written wrong, so backdated activity lands on today — ✅ FIXED 2026-08-27
**Problem:** `routes/extension.js` sets `date: new Date().toISOString().split('T')[0]` — a string cast to UTC midnight of *today*, ignoring the client's `timestamp`. Offline/queued activity from yesterday is filed under today. The `{userId:1, date:-1}` index is therefore built on a field that doesn't mean what queries assume.
**Fix:** `date` should be derived from the same instant as `timestamp` (or dropped entirely — `timestamp` already carries it, and every read path already queries `timestamp`).
**Files:** `backend/routes/extension.js:95,140`.
**Risk:** Existing rows keep the old value; a one-off backfill script can recompute `date` from `timestamp`.
**Update 2026-09-08 (DB write-reduction batch):** dropped entirely — the `date` field and the
`{userId:1,date:-1}` index are removed from `models/Activity.js`, and `{userId:1,timestamp:-1}`
is added (this closes Quick-Wins #5). Live migration: `node backend/scripts/migrate-drop-date.js --apply`.

### H-6. Streak calculation is wrong in three ways — ✅ FIXED 2026-08-27
**Problem:** In `routes/analytics.js` the streak (a) only considers the last 7 days, so it caps at 7; (b) initialises `streakDays = 1` without checking the most recent active day is today or yesterday — a user idle for a week still shows a streak of 1+; (c) buckets days by `toISOString()` (UTC), ignoring the timezone offset the same endpoint uses elsewhere.
**Fix:** Compute over a 90-day window with a `$group` on user-local day keys, anchor to today/yesterday, then walk backwards.
**Files:** `backend/routes/analytics.js:170-190, 330-350`.

### H-7. Leaderboard does a full-collection scan per request
**Problem:** `GET /api/leaderboard` aggregates **every** Activity document ever written, with `$addToSet` on project names, then loads **every** User, merges, sorts and scores in Node. Cost grows linearly with total activity forever. On Vercel's serverless timeout this fails long before the user count becomes interesting.
**Fix:** (1) Add a time window (`timestamp >= 30d ago`) as the default. (2) Move sort + `$limit` into the pipeline. (3) Paginate. (4) Medium-term: a `UserStats` rollup collection updated on ingest or by a scheduled job, so the leaderboard reads N documents for N users.
**Files:** `backend/routes/leaderboard.js`.
**Risk:** Changes the meaning of "total hours" from all-time to windowed — make it an explicit `?period=` param defaulting to all-time only until the rollup exists.

### H-8. Group leaderboard has the same unbounded scan
**Problem:** `groups.js:/:groupId/details` aggregates all-time activity for all members on every page load. Also wraps a synchronous map in `Promise.all(members.map(async ...))` with no `await` inside — pure overhead.
**Fix:** Time-window it, `$group` + `$sort` in Mongo, drop the pointless `Promise.all`.
**Files:** `backend/routes/groups.js:120-175`.

### H-9. Private group passwords stored and compared in plaintext — ✅ FIXED 2026-08-28
**Problem:** `Group.password` is saved raw and checked with `password !== group.password`.
**Fix:** `bcrypt` hash on create, `bcrypt.compare` on join. Also strip `password` from every group response (`/discover` currently returns full group documents).
**Files:** `backend/models/Group.js`, `backend/routes/groups.js`.
**Risk:** Existing private groups need a migration or a forced password reset.

### H-10. `AUTH_BYPASS` is a full authentication kill switch — ✅ FIXED 2026-08-28
**Problem:** When `AUTH_BYPASS=true`, both `isAuthenticated` and `verifyApiKey` return "the user with the most tracked activity" — i.e. any request authenticates as your most active real user. One env var away from total compromise, and it will silently create users in a production DB.
**Fix:** Refuse to honour it when `NODE_ENV === 'production'`; log a loud warning on boot otherwise.
**Files:** `backend/middleware/auth.js`.

### H-11. IDOR on goals and teams — ✅ FIXED 2026-08-28
**Problem:** `GET /api/goals/:goalId/progress` fetches the goal by ID with no ownership check (it then computes progress against *your* activity, but leaks the goal's title, description, targetHours and deadline). `GET /api/teams/:teamId` returns any team's full member list, names and emails to any logged-in user.
**Fix:** Add `userId: req.user.id` to the goal query; add a membership check to the team query.
**Files:** `backend/routes/goals.js:44`, `backend/routes/team.js:38`.

### H-12. Dead sync pipeline burns network and leaks memory in the extension — ✅ FIXED 2026-08-27 (2.0.11)
**Problem:** `SyncService` posts to `/api/extension/events` — a route that does not exist — without an API key, every 30 seconds, forever. Failed batches accumulate in an unbounded array. `persistFailedBatches` is called on deactivate with a stub context whose `update()` does nothing.
**Fix:** Either delete `logger.ts`/`syncService.ts` and the `logger.log()` call, or implement `POST /api/extension/events` with `verifyApiKey` and pass the real `ExtensionContext`. Deleting is the smaller, safer change — the direct `/track` post already carries the data.
**Files:** `extension/src/extension.ts`, `extension/src/syncService.ts`, `extension/src/logger.ts`.
**Risk:** Requires an extension republish to reach users.

### H-13. `node-cron` scheduler is incompatible with serverless deploy — ✅ FIXED 2026-09-09
**Problem:** `app.js` calls `initScheduler()` at module load and `app.listen()` unconditionally. On Vercel (`api/index.js`), each cold start re-runs the immediate `checkUpcomingDeadlines()` + `checkOverdueGoals()` sweep, and the hourly cron never fires because the process is frozen between requests. `checkOverdueGoals` does an unindexed `findOne` per overdue goal on every invocation.
**Done 2026-09-09:** `initScheduler()` + `app.listen()` are now inside `if (require.main === module)` — `require('../app')` (the serverless entry) starts no server and no scheduler. A new `routes/internal.js` exposes `POST /api/internal/run-notifications` and `/run-rollup` behind `INTERNAL_CRON_SECRET` (constant-time compare; **404** — not 401 — when the secret is unset or wrong, so the route isn't discoverable). Added the `{goalId:1, type:1}` index on `Notification`. CI now imports `app.js` with junk env and asserts no side effects. **Operator:** set `INTERNAL_CRON_SECRET` and wire an external scheduler (GitHub Actions `schedule:` / cron-job.org) to hit the two routes hourly / daily with `x-internal-secret`.
**Files:** `backend/app.js`, `backend/routes/internal.js` (new), `backend/models/Notification.js`, `.github/workflows/ci.yml`.

### H-14. The extension silently destroyed un-uploaded flushes — ✅ FIXED 2026-09-10 (2.4.0)
**Problem:** `buildPayload()` calls `consumeInterval()` on every tracker, which **resets** them. Four paths then bailed out *after* that point, discarding the counters permanently: a signal-less interval, a missing API key, an out-of-range duration, and a failed upload. Worse, `sendActivity` caught its own axios error and never rethrew, so the `catch` in `flushIfNeeded` was **unreachable** and `state.bufferedMinutes = 0` ran on every failure. The documented "buffered in memory, retried next tick" behaviour — repeated in `CODETRACKR_PROJECT_CONTEXT.md` and every interview doc — **did not exist**.
**Impact:** every offline flush lost its interval. Separately, `payloadHasSignal` only inspects edits/commands/commits, so an interval spent *reading code and switching files* was discarded along with its `readMs`, `fileSwitches` and `focusedMs` — meaning `comprehensionLoad` **under**-reported reading.
**Fix:** pure `mergeAnalytics()` + `takePayload`/`holdPayload` carry-forward buffer; `sendActivity` returns a success boolean (a `400` is treated as permanent so a bad payload can't poison later flushes).
**Files:** `extension/src/extension.ts`. **Verified:** `extension/tests/flushSafety.test.js`.

### H-15. Idle time inflated every focus-derived metric — ✅ FIXED 2026-09-10 (2.4.0)
**Problem:** `FocusTracker`'s 15 s ticker and `EditorTracker`'s 5 s attention sampler run on their **own** intervals, independent of the main loop's idle-pause, and nothing consumed them while paused. Leaving VS Code focused and walking away for five hours added five hours to the next flush's `focusedMs` — the denominator of `deepWorkRatio`.
**Impact:** the root cause of `deepWorkRatio` reading ≈0 in production. Also skewed `comprehensionLoad` (idle banked as `readMs`) and `contextSwitchesPerHour`.
**Fix:** `setPaused()` on both trackers; they bank nothing while paused and unpausing does not back-fill the gap.
**Files:** `extension/src/focusTracker.ts`, `extension/src/editorTracker.ts`, `extension/src/extension.ts`.

### H-16. Regex injection / ReDoS in group discovery — ✅ FIXED 2026-09-10
**Problem:** `GET /api/groups/discover?search=` passed the raw query string into `{ $regex: search }`. Any authenticated user could compile their own pattern: `.*` listed every group in the system, and `(a+)+$` backtracks catastrophically against a long name — one request pins the event loop for the whole process.
**Impact:** information disclosure (private group names are returned by `/discover`; only the password gates *joining*) plus a single-request denial of service. Reachable by any signed-in account.
**Fix:** new `services/textQuery.js` — `escapeRegex` / `containsRegex` / `exactRegex`, all term-length capped. `/discover` now matches literally and is bounded to 100 results. The two places that already escaped by hand (`routes/goals.js`, `services/metricsService.js`) were repointed at the shared helper so there is one implementation to audit.
**Files:** `backend/services/textQuery.js` (new), `backend/routes/groups.js`, `backend/routes/goals.js`, `backend/services/metricsService.js`. **Verified:** `tests/textQuery.test.js` (13), including a timed assertion that the ReDoS pattern returns immediately once escaped.

### H-17. The leaderboard reported flush counts as commits — ✅ FIXED 2026-09-10
**Problem:** `activityCount: { $sum: { $ifNull: ['$flushCount', 1] } }` was returned to the client as `commits`, and `speed` was documented as "Based on commits frequency". A flush is an extension upload every ~2 minutes of active coding; it has nothing to do with committing. Real commit counts were being collected the whole time at `gitAnalytics.commits`.
**Impact:** the single most-visible number on the app's most-visible page was fabricated. `commitScore` ("out of 5.0", `commits / 20`) was pure noise.
**Fix:** sum `gitAnalytics.commits`, falling back per-document to `terminalAnalytics.gitActivity.commits` for documents written before `gitStateTracker` existed. The two are views of the same event and are never summed. `flushes` is still returned, under its own honest name.
**Files:** `backend/routes/leaderboard.js`.

### H-18. `Math.max(...)` spread crashes the leaderboard at scale — ✅ FIXED 2026-09-10
**Problem:** `Math.max(...leaderboardData.map(u => u.codeChanges))` spreads one argument per user. Past the engine's argument limit (~100k) this throws `RangeError: Maximum call stack size exceeded`, taking the endpoint down for everybody — and it fails at exactly the moment the product succeeds.
**Fix:** `maxOf(rows, pick)` folds instead of spreading, floors at 1 so it is always a safe divisor, and skips non-finite values.
**Files:** `backend/routes/leaderboard.js`. **Verified:** `tests/leaderboardScore.test.js` (11), including a 200k-row case and an assertion that the old spread really does throw at that size.

---

## MEDIUM — maintainability, API and DB efficiency

- **M-1. Analytics aggregate in JS, not MongoDB.** Every analytics route does `Activity.find()` then `.reduce()`. The daily route pulls 7 days of documents to display one day. Move to `$match`/`$group` pipelines — this is also the prerequisite for the AI metrics service, so do it once and share it. `backend/routes/analytics.js`.
- **M-2. ✅ FIXED 2026-08-27 — Weekly endpoint ignores the timezone offset** the daily endpoint honours, so the two views disagree about which day activity belongs to. `backend/routes/analytics.js:290-310`.
- **M-3. ✅ FIXED 2026-09-09.** `helmet()` is now applied globally (HSTS, `nosniff`, no `X-Powered-By`, frameguard); `express-rate-limit` guards `/auth` (50 / 15 min) and `/api/extension` (120 / min), skipped under `NODE_ENV=test`. `backend/app.js`. Verified by `tests/quickWins.test.js` + a header smoke.
- **M-4. ✅ FIXED 2026-09-09 (partial).** `/track` and `/track/batch` now bounds-check the payload with a pure `services/ingestValidation.js` (`validateIngestPayload`): `duration` in `(0, 3600]` (rejects negative / `1e12` / `NaN`), `fileName` ≤ 255, `language` ≤ 64, `projectName` ≤ 128, `timestamp` within `[now-24h, now+60s]`. Used a pure, unit-tested module (`tests/ingestValidation.test.js`, 23 assertions) rather than `express-validator` middleware — more testable and it slots ahead of the existing normalise/plan pipeline. **Still open:** `timestamp` remains client-supplied (bounded, not server-set), and there's no per-key ingest quota (only the per-IP `/api/extension` limiter from M-3).
- **M-5. Duplicate/dead code.** `extension/extension.js` (560 lines, legacy v1), `backend/server.js.old`, `backend/new.html`, `backend/newest.java`, 6 ad-hoc scripts in `backend/` and 15 in `backend/tools/`. Move the useful ones under `backend/scripts/`, delete the rest.
- **M-6. `userId` is a String on Activity but an ObjectId everywhere else.** Forces the `$regexMatch`/`$toObjectId` gymnastics in `leaderboard.js` and blocks `$lookup`. Migrate to ObjectId with a compatibility window.
- **M-7. Root `package.json` is a dependency dump** with no name, scripts, or workspace config, duplicating backend and frontend deps. Make it a real workspace root or delete it.
- **M-8. No `.env.example` anywhere.** Required vars (`MONGO_URI`, `JWT_SECRET`, `GOOGLE_*`, `FRONTEND_URL`, `AUTH_BYPASS`) are discoverable only by reading source. `config/passport.js` throws at import time if Google vars are missing, so the whole API fails to boot rather than degrading.
- **M-9. ✅ FIXED 2026-09-09.** `JWT_SECRET` had a literal fallback `'your_jwt_secret'` in `routes/auth.js` (×2) and `middleware/auth.js`. The fallbacks are gone and `app.js` throws at boot if `JWT_SECRET` is unset — a fail-fast beats a silently forgeable token. Verified by `tests/quickWins.test.js`.
- **M-10. ✅ FIXED 2026-09-09.** Added a central `(err, req, res, next)` handler in `app.js` (after the routers) that logs the full error server-side with a short correlation id and returns `{ error, id }` — generic body, no `err.message`. All ~19 route `catch` tails that echoed `error.message` (`analytics`, `extension`, `goals`, `groups`, `leaderboard`, `team`) now `return next(error)`; the deliberate non-500 codes (400/401/403/404/409) are untouched, and `groups /create`'s 400 keeps its status but drops the leak. `try/catch` wrappers kept for now (Express-5 auto-forward cleanup deferred). Verified by `tests/quickWins.test.js` (grep for zero response-body `.message` leaks) + an error-path smoke.
- **M-11. Dashboard fires 3 requests on mount, one redundant** (`useEffect([])` + `useEffect([viewMode])` both call `fetchAnalytics`). `frontend/src/pages/Dashboard.tsx:37-49`.
- **M-13. ✅ FIXED 2026-09-09.** 29 `tsc -b` errors resolved: 20 dead imports/vars, plus 5 implicit-`any` props in the decorative `TextType.tsx` — typing its props (`TextTypeProps`) also fixed the 4 `Type string is not assignable to never` errors in `Dashboard`/`Goals`/`Groups`/`Profile` (all were `textColors={[...]}` on `<TextType>`). The half-built to-do scaffolding in `Goals.tsx` was removed (coordinated with deferred #14 — restore from git if reprioritised). `npm run build` is green; CI (#2) enforces it. `@tanstack/react-query` is still a dependency but unused (M-12).
- **M-12. No client-side caching or request dedup.** Every navigation refetches with `cache:'no-cache'`. React Query (or a small SWR-style hook) would remove most of the traffic.
- **M-14. ✅ FIXED 2026-09-09.** A duplicate group join (double-click / race) returned 500. The `groupmembers` unique compound index throws `11000`; the `/:groupId/join` handler now maps that to `409 Conflict` and no longer echoes `error.message`. Verified by `tests/quickWins.test.js`.
- **M-15. ✅ FIXED 2026-09-09.** `Dashboard.tsx` rendered a hardcoded `repeatedFailuresDaily/Weekly` mock instead of the real `terminalSummary.repeatedFailedCommands` (which the backend already computed and returned). The panel is now wired to the real data with an empty state.
- **M-16. ✅ FIXED 2026-09-10.** Four metric formulas measured something other than their name. (a) `deepWorkRatio = deepMs / focusedMs` divided activity-bounded flow blocks by wall-clock window-focus time — two different clocks, so it could exceed 1. Now `deepMs / totalBlockMs`, bounded [0,1] by construction. (b) `consistencyIndex = 1 − stddev/mean` was computed over **only days with activity** (the daily `$group` emits no zero-days), so it never measured cadence despite the name and the UI label "Consistency"; split into `volumeStability` (robust `1 − MAD/median`) and `activeDaysRatio` (real cadence). (c) `truePeakWindow` had **no sample floor**, so one commit in an hour coded once in 30 days scored 10 and won; the weights (`×10`, `/10`, `/5`) were unvalidated, and the roadmap specifies a **2-hour** window while the code used one. Now a 2-hour window scored on surviving minutes `minutes × (1 − churnRatio)` with a ≥3-distinct-day floor. (d) `estimationCalibration` used a mean and silently required ≥2 goals; now a median with range, usable from one. Plus `confidenceFor()` — every metric ships `meta[name].{confidence,sampleSize,unit}` and `insufficient` renders as "—". Full reasoning in `docs/INSIGHTS_METRICS.md`. **Verified:** `metrics.test.js` (37) + `metricsService.test.js` (35).
- **M-17. ✅ FIXED 2026-09-10.** **No route ever set `Goal.status = 'completed'`** — only `scripts/seed-demo-insights.js` did — so `estimationCalibration` was permanently unreachable in production. Added owner-scoped `PATCH /api/goals/:goalId/complete` + `/reopen`, `Goal.completedAt`, and the Goals-page button. The activity join was also rebuilt: it matched `language === goal.techStack` (exact, case-sensitive, free text) with **no lower time bound**, so a goal tagged "React" matched nothing while one tagged "javascript" matched all history. Now case-insensitive language *or* project, bounded to the goal's lifetime; an unmatched goal is skipped rather than scored 0.

---

- **M-18. ✅ FIXED 2026-09-10.** `impact` could go negative. It scored `netCodeChanges / maxChanges * 5` and clamped only the top with `Math.min(5, x)`; a window where you deleted more than you added produced a negative `impact`, which then dragged the averaged `overall` below zero. A refactor that removes code is not negative impact. `score()` now clamps both ends and rejects non-finite inputs; the leaderboard aggregate also excludes `duration < 0` so corrupt rows cannot subtract from a real total. **Verified:** `tests/leaderboardScore.test.js`.
- **M-19. ✅ FIXED 2026-09-10.** A malformed `:id` answered **500**. Mongoose throws `CastError` the moment it cannot coerce a path parameter, and the central handler's `err.status || 500` had no mapping for it, so `/api/notifications/not-an-id` looked like a server fault. The handler now maps `CastError` → 400 and `ValidationError` → 400 for every route at once, rather than adding an id check to each.
- **M-20. ✅ FIXED 2026-09-10.** All five `routes/notifications.js` handlers answered `res.status(500).json({ message })` in their own `catch`, bypassing the central handler added in M-10 — no correlation id, no CastError mapping. All now `return next(error)`. `DELETE /:id` also answered 200 whether or not anything matched, so deleting another user's notification id looked like it worked; it now 404s, matching the PATCH beside it. `groups /create` likewise reported database outages as `400 Error creating group`.
- **M-21. ✅ FIXED 2026-09-10.** The group leaderboard ranked on hours and lines only. The project's stated motive is friendly competition including *"who's hitting the most errors"*, and `terminalAnalytics` has collected `failedCommands` / `failedBuilds` since the beginning — nothing ever read them back. `/:groupId/details` now returns commits and both failure counts with rates, and the Groups table renders them. Rates are `null` (rendered `—`) when nothing ran, so "never failed a build" and "never ran a build" cannot be confused.

## LOW — polish, DX

- **L-1.** `NotificationPanel` polling closure captures a stale `isOpen`; the inner branch never runs. Use a ref or add the dep.
- **L-2. ✅ FIXED 2026-08-27.** Extension settings `flushIntervalSeconds` and `minFlushMinutes` are declared in `package.json` but hardcoded (30 / 0.1) in `getCfg()` — the user's configuration is silently ignored.
- **L-3.** ~40 `console.log` calls on hot backend paths, including per-request logging of user IDs. Replace with a levelled logger.
- **L-4.** `Dashboard.tsx` is 1,238 lines; `Groups.tsx` 739; `Goals.tsx` 688. Split out chart components and data hooks.
- **L-5.** No tests of any kind. Start with the metrics service (pure functions, high value, easy to fix in place).
- **L-6.** `tsconfig` has `strict: false` in the extension; several `as any` casts hide real bugs (e.g. the stub context in H-12).
- **L-7. Partially addressed 2026-08-27** (activity now stamped with interval start; idle-counting unchanged). Idle time under 2 minutes counts as coding time, so totals skew high. Consider counting only intervals containing a real edit event.
- **L-8. ✅ FIXED 2026-09-09.** `GET /` returned `{status:'ok'}` even with Mongo down. Added `GET /health` returning 503 when `mongoose.connection.readyState !== 1`; `GET /` stays the liveness ping. Point the platform health check at `/health`.
- **L-9. ✅ FIXED 2026-09-09.** No CI. Added `.github/workflows/ci.yml` — three jobs: `backend` (`npm ci && npm test`, node 18), `frontend` (`npm ci && npm run build`, node 20), `extension` (`npm ci && npm test`, node 18; `pretest` builds the bundle). Runs on every push / PR. First real run is on the next push.

---

## Suggested sequencing

1. ~~**Security batch** — H-1, H-2, H-10, H-11, H-9, M-9~~ ✅ (Batch 3, 2026-08-28; M-9 in the quick-wins batch 2026-09-09).
2. ~~**Data-accuracy batch** — H-3, H-4, H-5, H-6~~ ✅ (Batch 1, 2026-08-27).
3. **Aggregation refactor** — M-1, M-2, then H-7, H-8. *(M-2 ✅. M-1/H-7/H-8 open — the `dailysummaries` rollup from the DB-write batch is the foundation; repoint the all-time reads + add `UserStats`, i.e. Quick-Wins #9.)*
4. ~~**AI insights feature**~~ ✅ `/insights` page ships deterministic stats (Batch 3); LLM narration layer still designed-not-built.
5. ~~**Extension cleanup** — H-12, L-2, L-7~~ ✅ (Batch 2, v2.0.11; + v2.3.0 skip-empty flushes).
6. **Everything else** — the **quick-wins Tier 1 + security batch (2026-09-09)** cleared M-3, M-4 (partial), M-10, M-13, M-14, M-15, L-8, L-9, H-13. Remaining Medium/Low + Quick-Wins #9/#10/#13/#14 + Tier 3 as capacity allows.
