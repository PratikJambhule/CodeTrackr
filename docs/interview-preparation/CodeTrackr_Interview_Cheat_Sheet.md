# CodeTrackr — Interview Cheat Sheet (Last-Minute Revision)

*Read this the hour before. Full detail: `CodeTrackr_Interview_Preparation.md`.*

---

## Architecture in 10 lines

1. Developer-productivity tracker: **VS Code extension → Express/MongoDB backend → React dashboard.**
2. **Client–server, RESTish, modular monolith**, partial MVC + thin service layer.
3. Extension POSTs one `Activity` doc per ~30–90s flush, auth by **API key** (`x-api-key` header).
4. Web auth is **Google OAuth → JWT in an httpOnly cookie** (`session:false`, no refresh token).
5. Backend = one Express process, 10 feature routers, Mongoose, one MongoDB (Atlas).
6. Analytics endpoints do `Activity.find()` **then aggregate in JavaScript** (tech debt, M-1).
7. Leaderboard aggregates the **entire** `activities` collection + **all** users in Node — no cache/window/pagination (H-7).
8. Insights = **deterministic statistics** (`metricsDerive.js`), **not ML**; LLM layer designed, not built.
9. `node-cron` hourly job for deadline notifications — **broken on serverless** (H-13).
10. Deploy: frontend **Vercel**, backend **Render** (Vercel serverless config also present), DB **Atlas**. No CI.

---

## Tech stack — one page

| Layer | Stack | Note |
|---|---|---|
| Extension | TypeScript 5, esbuild bundle, `@vscode/vsce`, axios | `onStartupFinished`; 5 trackers; `consumeInterval()` = snapshot+reset |
| Backend | Node 18, **Express 5**, **Mongoose 8**, jsonwebtoken, passport-google-oauth20, cookie-parser, cors, node-cron, serverless-http | `helmet`/`express-rate-limit`/`express-validator` **installed, NOT used** |
| DB | MongoDB Atlas | 7 collections; `activities` is high-volume |
| Frontend | **React 19**, **Vite 7**, TS ~5.9, **Tailwind 3**, react-router-dom 7, chart.js 4 + react-chartjs-2, lucide-react | `@tanstack/react-query` **installed, unused**; 28-theme `ThemeContext` |
| Auth | Google OAuth → JWT cookie (web); random 64-hex API key (extension) | `JWT_SECRET` has unsafe fallback `'your_jwt_secret'` |
| "ML" | pure JS stats — coefficient of variation, weighted score, medians | no model/training/inference/LLM/Python |
| Deploy | Vercel + Render + Atlas | no Dockerfile, no CI, no observability |
| Tests | plain `node:assert` — 6 backend suites (~57 assertions) + 2 extension suites | **zero frontend tests; nothing run vs a real DB** |

**Why MongoDB:** append-only, self-contained, schema-evolving docs; per-user-window access; no hot-path joins; free tier.
**Where SQL wins:** groups/teams/goals relational integrity + transactions; the leaderboard `GROUP BY`.
**Why monolith:** one dev, one DB, shared model; extract *ingest* first when volume demands.

---

## Data flow — one page

**Ingest**
```
VS Code event → tracker counters → timer tick (30s) →
  idle ≥ 2min? pause : totalBuffered ≥ 0.5min? →
  buildPayload(timestamp = interval START, basename only, duration in SECONDS,
               terminalAnalytics/editorAnalytics/focusAnalytics/gitAnalytics) →
  axios.post /api/extension/track  header x-api-key →
  verifyApiKey → User.findOne({apiKey}) → req.user →
  validate (fileName && language && duration) → normalize*Analytics (default missing → 0) →
  Activity.create({ userId: req.user._id.toString(), ..., timestamp: when, date: when }) → 201
```
On failure: buffered minutes kept **in memory only** (no disk queue), retried next tick.
**No idempotency** → duplicate payload double-counts.

**Read (dashboard)**
```
fetch(/api/analytics/:id?timezone=<offsetMin>, {credentials:'include'})  cookie: token=JWT →
  isAuthenticated (jwt.verify → User.findById) →
  resolveOwnedUserId → assertOwnership (403 if :userId ≠ session) →
  Activity.find({userId, timestamp:{$gte:7d}})  // 7 days to render 1 (M-1) →
  JS filter/reduce/Map + computeStreak ($group, 90d) →
  res.json → Chart.js
```

