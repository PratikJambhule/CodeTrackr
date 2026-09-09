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
hash on the next successful join. A new `/insights` page surfaces the five Phase A metrics.

**Frontend build — ✅ FIXED 2026-09-09 (M-13).** `npm run build` (`tsc -b && vite build`) had
**29 pre-existing TypeScript errors** (16 in `Goals.tsx`, 5 in `TextType.tsx`, 3 each in
`Groups.tsx`/`Dashboard.tsx`, 1 each in `Teams.tsx`/`Profile.tsx`). All resolved: dead
imports/vars removed, `TextType.tsx` given a `TextTypeProps` interface (which also fixed the 4
`string`→`never` errors in the pages that pass `textColors`), and the half-built `Goals.tsx`
to-do scaffolding removed. `npm run build` is green; CI (#2) keeps it that way.

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

### H-13. `node-cron` scheduler is incompatible with serverless deploy
**Problem:** `app.js` calls `initScheduler()` at module load and `app.listen()` unconditionally. On Vercel (`api/index.js`), each cold start re-runs the immediate `checkUpcomingDeadlines()` + `checkOverdueGoals()` sweep, and the hourly cron never fires because the process is frozen between requests. `checkOverdueGoals` does an unindexed `findOne` per overdue goal on every invocation.
**Fix:** Guard `app.listen()` behind `require.main === module`. Move the schedule to Vercel Cron / an external scheduler hitting a protected `POST /api/internal/run-notifications`. Add an index on `{goalId:1, type:1}`.
**Files:** `backend/app.js`, `backend/services/notificationScheduler.js`, `backend/vercel.json`.

---

## MEDIUM — maintainability, API and DB efficiency

- **M-1. Analytics aggregate in JS, not MongoDB.** Every analytics route does `Activity.find()` then `.reduce()`. The daily route pulls 7 days of documents to display one day. Move to `$match`/`$group` pipelines — this is also the prerequisite for the AI metrics service, so do it once and share it. `backend/routes/analytics.js`.
- **M-2. ✅ FIXED 2026-08-27 — Weekly endpoint ignores the timezone offset** the daily endpoint honours, so the two views disagree about which day activity belongs to. `backend/routes/analytics.js:290-310`.
- **M-3. ✅ FIXED 2026-09-09.** `helmet()` is now applied globally (HSTS, `nosniff`, no `X-Powered-By`, frameguard); `express-rate-limit` guards `/auth` (50 / 15 min) and `/api/extension` (120 / min), skipped under `NODE_ENV=test`. `backend/app.js`. Verified by `tests/quickWins.test.js` + a header smoke.
- **M-4. No request validation.** `express-validator` is installed and unused; `/track` accepts any `duration` (negative, `1e12`, `NaN`) and `!duration` rejects a legitimate `0`. Add a validator + sane bounds (e.g. `0 < duration <= 3600`).
- **M-5. Duplicate/dead code.** `extension/extension.js` (560 lines, legacy v1), `backend/server.js.old`, `backend/new.html`, `backend/newest.java`, 6 ad-hoc scripts in `backend/` and 15 in `backend/tools/`. Move the useful ones under `backend/scripts/`, delete the rest.
- **M-6. `userId` is a String on Activity but an ObjectId everywhere else.** Forces the `$regexMatch`/`$toObjectId` gymnastics in `leaderboard.js` and blocks `$lookup`. Migrate to ObjectId with a compatibility window.
- **M-7. Root `package.json` is a dependency dump** with no name, scripts, or workspace config, duplicating backend and frontend deps. Make it a real workspace root or delete it.
- **M-8. No `.env.example` anywhere.** Required vars (`MONGO_URI`, `JWT_SECRET`, `GOOGLE_*`, `FRONTEND_URL`, `AUTH_BYPASS`) are discoverable only by reading source. `config/passport.js` throws at import time if Google vars are missing, so the whole API fails to boot rather than degrading.
- **M-9. ✅ FIXED 2026-09-09.** `JWT_SECRET` had a literal fallback `'your_jwt_secret'` in `routes/auth.js` (×2) and `middleware/auth.js`. The fallbacks are gone and `app.js` throws at boot if `JWT_SECRET` is unset — a fail-fast beats a silently forgeable token. Verified by `tests/quickWins.test.js`.
- **M-10. No error-handling middleware.** Every route try/catches and echoes `error.message` to the client, leaking internals. Add a central error handler.
- **M-11. Dashboard fires 3 requests on mount, one redundant** (`useEffect([])` + `useEffect([viewMode])` both call `fetchAnalytics`). `frontend/src/pages/Dashboard.tsx:37-49`.
- **M-13. ✅ FIXED 2026-09-09.** 29 `tsc -b` errors resolved: 20 dead imports/vars, plus 5 implicit-`any` props in the decorative `TextType.tsx` — typing its props (`TextTypeProps`) also fixed the 4 `Type string is not assignable to never` errors in `Dashboard`/`Goals`/`Groups`/`Profile` (all were `textColors={[...]}` on `<TextType>`). The half-built to-do scaffolding in `Goals.tsx` was removed (coordinated with deferred #14 — restore from git if reprioritised). `npm run build` is green; CI (#2) enforces it. `@tanstack/react-query` is still a dependency but unused (M-12).
- **M-12. No client-side caching or request dedup.** Every navigation refetches with `cache:'no-cache'`. React Query (or a small SWR-style hook) would remove most of the traffic.
- **M-14. ✅ FIXED 2026-09-09.** A duplicate group join (double-click / race) returned 500. The `groupmembers` unique compound index throws `11000`; the `/:groupId/join` handler now maps that to `409 Conflict` and no longer echoes `error.message`. Verified by `tests/quickWins.test.js`.
- **M-15. ✅ FIXED 2026-09-09.** `Dashboard.tsx` rendered a hardcoded `repeatedFailuresDaily/Weekly` mock instead of the real `terminalSummary.repeatedFailedCommands` (which the backend already computed and returned). The panel is now wired to the real data with an empty state.

---

## LOW — polish, DX

- **L-1.** `NotificationPanel` polling closure captures a stale `isOpen`; the inner branch never runs. Use a ref or add the dep.
- **L-2. ✅ FIXED 2026-08-27.** Extension settings `flushIntervalSeconds` and `minFlushMinutes` are declared in `package.json` but hardcoded (30 / 0.1) in `getCfg()` — the user's configuration is silently ignored.
- **L-3.** ~40 `console.log` calls on hot backend paths, including per-request logging of user IDs. Replace with a levelled logger.
- **L-4.** `Dashboard.tsx` is 1,238 lines; `Groups.tsx` 739; `Goals.tsx` 688. Split out chart components and data hooks.
- **L-5.** No tests of any kind. Start with the metrics service (pure functions, high value, easy to fix in place).
- **L-6.** `tsconfig` has `strict: false` in the extension; several `as any` casts hide real bugs (e.g. the stub context in H-12).
- **L-7. Partially addressed 2026-08-27** (activity now stamped with interval start; idle-counting unchanged). Idle time under 2 minutes counts as coding time, so totals skew high. Consider counting only intervals containing a real edit event.
- **L-8. ✅ FIXED 2026-09-09.** `GET /` returned `{status:'ok'}` even with Mongo down. Added `GET /health` returning 503 when `mongoose.connection.readyState !== 1`; `GET /` stays the liveness ping. Point the platform health check at `/health`.

---

## Suggested sequencing

1. **Security batch** — H-1, H-2, H-10, H-11, H-9, M-9. Small diffs, no behaviour change for legitimate users.
2. **Data-accuracy batch** — H-3, H-4, H-5, H-6. Fixes the numbers the AI layer will be grounded in. **Must land before AI work.**
3. **Aggregation refactor** — M-1, M-2, then H-7, H-8. Produces the shared metrics service the AI layer consumes.
4. **AI insights feature** — see `AI_INSIGHTS_DESIGN.md`.
5. **Extension cleanup** — H-12, L-2, L-7 (batched into one republish).
6. **Everything else** — Medium/Low as capacity allows.
