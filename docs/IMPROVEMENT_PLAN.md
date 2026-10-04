# CodeTrackr — Improvement Plan

_Findings from the Phase 1 codebase audit. Every item was verified against source, not inferred._
_Companion doc: `ARCHITECTURE.md`._

## Status

**Website redesign — BUILT 2026-10-04, not deployed** (`docs/specs/2026-10-04-frontend-redesign.md`).
Fixed by it: L-4 (big page files), L-5 (frontend tests), M-12 (React Query everywhere), M-34 (goals saved a
day early in India), and L-10 is now explained on screen. Found and still open: M-35 (goal progress stops at
the start of the deadline day), L-14 (no self-serve data deletion).

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

✅ **The two production blockers from `AUDIT` §7 are resolved (2026-09-12).**
1. **Deployed.** `main` was replaced by the branch (the histories were unrelated), Render
   auto-deployed, and Vercel was released from an Instant Rollback by promoting the newest build.
   Render `GET /health` → 200, and real documents now arrive with `bucketStart`.
2. **The extension now sends analytics — with a correction.** The 140 analytics-bearing documents
   the audit counted were **demo data** from `seed-demo-insights.js`, not extension output. Rich
   analytics first reached production on 2026-09-12, verified end to end.

⚠️ **What limits production now is data, not code.** On 2026-09-16: 4 bucketed documents from 1
user, none since 2026-09-12, and 0 completed goals. Every insight is correctly gated to "—" until
more people use the extension, and the machine-learning plan (`docs/ML_INTEGRATION_PLAN.md`,
designed 2026-09-16, not built) is blocked on the same shortage.

~~**A backfill is still outstanding for H-5.**~~ Moot since 2026-09-12: `migrate-drop-date.js --apply`
removed the `date` field and its index from every activity document, and every read path uses
`timestamp`.

**H-23 (2026-10-03, found while building item 12):** browsers blocked every PATCH (goal completion, notification read) — fixed.