**Insights**
```
fetch(/api/metrics?days=&timezone=)  // NO :userId — IDOR-proof by design →
  isAuthenticated → buildMetrics(req.user._id, {days, tz}) →
    4× Activity.aggregate ($group: totals / by-day / by-hour / goal-pairs) →
    metricsDerive (pure): deepWorkRatio, flowBlockStats, consistencyIndex,
                          truePeakWindow, estimationCalibration →
  res.json  // NOT cached, recomputed every load
```

---

## Extension flow — one page

- **Activation:** `onStartupFinished`. Creates 5 trackers, registers 7 commands, `start()`.
- **Loop:** `setInterval(flushIntervalSeconds=30s)`. Idle ≥ 2min → flush tail + pause; resume on next edit.
- **Flush:** when buffered active minutes ≥ `minFlushMinutes` (0.5). One `POST /track` = one `Activity` doc. **No batching** (`/track/batch` exists, unused).
- **Trackers** (`consumeInterval()` = snapshot + reset):
  - **EditorTracker** — gross chars/lines ±, **churn** (write then delete ≤ 10min), undo/redo, saves, file switches, read/write attention split (5s sampler), large-insert flags.
  - **FocusTracker** — `focusedMs`/`blurredMs` via `onDidChangeWindowState`; **flow blocks** (close after 2min idle).
  - **GitStateTracker** — `vscode.git` API; `commits++` when `HEAD.commit` changes; uncommitted count/age.
  - **TerminalTracker** — `onDidStart/EndTerminalShellExecution`; category, build/test/debug, git action, success by exit code, repeated failures; commands **sanitised** (`token=***`) + truncated.
  - **DebugTracker** — session count → `terminalAnalytics.debuggingSessions`.
- **Privacy:** never sends file contents, diffs, commit messages, absolute paths (test-enforced).
- **Key storage:** plaintext in global `settings.json` (should be SecretStorage).
- **Timestamp:** stamped at **interval start**, not upload (fixes hour-of-day skew).
- **Failure:** 401 → one-time prompt; network error → keep buffer in memory; `deactivate()` → best-effort final flush.
- **Version saga:** `2.1.0` uploaded before `2.0.x` → Marketplace served stale code for months → `2.2.0` supersedes.

---

## Database — one page

| Collection | Key facts |
|---|---|
| **activities** | `userId` is a **String** (hex of `users._id`), not an ObjectId ref. `duration` in **SECONDS**. One doc/flush. 4 analytics sub-docs. Indexes: `{userId:1}`, `{userId:1,date:-1}`, `{userId:1,projectName:1}`, `{userId:1,language:1}`. **Missing `{userId:1,timestamp:-1}`** — queries filter `timestamp`, index is on `date`. |
| **users** | `googleId` U, `email` U, `apiKey` U+sparse **plaintext**, `isFirstLogin`. |
| **groups** / **groupmembers** | `groups.password` = scrypt `scrypt$salt$hash`, `select:false`, legacy plaintext tolerated + rehashed on join. `groupmembers` = **join table**, unique compound `{groupId,userId}` (the one hard concurrency guard). |
| **goals** | `userId` ObjectId, `targetHours` (min 1), `techStack` String, `status` enum — **no route ever sets `completed`**. Progress computed on demand, not stored. |
| **teams** | `members: [ObjectId]` **embedded**. Backend routes exist; **frontend not routed** (orphaned). Different modelling choice from groups on purpose. |
| **notifications** | scoped by `req.user._id` everywhere — "the one done right". |

**No transactions.** Ingest = single atomic insert. Double-join → unique index → **500** (should be 409). `team.members.push` = lost-update risk (use `$addToSet`).

---

## ML / Insights — one page

**It is statistics, not ML.** No model, training, inference, Python, or LLM.

| Metric | Formula |
|---|---|
| `deepWorkRatio` | Σ(flow blocks ≥ 25 min) ÷ total focused ms |
| `flowBlocks` | median / longest / count / deep-count of `flowBlocksMs` |
| `consistencyIndex` | `clamp(1 − stddev/mean of daily minutes, 0, 1)` — coefficient of variation |
| `truePeakWindow` | argmax hour of `commits·10 + linesInserted/10 − churnLines/5` (productive ≠ busy) |
| `estimationCalibration` | `mean(actual ÷ estimated hours)` over completed goals, needs ≥ 2 |
| secondary | `churnRatio`, `comprehensionLoad` (read/(read+write)), `contextSwitchesPerHour` |

