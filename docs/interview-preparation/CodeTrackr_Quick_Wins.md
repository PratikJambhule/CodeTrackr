# CodeTrackr — Quick Wins for Interview Impact

*A curated shortlist of changes that are **cheap to implement** but **signal strong
engineering judgement** and **add real value**. Everything here is verified against the
current code on branch `feat/security-and-insights`.*

*The full backlog lives in [`docs/IMPROVEMENT_PLAN.md`](../IMPROVEMENT_PLAN.md). This file is
the interview-focused subset: for each item you get the fix **and the sentence you say about
it**.*

**Effort key:** 🟢 ≤ 1 hr · 🟡 2–4 hrs · 🟠 half a day

---

## How to use this

1. Do the **Tier 1** items first — they fix things that would otherwise embarrass you in a
   code walkthrough, and each is nearly risk-free.
2. Pick **2–3 Tier 2** items to have a real story about ("I noticed X was O(n), so I…").
3. After every change, add a line to `docs/IMPROVEMENT_PLAN.md` marking it fixed and a note
   in the commit message — the *paper trail itself* is a talking point.

**Suggested first weekend (in order):** fix the build → CI workflow → `helmet` + rate limit →
central error handler → `timestamp` index → real data in the "Repeated Failures" panel →
`UserStats` leaderboard rollup.

---

# Tier 1 — Do these first (fix something broken, ~1 hr each, near-zero risk)

## 1. Make the frontend actually build 🟡

**The flaw:** `npm run build` runs `tsc -b && vite build` and **fails** — `tsc -b` reports
29 pre-existing TypeScript errors (mostly unused imports/variables; 2 real
`string not assignable to never` in `Dashboard.tsx` and `Goals.tsx`).

**Why it matters:** a portfolio project whose build is red is the first thing a reviewer
notices, and it blocks every other improvement that depends on CI.

**Do:** delete the unused imports/vars; for the two real errors, type the chart-dataset
arrays explicitly (e.g. `const data: number[] = []`). Run `npx tsc -b --noEmit` until clean.

**Say:** *"The first thing I fixed was the build. There were 29 TypeScript errors that had
accumulated because nothing enforced the typecheck — mostly dead imports, two were real type
narrowing bugs. Now `npm run build` is green and CI keeps it that way."*

**Shows:** you care about a green build; you can read TS compiler errors.

---

## 2. Add a CI workflow 🟢

**The gap:** no CI at all — no `.github/workflows`, no automated check on push.