**Full re-audit — 2026-10-03.** Every backend route, the ingest path and the extension's flush
logic were re-read against these entries; backend 18 suites / 296 assertions, extension 3 / 52 and
the frontend build all pass. New: **H-22** (the Dashboard's "today" is the wrong day for 5½ hours
of every IST day), **M-29** (group listings leak the creator's email without membership), **M-30**
(held extension payloads are dropped past 3600 s and filed under the newest project/time),
**L-11** (no OAuth `state` check). Stale entries corrected: M-6, L-4, L-5, the H-21 "trap" note.

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

### H-7. Leaderboard does a full-collection scan per request — ✅ FIXED 2026-10-03 (all-time path)
**Problem:** `GET /api/leaderboard` aggregates **every** Activity document ever written, with `$addToSet` on project names, then loads **every** User, merges, sorts and scores in Node. Cost grows linearly with total activity forever. On Vercel's serverless timeout this fails long before the user count becomes interesting.
**Fix:** (1) Add a time window (`timestamp >= 30d ago`) as the default. (2) Move sort + `$limit` into the pipeline. (3) Paginate. (4) Medium-term: a `UserStats` rollup collection updated on ingest or by a scheduled job, so the leaderboard reads N documents for N users.
**Files:** `backend/routes/leaderboard.js`.
**Risk:** Changes the meaning of "total hours" from all-time to windowed — make it an explicit `?period=` param defaulting to all-time only until the rollup exists.

### H-8. Group leaderboard has the same unbounded scan — ✅ FIXED 2026-10-03 (all-time reads members' `userstats`; contest windows scan only that window)
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

### H-23. Browsers blocked every PATCH request — ✅ FIXED 2026-10-03
**Problem:** the CORS config in `app.js` allowed `GET, POST, PUT, DELETE, OPTIONS` — not PATCH. Every PATCH from the dashboard failed at the browser's preflight: goal **Mark complete / Reopen** (shipped 2026-09-10, M-17), notification **mark as read** and **mark all read**. The handlers worked, and every test passed, because server-side tests (and `supertest`) never send a CORS preflight. This is a likely reason the live database had **0 completed goals** (2026-09-16 check), which in turn kept `estimationCalibration` empty.
**Found:** building the group-rename button (item 12), when the browser console showed "Method PATCH is not allowed by Access-Control-Allow-Methods".
**Fix:** add PATCH to `methods`. **Verified:** an integration test sends real preflights for GET/POST/PUT/PATCH/DELETE from the allowed origin and checks an unknown origin is refused; in the browser, rename, goal complete and mark-all-read all return 200.
**Lesson:** API tests must include the browser's view (preflight, cookies); a CORS allow-list is part of the contract.

### H-19. Login is likely broken for Safari, iOS, Firefox, Brave and incognito users — 🟢 DEPLOYED 2026-10-03; Google login works live, Safari/private-window check pending
**Done:** option A (`docs/specs/2026-10-03-first-party-api-proxy.md`). `frontend/vercel.json` forwards `/api/*` and `/auth/*` to Render (before the SPA fallback, caching off); production builds call their own address (`config.ts`: `API_URL = ''` in production). Verified locally: the production bundle contains no API host, and served behind a local stand-in for Vercel every request went to the site's own address. `tests/vercelProxy.test.js` (8) guards the rules. **Go-live (2026-10-03):** Google redirect URI + Render `GOOGLE_CALLBACK_URL` set to `https://code-trackr-frontend.vercel.app/auth/google/callback`; deployed; login works on the live site (after two config errors, see `docs/PROGRESS.md`). **Remaining:** confirm in Safari/a private window; check Vercel's wait limit against a cold Render start.
**Original problem:**
**Problem:** the frontend (`code-trackr-frontend.vercel.app`) and the API (`codetrackr-backend-uckp.onrender.com`) are **different sites** (verified). The JWT is an `httpOnly; SameSite=None; Secure` cookie set by the API host, so on every `fetch(..., {credentials:'include'})` from the frontend it is a **third-party cookie**. Safari (ITP) and Brave block those by default, Firefox's Total Cookie Protection partitions them, and incognito modes block them. The user completes Google sign-in, is redirected back, `GET /api/user/profile` arrives without a cookie, `App.tsx` treats that as signed out — and the student is sent back to login indefinitely.
**Why it went unnoticed:** desktop Chrome still sends third-party cookies, and that is the only browser it was tested in. **Not yet reproduced on a real Safari** — this follows from documented browser behaviour.
**Fix options:** (A, recommended) proxy `/api/*` and `/auth/*` through `frontend/vercel.json` rewrites so the browser only ever talks to one site. Free; needs the Google Cloud redirect URI, Render `GOOGLE_CALLBACK_URL` and Vercel `VITE_API_URL` changed, and `frontend/src/config.ts` must accept an empty base URL (an empty string is falsy and currently falls back to localhost). Risk to test: a cold Render start must finish within Vercel's proxy time limit. (B) a custom domain for both tiers. The extension is unaffected — it authenticates with an API key, not a cookie.
**Related operator check:** the Google OAuth consent screen must be **In production**; in **Testing** it admits only listed test users, whatever the code does. Not visible from the repo.

### H-20. IP-keyed rate limits lock out a whole campus — ✅ FIXED 2026-10-03 (needed anyway: behind the Vercel proxy Render sees Vercel's IPs)
**Done:** `services/rateLimitKeys.js` — group join authenticates first and limits per user; `/api/analytics` limits per login session (hash of the JWT cookie); `/auth` cap raised to 1000/15 min as a flood brake only. Extension and device-code endpoints still see real IPs (the extension calls Render directly). **Verified:** `tests/rateLimitKeys.test.js` (6), `quickWins` source checks, and live in Docker: 10 wrong-password joins by one user → 429 on the 11th, while another user on the same IP was not limited.
**Original problem:**
**Problem:** every limiter is keyed by client IP, and students on college Wi-Fi share one public address. `/auth` allows 50 requests per 15 minutes — about 25 sign-ins **for the entire campus**. `POST /api/groups/:groupId/join` allows 10 per 15 minutes for the entire campus, which breaks the product's core use case (a friend group joining together); worse, `joinLimiter` is mounted **before** `isAuthenticated`, so it cannot key by user even in principle. `/api/analytics` (120/min per IP) is borderline when a class opens dashboards together.
**Fix:** authenticate first and key the join limiter by user id (optionally user + group); key `/api/analytics` by the session cookie, which `cookieParser` already parses before the limiter runs; raise the `/auth` cap, since starting an OAuth redirect is not a meaningful brute-force surface.
**Files:** `backend/app.js`, `backend/routes/groups.js`, `backend/tests/quickWins.test.js`.

### H-21. Leaderboard hours can be inflated with a script — ✅ MITIGATED 2026-10-03
**Problem:** both leaderboards rank by summed `duration`. `POST /api/extension/track` accepts up to 3600 s per upload (`ingestValidation.js`), `/api/extension` allows 120 requests a minute, the batch route has no item limit, and `activityBucket.js` `$inc`s `duration` into a 10-minute record without ever capping it at 600 s. Anyone holding their own API key can therefore add hundreds of hours a minute with `curl`. Found by reading the code; **not exercised against the live API.**
**Why it matters beyond fairness:** fabricated time would corrupt the planned work-type training data, personas and group titles (`docs/ML_INTEGRATION_PLAN.md`).
**Fix:** before the upsert, add only what still fits under 600 s for that user and `bucketStart` (summed across projects and languages); cap batch size. **Trap:** the extension merges held flushes into one payload, so a legitimate long interval can arrive in one upload; spread it across the 10-minute records it covers instead of truncating it. *(Corrected 2026-10-03: the merged payload carries the **newest** interval's timestamp, not the start time — see M-30. Fix M-30 first or the spreading has no correct start to spread from.)*
**Files:** `backend/services/activityBucket.js`, `backend/routes/extension.js`, `backend/tests/activityBucket.test.js`, `backend/tests/ingest.test.js`. Change C-01 in `docs/ML_INTEGRATION_CHANGES.md`.
**Done (2026-10-03):** `services/ingestCredit.js` + `models/WindowUsage.js`. Each upload is credited at most its focus time + 120 s; credited time goes through an atomic per-user, per-window counter capped at 600 s; long uploads are spread over the windows they cover (a legitimate offline hour is credited in full). `duration` now stores credited seconds, `claimedDuration` the raw claim. Per-key quota 60 uploads/min; batch capped at 100 items. **Verified:** `ingestCredit.test.js` (11) and 4 integration tests (offline hour → 6 × 600 s; ten 600 s claims in one window → 600 s credited, 6000 s claimed; no focus → 120 s; batch of 101 → 400); quota checked by hand outside test mode (60 × 401 then 429; another key unaffected). **Residual:** a client can still fake focus time and pace itself, so the ceiling is real-time speed (one credited hour per wall-clock hour), not zero.

### H-22. The Dashboard's "today" is the wrong day for part of every day — ✅ FIXED 2026-10-03
**Problem:** `GET /api/analytics/:userId` and `/timeslot/:userId` compute "midnight today in the user's timezone" as *UTC midnight of the current **UTC** date, shifted by the offset*. That is only right while the UTC date and the user's local date agree. For India (`getTimezoneOffset() = -330`) they disagree from 00:00 to 05:30 IST: at 02:00 IST on 3 Oct the server returns the window for **2 Oct** (verified with `node -e`, output `2026-10-01T18:30:00Z` instead of `2026-10-02T18:30:00Z`). A student coding after midnight — the normal case for this user base — sees yesterday's hours on the "Today" view and their current session missing. West-of-UTC users get the opposite: in the evening "today" is tomorrow and shows empty.
**Why the tests missed it:** `streak.test.js` covers `localDayInfo` (the streak helper, which is correct); the "today" boundary in the two handlers is computed inline and has no test.
**Fix:** derive the local date first — `local = now − offset`, take its UTC y/m/d, then `start = Date.UTC(y, m, d) + offset` — in one shared helper used by both handlers, with a test at 02:00 IST and 20:00 EST.
**Files:** `backend/routes/analytics.js`, `backend/tests/streak.test.js` (or a new `todayWindow.test.js`).
**Done:** new `localMidnightUtc(instant, offset)` in `routes/analytics.js` (local date first, offset clamped to ±14 h), used by the daily and timeslot handlers. **Verified:** 4 new cases in `streak.test.js` (02:00 IST, 10:00 IST, 22:00 EST, UTC) fail on the old logic and pass now; integration test "the daily view returns today's activity".

---

## MEDIUM — maintainability, API and DB efficiency

- **M-1. ✅ FIXED 2026-10-03 (daily + weekly) — Analytics aggregated in JS, not MongoDB.** `services/analyticsViews.js` runs one `$facet` pipeline (timeline, languages, terminal summary, top repeated failures); the daily view now reads today only, not 7 days. Proven equal to the old code by an integration test that runs the old JavaScript (extracted verbatim into `tests/helpers/legacyAnalytics.js`) on the same data — identical except hour values on a .xx5 rounding tie (±0.01). `/timeslot` stays in JS (2-hour window, bounded). *Original:* Every analytics route does `Activity.find()` then `.reduce()`. The daily route pulls 7 days of documents to display one day. Move to `$match`/`$group` pipelines — this is also the prerequisite for the AI metrics service, so do it once and share it. `backend/routes/analytics.js`.
- **M-2. ✅ FIXED 2026-08-27 — Weekly endpoint ignores the timezone offset** the daily endpoint honours, so the two views disagree about which day activity belongs to. `backend/routes/analytics.js:290-310`.
- **M-3. ✅ FIXED 2026-09-09.** `helmet()` is now applied globally (HSTS, `nosniff`, no `X-Powered-By`, frameguard); `express-rate-limit` guards `/auth` (50 / 15 min) and `/api/extension` (120 / min), skipped under `NODE_ENV=test`. `backend/app.js`. Verified by `tests/quickWins.test.js` + a header smoke.
- **M-4. ✅ FIXED 2026-09-09 (partial).** `/track` and `/track/batch` now bounds-check the payload with a pure `services/ingestValidation.js` (`validateIngestPayload`): `duration` in `(0, 3600]` (rejects negative / `1e12` / `NaN`), `fileName` ≤ 255, `language` ≤ 64, `projectName` ≤ 128, `timestamp` within `[now-24h, now+60s]`. Used a pure, unit-tested module (`tests/ingestValidation.test.js`, 23 assertions) rather than `express-validator` middleware — more testable and it slots ahead of the existing normalise/plan pipeline. **Still open:** `timestamp` remains client-supplied (bounded, not server-set), and there's no per-key ingest quota (only the per-IP `/api/extension` limiter from M-3). *(2026-10-03: optional `flushId` idempotency key added — a resend with the same id is applied once.)*
- **M-5. Duplicate/dead code.** `extension/extension.js` (560 lines, legacy v1), `backend/server.js.old`, `backend/new.html`, `backend/newest.java`, 6 ad-hoc scripts in `backend/` and 15 in `backend/tools/`. Move the useful ones under `backend/scripts/`, delete the rest.
- **M-6. 🟡 IN MIGRATION 2026-10-03 — `userId` is a String on Activity but an ObjectId everywhere else.** Expand step done: ingest writes ObjectIds, every read matches both forms (`services/activityUser.js`), every `$group` keys on `$toString: '$userId'`, schema is `Mixed` for the transition. `scripts/migrate-activity-userid.js` (dry run by default) converts the rest, folding a legacy bucket into a new one for the same window. Proven by an integration test: mixed data reads as one user and every number is identical before and after migrating. **Remaining:** operator runs `--apply`; then the contract step (schema → ObjectId, drop the string branch). *Original:* Every join with `users` happens in Node (string-keyed maps in `leaderboard.js` and `groups.js`) and it blocks `$lookup`. *(The old `$regexMatch`/`$toObjectId` workaround was removed in the 2026-09-10 leaderboard rewrite; the type mismatch itself remains.)* Migrate to ObjectId with a compatibility window.
- **M-7. Root `package.json` is a dependency dump** with no name, scripts, or workspace config, duplicating backend and frontend deps. Make it a real workspace root or delete it.
- **M-8. ✅ Mostly fixed.** `backend/.env.example` exists and lists every required variable; the optional `INTERNAL_CRON_SECRET` (H-13) and `ACTIVITY_BUCKET_MS` were added as commented entries 2026-09-11. **Still open:** `config/passport.js` throws at import time if the Google vars are missing, so the whole API fails to boot rather than degrading.
- **M-9. ✅ FIXED 2026-09-09.** `JWT_SECRET` had a literal fallback `'your_jwt_secret'` in `routes/auth.js` (×2) and `middleware/auth.js`. The fallbacks are gone and `app.js` throws at boot if `JWT_SECRET` is unset — a fail-fast beats a silently forgeable token. Verified by `tests/quickWins.test.js`.
- **M-10. ✅ FIXED 2026-09-09.** Added a central `(err, req, res, next)` handler in `app.js` (after the routers) that logs the full error server-side with a short correlation id and returns `{ error, id }` — generic body, no `err.message`. All ~19 route `catch` tails that echoed `error.message` (`analytics`, `extension`, `goals`, `groups`, `leaderboard`, `team`) now `return next(error)`; the deliberate non-500 codes (400/401/403/404/409) are untouched, and `groups /create`'s 400 keeps its status but drops the leak. `try/catch` wrappers kept for now (Express-5 auto-forward cleanup deferred). Verified by `tests/quickWins.test.js` (grep for zero response-body `.message` leaks) + an error-path smoke.
- **M-11. ✅ FIXED 2026-10-03 — Dashboard fired 3 requests on mount, one redundant.** Now two React Query queries (daily, weekly), cached 30 s; seen in the browser's network log. *Original:* (`useEffect([])` + `useEffect([viewMode])` both call `fetchAnalytics`). `frontend/src/pages/Dashboard.tsx:37-49`.
- **M-13. ✅ FIXED 2026-09-09.** 29 `tsc -b` errors resolved: 20 dead imports/vars, plus 5 implicit-`any` props in the decorative `TextType.tsx` — typing its props (`TextTypeProps`) also fixed the 4 `Type string is not assignable to never` errors in `Dashboard`/`Goals`/`Groups`/`Profile` (all were `textColors={[...]}` on `<TextType>`). The half-built to-do scaffolding in `Goals.tsx` was removed (coordinated with deferred #14 — restore from git if reprioritised). `npm run build` is green; CI (#2) enforces it. `@tanstack/react-query` is still a dependency but unused (M-12).
- **M-12. ✅ FIXED 2026-10-04 — No client-side caching or request dedup.** Every read on every page now goes through typed React Query hooks (`frontend/src/hooks/queries.ts`; 30 s cache, dedup, refetch on focus), including Groups, Goals, Profile and the notification poll; writes invalidate the matching queries. *Original:* Every navigation refetches with `cache:'no-cache'`. React Query (or a small SWR-style hook) would remove most of the traffic.
- **M-14. ✅ FIXED 2026-09-09.** A duplicate group join (double-click / race) returned 500. The `groupmembers` unique compound index throws `11000`; the `/:groupId/join` handler now maps that to `409 Conflict` and no longer echoes `error.message`. Verified by `tests/quickWins.test.js`.
- **M-15. ✅ FIXED 2026-09-09.** `Dashboard.tsx` rendered a hardcoded `repeatedFailuresDaily/Weekly` mock instead of the real `terminalSummary.repeatedFailedCommands` (which the backend already computed and returned). The panel is now wired to the real data with an empty state.
- **M-16. ✅ FIXED 2026-09-10.** Four metric formulas measured something other than their name. (a) `deepWorkRatio = deepMs / focusedMs` divided activity-bounded flow blocks by wall-clock window-focus time — two different clocks, so it could exceed 1. Now `deepMs / totalBlockMs`, bounded [0,1] by construction. (b) `consistencyIndex = 1 − stddev/mean` was computed over **only days with activity** (the daily `$group` emits no zero-days), so it never measured cadence despite the name and the UI label "Consistency"; split into `volumeStability` (robust `1 − MAD/median`) and `activeDaysRatio` (real cadence). (c) `truePeakWindow` had **no sample floor**, so one commit in an hour coded once in 30 days scored 10 and won; the weights (`×10`, `/10`, `/5`) were unvalidated, and the roadmap specifies a **2-hour** window while the code used one. Now a 2-hour window scored on surviving minutes `minutes × (1 − churnRatio)` with a ≥3-distinct-day floor. (d) `estimationCalibration` used a mean and silently required ≥2 goals; now a median with range, usable from one. Plus `confidenceFor()` — every metric ships `meta[name].{confidence,sampleSize,unit}` and `insufficient` renders as "—". Full reasoning in `docs/INSIGHTS_METRICS.md`. **Verified:** `metrics.test.js` (37) + `metricsService.test.js` (35).
- **M-17. ✅ FIXED 2026-09-10.** **No route ever set `Goal.status = 'completed'`** — only `scripts/seed-demo-insights.js` did — so `estimationCalibration` was permanently unreachable in production. Added owner-scoped `PATCH /api/goals/:goalId/complete` + `/reopen`, `Goal.completedAt`, and the Goals-page button. The activity join was also rebuilt: it matched `language === goal.techStack` (exact, case-sensitive, free text) with **no lower time bound**, so a goal tagged "React" matched nothing while one tagged "javascript" matched all history. Now case-insensitive language *or* project, bounded to the goal's lifetime; an unmatched goal is skipped rather than scored 0.

---

- **M-18. ✅ FIXED 2026-09-10.** `impact` could go negative. It scored `netCodeChanges / maxChanges * 5` and clamped only the top with `Math.min(5, x)`; a window where you deleted more than you added produced a negative `impact`, which then dragged the averaged `overall` below zero. A refactor that removes code is not negative impact. `score()` now clamps both ends and rejects non-finite inputs; the leaderboard aggregate also excludes `duration < 0` so corrupt rows cannot subtract from a real total. **Verified:** `tests/leaderboardScore.test.js`.
- **M-19. ✅ FIXED 2026-09-10.** A malformed `:id` answered **500**. Mongoose throws `CastError` the moment it cannot coerce a path parameter, and the central handler's `err.status || 500` had no mapping for it, so `/api/notifications/not-an-id` looked like a server fault. The handler now maps `CastError` → 400 and `ValidationError` → 400 for every route at once, rather than adding an id check to each.
- **M-20. ✅ FIXED 2026-09-10.** All five `routes/notifications.js` handlers answered `res.status(500).json({ message })` in their own `catch`, bypassing the central handler added in M-10 — no correlation id, no CastError mapping. All now `return next(error)`. `DELETE /:id` also answered 200 whether or not anything matched, so deleting another user's notification id looked like it worked; it now 404s, matching the PATCH beside it. `groups /create` likewise reported database outages as `400 Error creating group`.
- **M-21. ✅ FIXED 2026-09-10.** The group leaderboard ranked on hours and lines only. The project's stated motive is friendly competition including *"who's hitting the most errors"*, and `terminalAnalytics` has collected `failedCommands` / `failedBuilds` since the beginning — nothing ever read them back. `/:groupId/details` now returns commits and both failure counts with rates, and the Groups table renders them. Rates are `null` (rendered `—`) when nothing ran, so "never failed a build" and "never ran a build" cannot be confused.

- **M-22. ✅ FIXED 2026-09-12.** `activeDaysRatio` could only ever return **1** (or 0). `observedDays` was `Math.min(days, Math.max(activeDays, 1))`, and since a user can never have more active days than the window is long, that `min` always chose `activeDays` — so the ratio was `activeDays / activeDays`. The metric created in M-16(b) specifically to measure cadence measured nothing, and the `cadence-low` rule (fires below 0.3) could never fire. `observedDays` is now the span from the first active day in the window through today, capped at the window. Found by reading real output: 27 active days of 30, and 42 of 90, both reported 1.0; the same account now reports 0.48. **Verified:** `metricsService.test.js` regression case.
- **M-23. ✅ FIXED 2026-09-12 (Quick-Wins #16).** `GET /api/leaderboard` returned **every user's email address** to every signed-in user — 35 accounts on the live install. The field is gone from the projection and the response, and `Leaderboard.tsx` no longer renders the handle derived from it. **Verified:** `quickWins.test.js` asserts no email in the projection or the response row.
- **M-24. ✅ FIXED 2026-09-12.** Rate limiting extended beyond `/auth` + `/api/extension` (M-3): `POST /api/groups/:groupId/join` now allows 10 attempts per IP per 15 minutes — a private group is gated by one shared password, so it was an unlimited brute-force surface — and `/api/analytics` is capped at 120/min because each call is unbounded aggregation work (M-1). Both skipped under `NODE_ENV=test`. **Verified:** `quickWins.test.js`.

- **M-25. ✅ FIXED 2026-10-03 — Onboarding linked to a placeholder Marketplace URL.** Now `itemName=CodeTrackr-ext.codetrackr-vscode`. `frontend/src/pages/Onboarding.tsx:157` points at `itemName=YOUR_PUBLISHER.codetrackr`, which 404s. Every new user who clicks "Open Marketplace" during setup lands on a dead page. The real identifier is `CodeTrackr-ext.codetrackr-vscode`. Found 2026-09-12. Fix before sharing the site publicly.

- **M-26. ✅ FIXED 2026-10-03 — Cancelling Google sign-in landed on an API error page.** `failureRedirect` is now `${FRONTEND_URL}/login?error=signin` and the login page shows a short message; verified by an integration test. `routes/auth.js` passes `failureRedirect: '/login'`, a relative path that resolves against the **API** host. A student who clicks Cancel on Google's consent screen is sent to `codetrackr-backend-uckp.onrender.com/login` and sees **404 "Cannot GET /login"** (verified). Fix: redirect to `${FRONTEND_URL}/login`.
- **M-27. ✅ FIXED 2026-10-03 — Onboarding failed silently.** It now shows an error with a retry (and a hint about cookies, the likely H-19 cause); the key step generates a key and shows it once. *Original:* `Onboarding.tsx` sets the API key only `if (data.success)` and otherwise renders an empty key box with no message, so a failed profile load — exactly what H-19 produces — looks like the app simply has no key to give. Fix: an explicit error state with a retry.
- **M-28. ✅ FIXED 2026-10-03 (with M-29) — Group details exposed every member's email.** Projections are `name` only, both response fields are gone, and `Groups.tsx` shows the join date instead; an integration test asserts no email in `/discover`, `/my-groups` or `/details`. `GET /api/groups/:groupId/details` populates `userId` with `'name email'` and returns `email` in both `members` and `leaderboard`; `Groups.tsx` renders it (lines 576, 630). Any signed-in user can join a public group and read every member's address — the same class of leak M-23 fixed on the global leaderboard. Fix: drop `email` from the projections and responses, stop rendering it, and assert its absence in `quickWins.test.js`. Change C-02 in `docs/ML_INTEGRATION_CHANGES.md`.
- **M-29. ✅ FIXED 2026-10-03 — Group listings exposed the creator's email to every signed-in user.** Wider than M-28: `GET /api/groups/discover` populates `createdBy` with `'name email'` for up to 100 groups the caller has **not** joined, so no membership is needed at all; `/my-groups` and `/:groupId/details` do the same. Fix together with M-28: project `createdBy` to `name` only and assert it in `quickWins.test.js`. `backend/routes/groups.js:79,114,141`.
- **M-30. ✅ FIXED 2026-10-03 (extension 2.5.0, live since 2026-10-04) — Held extension payloads were merged lossily.** Now a persisted outbox (`extension/src/outbox.ts`, `globalState`) keeps each upload separate with its own `flushId`, sent oldest first; only contiguous signal-less intervals are merged, starting at the earlier timestamp. Verified by `extension/tests/outbox.test.js` (10). *Correction to the original text:* the merged timestamp was re-stamped as `now − summed duration` at the end of `mergeAnalytics`, not taken from the newest interval; the effect (held time filed later than it happened) is the same. *Original:* When an upload fails, the API key is missing, or a flush has no signal, extension 2.4.0 holds the payload and merges it into the next one (`mergeAnalytics`, H-14 fix). Two problems with that merge: (a) `duration` sums, and `sendActivity` deliberately **drops** any payload over 3600 s as a "clock jump" — so about an hour of active coding while offline, or before a new user pastes their key, is discarded in full, not trimmed; a merged payload whose `timestamp` falls more than 24 h back is rejected with 400, which the extension also treats as "drop". (b) `timestamp`, `projectName` and `language` are in `NEWER_KEYS`, so the whole held interval is filed under the **newest** interval's time, project and language — an hour of Python on project A, uploaded during a minute of TypeScript on project B, is recorded as TypeScript on B. Fix: keep a small queue of per-interval payloads (persisted to `globalState`, which also closes the restart-loss gap) and upload them individually instead of merging across intervals. `extension/src/extension.ts:160-215, 385-405`, `extension/tests/flushSafety.test.js`.

- **M-35. OPEN (found 2026-10-04) — Goal progress stops at the start of the deadline day.** `goalActivityQuery` (`routes/goals.js`) counts activity up to `goal.deadline` while a goal is open. Deadlines are stored as UTC midnight of the chosen date (2026-10-20T00:00Z = 05:30 IST on the 20th), so most of the deadline day itself never counts. Fix: use the end of the deadline day (in the user's time zone, or +24 h as a simple bound) as the upper limit; add an integration test with a session on the deadline day.
- **M-34. ✅ FIXED 2026-10-04 — The Goals calendar created goals one day early in India.** The old page built the deadline as `new Date(y, m, d).toISOString().split('T')[0]`: local midnight in India is 18:30 UTC the day before, so clicking 10 Oct saved 9 Oct, and the calendar's goal dots were matched the same way. Found while rewriting the page; the redesign sends the picked date as a local `YYYY-MM-DD` key (`localDateKey`). `frontend/src/lib/format.test.ts` runs in `Asia/Kolkata` and asserts both the old and new results; checked in the browser.
- **M-33. OPEN (found 2026-10-03 at go-live) — A failed Google sign-in shows raw JSON.** `routes/auth.js` sets `failureRedirect` to `/login?error=signin`, but that only covers a *refused* login (user cancels). When the strategy *throws* — e.g. `TokenError: invalid_client` from a wrong client secret, or Google being unreachable — the error goes to the central handler and the browser shows `{"error":"Internal server error","id":…}`. Fix: a custom `passport.authenticate` callback that logs the error with the request id and redirects to `/login?error=signin`; integration test that stubs a failing token exchange.
- **M-32. ✅ FIXED 2026-10-03 — Weekly totals included a day the chart did not show.** The window started at the *server's* midnight seven days back (`setHours(0)` on Render = UTC), while the chart shows the last seven *local* days, so `totalHours`, languages and the terminal summary could include up to a day more than the bars added up to. The window is now local midnight six days ago; an integration test asserts the total equals the sum of the bars. Found while writing the M-1 equivalence test.
- **M-31. ✅ FIXED 2026-10-03 — Goal progress dropped the 10-minute window the goal was created in.** Bucketed activity is stamped with its window start, so work done right after creating a goal sits in a document whose `timestamp` is *before* `createdAt`, and `$gte: createdAt` excluded it. Same bug in `metricsService.buildGoalPairs` (estimation calibration). Fix: floor the lower bound with `bucketStartFor`. **Found by the first integration test run** (`tests/integration/api.int.test.js`); the test fails without the fix and passes with it.

## LOW — polish, DX

- **L-1. ✅ FIXED 2026-09-12.** `NotificationPanel`'s polling effect had `[]` deps, so its `isOpen` was frozen at the first-render value and the `if (isOpen) fetchNotifications()` branch never ran — an open panel never refreshed. Now read through `isOpenRef`, kept current by a small sync effect.
- **L-2. ✅ FIXED 2026-08-27.** Extension settings `flushIntervalSeconds` and `minFlushMinutes` are declared in `package.json` but hardcoded (30 / 0.1) in `getCfg()` — the user's configuration is silently ignored.
- **L-3. ✅ FIXED 2026-10-03.** Was ~40 `console.log` calls on hot paths, including per-request user ids. Now `services/logger.js` (JSON lines, `LOG_LEVEL`), one access-log line per request with `X-Request-Id` (`middleware/requestId.js`), errors logged with the same id the client sees; no `console.*` remains in app code.
- **L-4. ✅ FIXED 2026-10-04 (redesign) — Big page files.** Was `Dashboard.tsx` 1,217 lines, `Groups.tsx` 789, `Goals.tsx` 623. Now the largest page is `GroupBoard.tsx` at 393 lines; the dashboard is 247 lines plus `pages/dashboard/` cards, charts are shared components and data hooks live in `hooks/queries.ts`.
- **L-5. ✅ ADDRESSED 2026-10-04.** Was "no tests of any kind". Now backend unit 27 suites (375 assertions), an integration suite (39 tests, real Express app + in-memory MongoDB over HTTP), extension 6 suites (70), and since 2026-10-04 frontend Vitest tests (51: date and standings logic, chart components, routing), all in CI. **Still open:** no end-to-end browser tests (Playwright is the next step, D-34).
- **L-6.** `tsconfig` has `strict: false` in the extension; several `as any` casts hide real bugs (e.g. the stub context in H-12).
- **L-7. Partially addressed 2026-08-27** (activity now stamped with interval start; idle-counting unchanged). Idle time under 2 minutes counts as coding time, so totals skew high. Consider counting only intervals containing a real edit event.
- **L-8. ✅ FIXED 2026-09-09.** `GET /` returned `{status:'ok'}` even with Mongo down. Added `GET /health` returning 503 when `mongoose.connection.readyState !== 1`; `GET /` stays the liveness ping. Point the platform health check at `/health`.
- **L-9. ✅ FIXED 2026-09-09.** No CI. Added `.github/workflows/ci.yml` — three jobs: `backend` (`npm ci && npm test`, node 18), `frontend` (`npm ci && npm run build`, node 20), `extension` (`npm ci && npm test`, node 18; `pretest` builds the bundle). Runs on every push / PR. First real run is on the next push.
- **L-10. Render free-tier cold start — OPEN.** *(2026-10-03: the CD workflow's health wait allows for it; still user-visible.)* After ~15 idle minutes the first request takes ~22 s (measured 2026-09-16 on `GET /health`). Operational rather than a code defect, but a new visitor sees a frozen page and assumes the site is broken. Options: say so on the page, a keep-warm ping, or a paid instance. *(2026-10-04: the website now says so: after 2.5 s of waiting it shows "Waking up the server … about 20 seconds", and public pages no longer wait for the API at all.)*
- **L-11. ✅ FIXED 2026-10-03 — Google sign-in had no OAuth `state` check.** Now a custom passport state store (`services/oauthState.js`) puts a random nonce in a 10-minute httpOnly `SameSite=Lax` cookie scoped to `/auth` and compares it in constant time on the callback; verified by an integration test with a forged state.
  *Problem was:* `routes/auth.js` runs `passport.authenticate('google', { session: false })` without `state`, so the callback cannot tell whether it answers a login this browser started. That allows login CSRF: an attacker can make a victim's browser finish the attacker's sign-in, so the victim's dashboard (and anything they create) belongs to the attacker's account. Low impact here — there is nothing private to plant — but it is the standard OAuth check. Fix: a short-lived signed `state` cookie set on `/auth/google` and compared on the callback (passport's built-in `state: true` needs a session store, which this app deliberately does not have).
- **L-15. OPEN (found 2026-10-04) — CI and the Docker images still run Node 20, which reached end of life in April 2026.** All three CI jobs (`.github/workflows/ci.yml`), `backend/Dockerfile` and `frontend/Dockerfile.dev` use Node 20. The website's test runner, Vitest 5, officially needs Node 22 or newer (`npm ci` prints `EBADENGINE`), though it works today: lint, 51 tests and the build all passed inside the Node 20 dev container on 2026-10-04. Laptops already use Node 24. **Website part done 2026-10-04 (D-38):** the CI frontend job and `frontend/Dockerfile.dev` now use Node 24 (clean `npm ci`, lint, 51 tests and the build pass in a `node:24-alpine` container, and in `node:20-alpine` too). **Still open, the API part:** `backend/Dockerfile` and the backend and extension CI jobs are on Node 20, and `backend/package.json` has no `engines` field, so Render runs whatever Node version the service is set to. Fix: check that version on Render, set `engines.node`, move the image and the two jobs to Node 24, run every suite, redeploy and watch `/health`. It changes the production runtime, so the user decides when.
- **L-14. OPEN (found 2026-10-04) — No self-serve way to delete your data.** Written into the new privacy page honestly: people must open a GitHub issue. A Delete account button (remove activity, goals, notifications, memberships, device tokens, stats; leave groups) is the fix.
- **L-13. ✅ FIXED 2026-10-04 — Error reporting missed errors that never reached the central handler.** Sentry was called only in `app.js`'s error handler, so the four routes that send their own 500 (`routes/user.js` profile/regenerate/onboarding, `routes/metrics.js`), the in-process scheduler's job failures, the degraded rules-engine path and process-level crashes reached only the Render log. Now every `log.error` is reported (`services/errorReporter.js`, D-30); `unhandledRejection`/`uncaughtException` are handled; the access line for a 5xx is not reported twice. **Verified:** `tests/errorReporter.test.js` (9), an integration test (route-level 500 reported with the request id the client saw; a 400 not reported), and the real `@sentry/node` sent one event to a local stand-in server carrying the request id and path and no user id.
- **L-12. ✅ FIXED 2026-10-03 — The OAuth callback logged the whole user document, API key included.** Now logs the user id only. (Found while fixing L-11.)

---

## Suggested sequencing

1. ~~**Security batch** — H-1, H-2, H-10, H-11, H-9, M-9~~ ✅ (Batch 3, 2026-08-28; M-9 in the quick-wins batch 2026-09-09).
2. ~~**Data-accuracy batch** — H-3, H-4, H-5, H-6~~ ✅ (Batch 1, 2026-08-27).
3. **Aggregation refactor** — M-1, M-2, then H-7, H-8. *(M-2 ✅. M-1/H-7/H-8 open — the `dailysummaries` rollup from the DB-write batch is the foundation; repoint the all-time reads + add `UserStats`, i.e. Quick-Wins #9.)*
4. ~~**AI insights feature**~~ ✅ `/insights` page ships deterministic stats (Batch 3); LLM narration layer still designed-not-built.
5. ~~**Extension cleanup** — H-12, L-2, L-7~~ ✅ (Batch 2, v2.0.11; + v2.3.0 skip-empty flushes).
6. **Everything else** — the **quick-wins Tier 1 + security batch (2026-09-09)** cleared M-3, M-4 (partial), M-10, M-13, M-14, M-15, L-8, L-9, H-13. Remaining Medium/Low + Quick-Wins #9/#10/#13/#14 + Tier 3 as capacity allows.