- Runs **synchronously per request, not cached, not scheduled.**
- Focus metrics show **"—"** until extension 2.1.0 data (`flowBlocks.blockCount === 0`).
- LLM narration layer **designed** (`TRACKING_ROADMAP.md` §5, Gemini) with a "every number must be grounded" validator — **not built**.
- To make it real ML: session-vector features → z-score per user → k-means archetypes; supervised only with real labels (goal slippage); serve from a batch job, not inline.

---

## Security — one page

**FIXED (branch `feat/security-and-insights`):**
- H-1 analytics/leaderboard now require auth + ownership (`assertOwnership`, 403 on mismatch).
- H-2 legacy open `POST /api/user-activity` + `GET /api/user-stats/:id` deleted.
- H-9 group passwords scrypt-hashed (legacy plaintext rehashed on join).
- H-10 `AUTH_BYPASS` refused when `NODE_ENV==='production'`.
- H-11 IDORs on goals (`findOne({_id,userId})`) and teams (membership check) closed.
- `/api/metrics` takes **no `:userId`** → IDOR-proof by construction.
- `routeGuards.test.js` statically scans routes, fails if auth middleware disappears.

**STILL OPEN / BY DESIGN:**
- **API key: plaintext at rest + in transit, no expiry, no scope, full ingest authority.** Leak → forge unlimited activity (leaderboard fraud), but NOT read the dashboard (needs JWT).
- No `helmet`, no rate limiting anywhere (incl. `/auth/google`, `/track`, `/join`).
- No request validation on ingest — `duration: 1e12` accepted; client sets `timestamp`; `duration:0` wrongly rejected.
- Errors echo `err.message` (internal leak). No central error handler.
- Leaderboard returns **every user's email**.
- No idempotency / replay protection on ingest.
- Group `discover` enumerates private groups (name+desc+creator); no group-owner authz.
- Group search puts input into `$regex` → ReDoS.
- `JWT_SECRET` fallback `'your_jwt_secret'`; no refresh token; `sameSite:'none'` + no CSRF token.
- Key in `settings.json`, not SecretStorage.

**Redesign the key:** `ct_<keyId>_<secret>`, store `sha256(secret)`, lookup by indexed `keyId`, constant-time compare; multiple named keys per device; rotation with 24h grace; or short-lived signed ingest token / OAuth device flow.

---

## Scalability — one page

| Users | State | Action |
|---|---|---|
| **10k** | Ingest trivial. Leaderboard slow once `activities` is 10⁷–10⁸ docs (**H-7, breaks first**). Analytics wasteful (M-1). | Add `{userId:1,timestamp:-1}`; window + `$limit` the leaderboard pipeline. |
| **100k** | Leaderboard unusable without a rollup. No caching → repeated recompute. `node-cron` overdue sweep expensive. | `UserStats` rollup (`$inc` on ingest) → leaderboard reads O(users). Move analytics to `$group`. |
| **1M** | Monolith + one Mongo is wrong shape. | Queue → workers → **sharded `activities`** (hash `userId`) + rollups; Redis (leaderboard ZSET, insights cache, rate limits); analytics from rollups; archive raw docs to a warehouse; observability. |
| **10M leaderboard** | — | Redis **sorted set**: `ZADD` on rollup update, `ZREVRANGE` page, `ZREVRANK` "your rank" — O(log n). |

**Complexity headlines:** leaderboard = **O(all activity + all users)** per request; analytics = **O(N) app memory + DB egress**. Both fix via aggregate-in-engine / precompute rollups.

---

## Top 40 questions — quick answers