**Why it matters:** a green check on the repo is instant credibility, and it stops the build
from silently rotting again (see #1).

**Do:** add `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18 }
      - run: cd backend && npm ci && npm test
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd frontend && npm ci && npm run build
  extension:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18 }
      - run: cd extension && npm ci && npm test
```

**Say:** *"I added a CI pipeline that runs the backend and extension test suites and the
frontend typecheck on every push, so a regression can't merge silently."*

**Shows:** you know CI basics, matrix-ish jobs, `npm ci` vs `npm install`.
**Follow-up you can handle:** "why `npm ci`?" (reproducible installs from the lockfile).

---

## 3. Wire up the security middleware that's already installed 🟢

**The flaw:** `helmet` and `express-rate-limit` are in `backend/package.json` but **never
used**. No security headers, no rate limit on anything — including `/auth/google` and the
activity-ingest route.

**Do:** in `backend/app.js`:

```js
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

app.use(helmet());
app.use('/auth', rateLimit({ windowMs: 15 * 60_000, max: 50 }));
app.use('/api/extension', rateLimit({ windowMs: 60_000, max: 120 }));
```

**Say:** *"`helmet` and a rate limiter were already dependencies but not wired in — the old
`server.js` had them and the rewrite dropped them. I re-added `helmet` for the standard
headers and put per-IP limits on the auth and ingest routes so they can't be flooded or
brute-forced."*

**Shows:** you know what `helmet` does (HSTS, `X-Content-Type-Options`, no `X-Powered-By`),
you think about abuse vectors, you read the git history.

---

## 4. Central error handler — stop leaking internals 🟢

**The flaw:** every route does its own `try/catch` and returns
`res.status(500).json({ message, error: error.message })` — that ships Mongoose error text,
field names, and stack hints to the client.

**Do:** add at the **end** of `backend/app.js` (after the routers):

```js
app.use((err, req, res, next) => {
  const id = Math.random().toString(36).slice(2, 10);
  console.error(`[${id}]`, err);
  res.status(err.status || 500).json({ error: 'Internal server error', id });
});
```

Then in the routes, replace `catch (e) { res.status(500).json({error: e.message}) }` with
`catch (e) { next(e) }`. (Express 5 auto-forwards rejected promises, so many `try/catch`
blocks can go entirely.)

**Say:** *"Every route was echoing `error.message` to the client, which leaks internal
detail. I added one error-handling middleware that logs the full error server-side with a
short correlation ID and returns a generic body with just that ID."*

**Shows:** information-disclosure awareness, Express middleware model, correlation IDs.

---

## 5. Add the missing database index 🟢 — ✅ DONE 2026-09-08 (shipped in the DB write-reduction batch)

> **Shipped.** `activitySchema.index({ userId: 1, timestamp: -1 })` is in `backend/models/Activity.js`;
> the dead `{userId:1,date:-1}` index and the `date` field are gone. Verified by `activityModel.test.js`.

**The flaw:** every analytics, metrics and streak query filters on `Activity.timestamp`, but
the compound indexes in `models/Activity.js` are on `date`. Those queries fall back to the
single-field `userId` index and filter `timestamp` in memory.

**Do:** one line in `backend/models/Activity.js`:

```js
activitySchema.index({ userId: 1, timestamp: -1 });
```

**Say:** *"The analytics queries all filter by `timestamp` in a date range, but the index
was on a different field, `date`. I added `{ userId: 1, timestamp: -1 }` — I checked with
`.explain()` and it went from a collection scan of the user's documents to an index scan."*

**Shows:** you understand compound-index field order (equality then range), `.explain()`,
`IXSCAN` vs `COLLSCAN`. **This is a great whiteboard moment — run `.explain()` live.**

---

## 6. Return 409, not 500, on a duplicate group join 🟢 — ✅ DONE 2026-09-09

**The flaw:** the `groupmembers` collection has a unique compound index on
`{groupId, userId}`. When two joins race (or someone double-clicks), the second write throws
a duplicate-key error, which the route's generic `catch` turns into a **500**.

**Do:** in the join handler in `backend/routes/groups.js`:

```js
} catch (err) {
  if (err.code === 11000) return res.status(409).json({ message: 'Already a member' });
  return next(err);
}
```

**Say:** *"A double-join returned a 500. It's actually a well-defined conflict — the unique
index is doing its job — so I detect the `11000` duplicate-key code and return a 409. The
unique index is what makes this race-safe in the first place."*

**Shows:** HTTP status semantics, how unique indexes surface errors, that a DB constraint is
a legitimate concurrency guard.

---

## 7. Fail fast on a missing `JWT_SECRET` 🟢 — ✅ DONE 2026-09-09

**The flaw:** `routes/auth.js` and `middleware/auth.js` both do
`process.env.JWT_SECRET || 'your_jwt_secret'`. If the env var is ever missing in production,
tokens are signed with a public string and **anyone can forge a session**.

**Do:** add to the top of `backend/app.js`:

```js
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
```

Then delete the `|| 'your_jwt_secret'` fallbacks.

**Say:** *"There was a hardcoded fallback secret. A default signing key means forgeable
tokens, so I made the app refuse to start without `JWT_SECRET` — fail fast at boot beats a
silent security hole."*

**Shows:** you understand JWT signing, 12-factor config, fail-fast.

---

## 8. Show real data in the "Repeated Failures" panel 🟢 — ✅ DONE 2026-09-09

**The flaw:** `frontend/src/pages/Dashboard.tsx` renders `repeatedFailuresDaily` /
`repeatedFailuresWeekly` — **hardcoded fake arrays** — instead of
`terminalSummary.repeatedFailedCommands`, which the backend already calculates and returns.

**Do:** delete the two mock arrays; map over `currentData?.terminalSummary?.repeatedFailedCommands`.

**Say:** *"The dashboard had a panel showing fake command data. The backend was already
computing the real 'top repeated failures' — I just wired the component to the actual
response."*

**Shows:** honesty, attention to correctness, you traced a value end-to-end.

---

# Tier 2 — High-impact small features (2–6 hrs, real capability, strong stories)

## 9. `UserStats` rollup — make the leaderboard O(users), not O(all activity) 🟠

**The flaw:** `GET /api/leaderboard` aggregates the **entire `activities` collection** and
loads **every user** into Node on every request. No window, no cache, no pagination. It's
the first thing that breaks as data grows.

**Do:**
1. New model `UserStats`: `{ userId (unique), totalSeconds, totalLinesAdded, totalLinesRemoved, activityCount, updatedAt }`.
2. In the ingest handler (`routes/extension.js`), after `Activity.create`, do
   `UserStats.updateOne({ userId }, { $inc: { totalSeconds: duration, totalLinesAdded: ..., activityCount: 1 }, $set: { updatedAt: new Date() } }, { upsert: true })`.
3. A one-off `scripts/backfill-userstats.js` that rebuilds it from `activities` with a single `$group`.
4. Rewrite the leaderboard route as
   `UserStats.find().sort({ totalSeconds: -1 }).limit(50).lean()` + a `$lookup`/`populate` for names.
5. Keep the old query behind `?legacy=1` for one release so you can compare.

**Say:** *"The leaderboard scanned the whole activity collection on every request. I added a
`UserStats` rollup that's incremented with `$inc` on write, so the read is now a sorted,
limited index scan of one row per user instead of an aggregation over millions of rows.
Same numbers, bounded cost. For instant rank lookups at real scale the next step is a Redis
sorted set."*

**Shows:** read-model / CQRS-lite thinking, `$inc` atomicity, the write-amplification
trade-off, that you can quantify a complexity change (O(A) → O(U)). **This is your single
best scalability story and it's genuinely small.**

---

## 10. Idempotency key on activity ingest 🟡

**The flaw:** the extension has **no offline queue and no dedupe** — if a flush is retried
(network blip, restart), the backend stores it again and **double-counts**.

**Do:**
- Extension: generate `crypto.randomUUID()` per flush, send it as `idempotencyKey` in the
  payload; keep it if the send fails so the retry reuses it.
- Backend: add `idempotencyKey` to the schema with a **sparse unique index**; on
  duplicate-key (`11000`) return `200` with the existing document's id instead of erroring.

**Say:** *"Activity ingest was at-least-once with no dedupe, so a retry double-counted
hours. I made each flush carry a client-generated idempotency key with a unique index — a
replay now returns the original result instead of creating a second record. It's the
standard pattern for making an at-least-once channel effectively exactly-once."*

**Shows:** delivery semantics (at-least-once vs exactly-once), idempotency as a design
pattern, unique indexes again.

---

## 11. `GET /health` readiness endpoint 🟢 — ✅ DONE 2026-09-09

**The gap:** `/` returns `{ status: 'ok' }` unconditionally — even when Mongo is down.

**Do:**

```js
app.get('/health', (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? 'ok' : 'degraded', db: up });
});
```

Point Render's health check at `/health`.

**Say:** *"The health route said 'ok' even with no database. I split liveness from readiness
— `/health` now returns 503 if the Mongo connection isn't ready, so the platform doesn't
route traffic to a broken instance."*

**Shows:** liveness vs readiness, platform health checks, graceful degradation.

---

## 12. Validate the ingest payload 🟡

**The flaw:** the only check is `if (!fileName || !language || !duration)`. So `duration: 0`
is wrongly rejected, and `duration: 1e12`, negatives, and a client-chosen `timestamp` are
all accepted — you can top the leaderboard with one `curl`.

**Do:** use `express-validator` (already a dependency) on `/track`:

```js
body('duration').isFloat({ min: 1, max: 3600 }),
body('fileName').isString().isLength({ max: 255 }),
body('language').isString().isLength({ max: 64 }),
body('timestamp').optional().isISO8601()
  .custom(v => new Date(v) <= new Date() && new Date(v) > Date.now() - 864e5),
```

**Say:** *"There was no real validation on ingest — you could send a single request with a
billion-second duration and win the leaderboard. I added bounds with `express-validator`:
duration 1–3600s per flush, a length cap on strings, and a timestamp that has to be recent
and not in the future."*

**Shows:** never trust the client, input validation as a layer, how the leaderboard cheat
actually works.

---

## 13. Adopt React Query on the dashboard 🟡

**The gap:** `@tanstack/react-query` is **installed but never used**. Every page refetches on
navigation with `cache: 'no-cache'`, and `Dashboard.tsx` fires the analytics request twice
on mount (an effect on `[]` and one on `[viewMode]`).

**Do:** wrap the app in `<QueryClientProvider>`, convert the dashboard's `fetchAnalytics` /
`fetchWeekly` / `fetchMetrics` into `useQuery` hooks keyed by `['analytics', userId, view]`.

**Say:** *"React Query was a dependency but unused. I moved the dashboard's fetches to
`useQuery` — that removed a duplicate request on mount, gave me caching and retry for free,
and made the loading and error states declarative instead of three `useState`s per page."*

**Shows:** modern React data-fetching, the difference between client state and server state,
cache keys / staleness.

---

## 14. Goal completion + persisted to-dos 🟡

**The flaw:** **no route ever sets a goal to `completed`** (only the demo seed does), so the
"estimation accuracy" insight never has data. And the Goals page's to-do checkboxes live in
React state only — **they vanish on refresh**.

**Do:**
- `PATCH /api/goals/:goalId` (owner-scoped, like `/:goalId/progress`) to set
  `status: 'completed'` — add a "Mark complete" button on the frontend.
- Add a `todos: [{ text, done }]` subdocument to `Goal` and persist via the same PATCH.

**Say:** *"Two half-finished loops: goals could never actually be completed, so the
estimation-accuracy metric was always empty; and the to-do list wasn't saved. I added an
owner-scoped PATCH endpoint that closes both — completing a goal now feeds the Insights
page."*

**Shows:** you trace a feature end-to-end, owner-scoped authorization, closing the loop on a
metric.

---

## 15. Make the app serverless-safe (guard `app.listen`, move the cron) 🟢

**The flaw:** `app.js` calls `initScheduler()` and `app.listen()` unconditionally. On a
serverless deploy the hourly `node-cron` job **never fires** (the process is frozen between
requests) and every cold start re-runs the immediate sweep.

**Do:**

```js
if (require.main === module) {
  app.listen(PORT, () => console.log(`:${PORT}`));
}
module.exports = app;
```

Move the schedule to a protected `POST /api/internal/run-notifications` (shared-secret
header) triggered by GitHub Actions `schedule:` or a free cron service. Add a
`{ goalId: 1, type: 1 }` index for the overdue check's per-goal `findOne`.

**Say:** *"The scheduler assumed a long-lived process. I guarded `app.listen` so the module
can be imported by a serverless handler without starting a server, and moved the cron to an
external trigger hitting a protected internal route — plus an index for the lookup it does
per goal."*

**Shows:** you understand the serverless process model, why `node-cron` breaks there, and
you spotted a per-iteration unindexed query.

---

# Tier 3 — Polish (nice to have, quick, small signal each)

| # | Change | Effort | One-liner for the interview |
|---|---|---|---|
| 16 | **Leaderboard: return a handle, not `email`** | 🟢 | "It was leaking every user's email in a shared list — now it returns a display name." |
| 17 | **Leaderboard: `?period=` + pagination** | 🟢 | "Bounded the query with a 30-day default window and `skip`/`limit` in the pipeline." |
| 18 | **Extension: store the API key in `context.secrets`** | 🟢 | "Moved the key from plaintext `settings.json` into VS Code SecretStorage, which uses the OS keychain." |
| 19 | **`config.js` that validates all env vars at boot** | 🟢 | "One place that checks every required env var is set and throws a clear list of what's missing — 12-factor." |
| 20 | **Swap `console.log` for `pino` + a request id** | 🟡 | "Structured JSON logs with a per-request id and redacted user ids, instead of 40 `console.log`s printing PII." |
| 21 | **`docker-compose.yml` for local dev** | 🟡 | "`docker compose up` gives you Mongo + API + frontend — one command to run the whole thing." |
| 22 | **Delete dead code** (`server.js.old`, `extension.js` v1, orphaned `Teams.tsx`, `newest.java`) | 🟢 | "Removed ~1k lines of superseded code so the repo reflects what actually ships." |
| 23 | **ESLint + Prettier on the backend** (frontend already has eslint) | 🟢 | "Added lint to the backend and to CI so style isn't a review conversation." |
| 24 | **One integration test** (`supertest` + `mongodb-memory-server`) | 🟠 | "The gap was that nothing hit a real database — I added an in-memory Mongo test proving ingest + the ownership check work end-to-end." |
| 25 | **README with architecture diagram + run steps** | 🟡 | "A reviewer can understand and run the project in two minutes." |

---

# The "if you only do three things" list

1. **Fix the build + add CI** (#1, #2) — removes the biggest red flag, adds a green check.
2. **`UserStats` leaderboard rollup** (#9) — your strongest scalability story, and small.
3. **Security batch: `helmet` + rate limit + validation + central error handler + fail-fast
   `JWT_SECRET`** (#3, #12, #4, #7) — half a day, and turns "the security was weak" into
   "I found the gaps and closed them."

Each of these gives you a concrete, honest answer to "walk me through something you improved
and why."

---

# Where this leaves the honesty story

You will still have real limitations after these (no queue, single Mongo, the API key is
still a long-lived credential, insights aren't cached). **That's fine** — the point isn't a
perfect project, it's demonstrating that you can find problems, prioritise them, and fix the
ones that matter. Keep updating `docs/IMPROVEMENT_PLAN.md` as you go; that document *is* the
signal.