1. **Tell me about it** → tracker + Express/Mongo + React dashboard; leaderboard/groups/goals/insights.
2. **Architecture?** → client–server, RESTish, modular monolith, partial MVC.
3. **Why monolith?** → one dev, one DB, shared model; extract ingest first later.
4. **Why MongoDB?** → append-only, schema-evolving docs, per-user-window access.
5. **Why not Postgres?** → activity suits documents; but relational parts + leaderboard would be better in SQL — honest answer.
6. **Data flow?** → event → counters → 30s flush → verifyApiKey → Activity.create; read → isAuthenticated → ownership → find → JS aggregate.
7. **The unique key — is it auth?** → yes, a plaintext unscoped non-expiring **bearer credential**, not an identifier.
8. **Key stolen?** → forge activity / leaderboard fraud; can't read dashboard (needs JWT).
9. **Fix the key?** → hash at rest, keyId prefix, per-device, rotation grace, or OAuth device flow.
10. **Why not OAuth for the extension?** → device flow is right; API key was the MVP speed trade-off.
11. **Web auth?** → Google OAuth → JWT `{id,name,email}` 1-day → httpOnly cookie; no refresh, no revocation.
12. **JWT vs session?** → stateless, survives cold start; cost = no revocation.
13. **Extension activation?** → `onStartupFinished`; passive tracking.
14. **What's collected?** → time, file/lang/project, gross edits, churn, focus/flow, terminal commands, git commits, debug sessions.
15. **Batched?** → no; one doc per flush; `/track/batch` unused.
16. **Idle?** → pause after 2 min, resume on edit.
17. **Offline?** → buffer in memory, retry next tick; no disk queue; lost on restart.
18. **Duplicate payload?** → double-counted; no idempotency.
19. **Analytics aggregation — where?** → mostly **JS** (`find().reduce()`), M-1; streak + summary + metrics use `$group`.
20. **Timezone?** → client sends `getTimezoneOffset()` minutes; `localDayInfo` buckets local days.
21. **Streak logic?** → consecutive days with `Σduration>0`, anchored today-or-yesterday, 90-day window.
22. **Leaderboard rank?** → total hours all-time desc; relative 5-point scores vs current max (unstable).
23. **Leaderboard at 100k?** → dies; needs `UserStats` rollup / Redis ZSET.
24. **"commits" on leaderboard?** → actually `activityCount`, mislabelled.
25. **Groups membership?** → `groupmembers` join table, unique compound index.
26. **Double-join?** → unique index → 500 (should be 409).
27. **Group admin?** → none; `createdBy` stored, never used for authz.
28. **Is Insights ML?** → no, deterministic statistics; LLM narration designed, not built.
29. **consistencyIndex?** → `1 − coefficient of variation` of daily minutes, clamped [0,1].
30. **truePeakWindow?** → most productive hour (weighted commits/lines/churn), not busiest.
31. **Insights cached?** → no; recomputed every load.
32. **Insufficient data?** → focus cards show "—" until extension 2.1.0; estimation needs 2 goals.
33. **Cheat the leaderboard?** → yes: `curl` `/track` with `duration:3600` in a loop; no rate limit / validation.
34. **Prevent cheating?** → validate duration, rate-limit per key, idempotency key, corroborate with edit/focus/git signals.
35. **Tests?** → `node:assert` scripts; 6 backend + 2 extension; **no frontend tests, nothing vs a real DB**.
36. **`routeGuards.test.js`?** → static scan; fails if a sensitive route loses its auth middleware.
37. **Error handling?** → per-route `try/catch` → `500 {message, error: err.message}` (leaks); no central handler.
38. **Deploy?** → Vercel (FE) + Render (BE) + Atlas; `node-cron` breaks on serverless (H-13); no CI.
39. **Frontend build?** → **fails** — `tsc -b` has 29 pre-existing errors (M-13).
40. **Biggest weakness?** → the API key model + no ingest validation/rate limiting; and testing depth.

---

## Things NOT to claim / traps

- Don't call Insights "AI" or "ML" — it's statistics. Say so first.
- Don't say the leaderboard is "optimised" — it's an O(n) scan; know the rollup fix.
- Don't say "the API key is just an identifier" — it's a credential.
- Don't claim the frontend builds — `tsc -b` fails (29 errors).
- Don't claim integration test coverage — there is none against a real DB.
- Don't claim the extension has an offline queue — it's memory-only.
- The Dashboard "Repeated Failures" panel is **mock data** — don't demo it as real.
- Goals to-dos aren't persisted; Teams UI is orphaned.
- Don't over-claim solo authorship — 3 contributors; describe what you can defend.

---

## Five sentences that make you sound senior

1. "The API key is functionally an unscoped, non-expiring plaintext bearer credential — a fine MVP, but I'd hash it at rest with a keyId prefix and add rotation with a grace window."
2. "The leaderboard is O(all activity) per request; the fix is a `UserStats` rollup incremented on ingest, turning it into an O(users) indexed read, with a Redis sorted set for rank lookups."
3. "Insights is deterministic descriptive statistics — coefficient of variation, weighted scoring, medians — chosen so every number is explainable; the LLM narration layer is designed with a numbers-must-be-grounded validator but not built."
4. "Analytics currently aggregate in JavaScript after `Activity.find()`, which ships and parses every document; moving to `$group` pipelines is the prerequisite for scale and the metrics service already does it right."
5. "I audited my own code into `IMPROVEMENT_PLAN.md` — 30-odd findings by severity — and closed the high-severity security items with a regression test that statically scans routes and fails if an auth middleware disappears."
