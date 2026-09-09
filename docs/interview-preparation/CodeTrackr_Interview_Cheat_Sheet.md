# CodeTrackr — Interview Cheat Sheet (Last-Minute Revision)

*Read this the hour before. Full detail: `CodeTrackr_Interview_Preparation.md`.*

> **Why it exists (say this first):** I wanted **friendly competition inside my college friend
> group** — spin up a group for a contest week or for daily practice, everyone installs the
> extension once, their editor time/lines are tracked automatically, and the group page shows
> who actually put in the work. The extension *already* records each person's failed
> commands / failed builds / repeated failures, so "who hit the most errors this week" is data
> the app collects — the group view just doesn't surface it yet (next feature, a read-path
> `$group` change). Everything else — solo analytics, insights, goals — grew out of that.

> **Changed 2026‑09‑08:** ingest now `$inc`-upserts a **10-minute `(user, project, language)`
> bucket** (not one doc per flush); extension **2.3.0** skips signal-less flushes,
> `minFlushMinutes` default **2**; sparse analytics sub-docs; `date` field dropped;
> `DailySummary` nightly rollup + 400d TTL. Totals unchanged. `ACTIVITY_BUCKET_MS=0` = legacy.

---

## Architecture in 10 lines

1. Developer-productivity tracker: **VS Code extension → Express/MongoDB backend → React dashboard.**
2. **Client–server, RESTish, modular monolith**, partial MVC + thin service layer.
3. Extension flushes every ~30–90s (auth by **API key**, `x-api-key`); backend `$inc`-upserts each flush into a **10-minute `(user, project, language)` bucket** row (since 2026‑09‑08) — real seconds are summed, so totals are identical, ~10× fewer rows/writes.
4. Web auth is **Google OAuth → JWT in an httpOnly cookie** (`session:false`, no refresh token).
5. Backend = one Express process, 10 feature routers, Mongoose, one MongoDB (Atlas).
6. Analytics endpoints do `Activity.find()` **then aggregate in JavaScript** (tech debt, M-1).
7. Leaderboard aggregates the **entire** `activities` collection + **all** users in Node — no cache/window/pagination (H-7).
8. Insights = **deterministic statistics** (`metricsDerive.js`), **not ML**; LLM layer designed, not built.
9. `node-cron` hourly job for deadline notifications — **broken on serverless** (H-13).
10. Deploy: frontend **Vercel**, backend **Render** (Vercel serverless config also present), DB **Atlas**. CI: GitHub Actions (2026-09-09) — tests + build on push.

---

## Tech stack — one page

| Layer | Stack | Note |
|---|---|---|
| Extension | TypeScript 5, esbuild bundle, `@vscode/vsce`, axios | `onStartupFinished`; 5 trackers; `consumeInterval()` = snapshot+reset |
| Backend | Node 18, **Express 5**, **Mongoose 8**, jsonwebtoken, passport-google-oauth20, cookie-parser, cors, node-cron, serverless-http | `helmet` + `express-rate-limit` **wired 2026-09-09** (`/auth`, `/api/extension`); `express-validator` still unused |
| DB | MongoDB Atlas | 8 collections (`+dailysummaries`); `activities` is high-volume, now bucketed |
| Frontend | **React 19**, **Vite 7**, TS ~5.9, **Tailwind 3**, react-router-dom 7, chart.js 4 + react-chartjs-2, lucide-react | `@tanstack/react-query` **installed, unused**; 28-theme `ThemeContext` |
| Auth | Google OAuth → JWT cookie (web); random 64-hex API key (extension) | `JWT_SECRET` required at boot — app throws if unset (was an unsafe `'your_jwt_secret'` fallback), fixed 2026-09-09 |
| "ML" | pure JS stats — coefficient of variation, weighted score, medians | no model/training/inference/LLM/Python |
| Deploy | Vercel + Render + Atlas | GitHub Actions CI (2026-09-09); no Dockerfile, no CD, no observability |
| Tests | plain `node:assert` — 11 backend suites (~114 assertions) + 2 extension suites; CI on push | **zero frontend tests; nothing run vs a real DB** |

**Why MongoDB:** append-only, self-contained, schema-evolving docs; per-user-window access; no hot-path joins; free tier.
**Where SQL wins:** groups/teams/goals relational integrity + transactions; the leaderboard `GROUP BY`.
**Why monolith:** one dev, one DB, shared model; extract *ingest* first when volume demands.

---

## Data flow — one page

**Ingest** *(bucketed since 2026‑09‑08)*
```
VS Code event → tracker counters → timer tick (30s) →
  idle ≥ 2min? pause : totalBuffered ≥ 2min (minFlushMinutes)? →
  buildPayload(timestamp = interval START, basename only, duration in SECONDS, 4 analytics blocks) →
  payloadHasSignal? no → keep buffering (don't send)  |  yes ↓
  axios.post /api/extension/track  header x-api-key →
  verifyApiKey → User.findOne({apiKey}) → req.user →
  validate (fileName && language && duration) → normalize*Analytics (missing → absent, not 0) →
  planActivityWrite → bucketStart = floor(when, 10min) →
  Activity.findOneAndUpdate({userId,project,language,bucketStart},
     { $inc: {duration, lines, flushCount, ...non-zero leaves}, $max, $push $slice:-200, $addToSet files,
       $setOnInsert: {...key, timestamp: bucketStart} }, { upsert:true, setDefaultsOnInsert:false }) → 201
  (ACTIVITY_BUCKET_MS=0 → plain Activity.create, exactly as before)
```
On failure: buffered minutes kept **in memory only** (no disk queue), retried next tick.
`$inc.duration` = real measured seconds → **totals unchanged**. A same-window replay
double-counts *inside one bucket*, not as a new row.

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
- **Flush:** when buffered active minutes ≥ `minFlushMinutes` (**2** since 2.3.0). Builds the payload, then `payloadHasSignal(payload)?` — no edits/terminal/git/focus → **don't send, keep buffering**. One `POST /track` per flush; backend merges it into the current 10-min bucket row (`$inc` upsert). **No HTTP batching** (`/track/batch` exists, unused).
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
| **activities** | `userId` is a **String** (hex of `users._id`), not an ObjectId ref. `duration` in **SECONDS**. **One doc per 10-min `(userId, projectName, language)` bucket** — many flushes `$inc` into it (`flushCount` counts them; `files[]` `$addToSet`; `bucketStart` set once). 4 sparse analytics sub-docs (missing leaf ⇒ **absent, not 0**). Dead `date` field **dropped** (migration script). Indexes: `{userId:1}`, `{userId:1,timestamp:-1}` (**added**), `{userId:1,projectName:1}`, `{userId:1,language:1}`, **partial-unique** `{userId:1,projectName:1,language:1,bucketStart:1}`, `{createdAt:1}` TTL 400d (safety net). `ACTIVITY_BUCKET_MS=0` → legacy one-doc-per-flush. |
| **dailysummaries** | Nightly rollup (cron `30 3 * * *`, `dailyRollup.js`). One doc per `(userId, day)` — `totalSeconds`, lines, `flushCount`, `bucketCount`, `languages[]`, `projects[]`, editor/terminal/git/focus rollups. Unique `{userId:1,day:1}`. Read path doesn't use it yet — built for the leaderboard/analytics scale fix. |
| **users** | `googleId` U, `email` U, `apiKey` U+sparse **plaintext**, `isFirstLogin`. |
| **groups** / **groupmembers** | The original point of the app — a group = a contest week or a daily-practice pod. `groups.password` = scrypt `scrypt$salt$hash`, `select:false`, legacy plaintext tolerated + rehashed on join. `groupmembers` = **join table**, unique compound `{groupId,userId}` (the one hard concurrency guard). Leaderboard aggregates members' `activities` by **hours + lines** today; the per-person **error/build-failure** counters the extension collects are the obvious next column (`$group` + `$sum`). |
| **goals** | `userId` ObjectId, `targetHours` (min 1), `techStack` String, `status` enum — **no route ever sets `completed`**. Progress computed on demand, not stored. |
| **teams** | `members: [ObjectId]` **embedded**. Backend routes exist; **frontend not routed** (orphaned). Different modelling choice from groups on purpose. |
| **notifications** | scoped by `req.user._id` everywhere — "the one done right". |

**No transactions.** Ingest = single atomic `$inc` upsert into the bucket row (concurrent flushes just accumulate; duplicate-key on first insert → one retry). Double-join → unique index → **409** (handler detects `error.code === 11000`). `team.members.push` = lost-update risk (use `$addToSet`).

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

**FIXED 2026-09-09 (quick-wins batch):**
- `helmet()` global; `express-rate-limit` on `/auth` (50/15min) + `/api/extension` (120/min).
- `JWT_SECRET` required at boot — no more `'your_jwt_secret'` fallback.
- Double-join → **409** (handler detects `11000`).
- `GET /health` readiness (503 when Mongo down).
- "Repeated Failures" dashboard panel now shows real data.

**STILL OPEN / BY DESIGN:**
- **API key: plaintext at rest + in transit, no expiry, no scope, full ingest authority.** Leak → forge unlimited activity (leaderboard fraud), but NOT read the dashboard (needs JWT).
- No rate limiting on group `/join` (password brute-force) or the analytics routes — only `/auth` + `/api/extension`.
- Client still sets `timestamp` on ingest (bounds-checked as of 2026-09-09, but client-chosen).
- *(FIXED 2026-09-09)* central `(err,req,res,next)` handler — correlation id, generic body, routes `next(err)`.
- Leaderboard returns **every user's email**.
- No idempotency / replay protection on ingest.
- Group `discover` enumerates private groups (name+desc+creator); no group-owner authz.
- Group search puts input into `$regex` → ReDoS.
- No refresh token; `sameSite:'none'` + no CSRF token.
- Key in `settings.json`, not SecretStorage.

**Redesign the key:** `ct_<keyId>_<secret>`, store `sha256(secret)`, lookup by indexed `keyId`, constant-time compare; multiple named keys per device; rotation with 24h grace; or short-lived signed ingest token / OAuth device flow.

---

## Scalability — one page

| Users | State | Action |
|---|---|---|
| **10k** | Ingest trivial (bucketing already cut row/write rate ~10×). Leaderboard still slow once `activities` is large (**H-7, breaks first**). Analytics wasteful (M-1). | `{userId:1,timestamp:-1}` **now exists**; window + `$limit` the leaderboard pipeline; point analytics/leaderboard at `dailysummaries`. |
| **100k** | Leaderboard unusable reading raw `activities`. No caching → repeated recompute. `node-cron` overdue sweep expensive. | Nightly `dailysummaries` rollup **exists** — switch reads to it (leaderboard/analytics become O(user·days)); add a `UserStats` running total for O(users). Move analytics to `$group`. |
| **1M** | Monolith + one Mongo is wrong shape. | Queue → workers → **sharded `activities`** (hash `userId`) + rollups; Redis (leaderboard ZSET, insights cache, rate limits); analytics from rollups; archive raw docs to a warehouse; observability. |
| **10M leaderboard** | — | Redis **sorted set**: `ZADD` on rollup update, `ZREVRANGE` page, `ZREVRANK` "your rank" — O(log n). |

**Complexity headlines:** leaderboard = **O(all activity + all users)** per request; analytics = **O(N) app memory + DB egress**. Both fix via aggregate-in-engine / precompute rollups.

---

## Top 40 questions — quick answers

1. **Tell me about it** → built it for **friendly competition in my college friend group** — a group for a contest week / daily practice, the extension auto-tracks everyone's editor, the group page shows who put in the hours + lines. Around that: solo analytics, deterministic insights, goals. Stack = VS Code extension + Express/Mongo + React dashboard.
1b. **Why did you build it?** → my friends and I kept saying "how much did you actually code this week" — I wanted that to be a number, not a claim, and a bit competitive. Groups came first; everything else grew from it.
2. **Architecture?** → client–server, RESTish, modular monolith, partial MVC.
3. **Why monolith?** → one dev, one DB, shared model; extract ingest first later.
4. **Why MongoDB?** → append-only, schema-evolving docs, per-user-window access.
5. **Why not Postgres?** → activity suits documents; but relational parts + leaderboard would be better in SQL — honest answer.
6. **Data flow?** → event → counters → 30s flush (skip if no signal) → verifyApiKey → `planActivityWrite` → `$inc` upsert into the 10-min bucket row; read → isAuthenticated → ownership → find → JS aggregate.
7. **The unique key — is it auth?** → yes, a plaintext unscoped non-expiring **bearer credential**, not an identifier.
8. **Key stolen?** → forge activity / leaderboard fraud; can't read dashboard (needs JWT).
9. **Fix the key?** → hash at rest, keyId prefix, per-device, rotation grace, or OAuth device flow.
10. **Why not OAuth for the extension?** → device flow is right; API key was the MVP speed trade-off.
11. **Web auth?** → Google OAuth → JWT `{id,name,email}` 1-day → httpOnly cookie; no refresh, no revocation.
12. **JWT vs session?** → stateless, survives cold start; cost = no revocation.
13. **Extension activation?** → `onStartupFinished`; passive tracking.
14. **What's collected?** → time, file/lang/project, gross edits, churn, focus/flow, terminal commands, git commits, debug sessions.
15. **Batched?** → no HTTP batching; but the backend *merges* flushes into one 10-min bucket doc (`$inc` upsert). `/track/batch` unused.
16. **Idle?** → pause after 2 min, resume on edit.
17. **Offline?** → buffer in memory, retry next tick; no disk queue; lost on restart.
18. **Duplicate payload?** → still double-counted (now `$inc`'d twice *inside* one bucket row, not a new doc); no idempotency key.
19. **Analytics aggregation — where?** → mostly **JS** (`find().reduce()`), M-1; streak + summary + metrics use `$group`.
20. **Timezone?** → client sends `getTimezoneOffset()` minutes; `localDayInfo` buckets local days.
21. **Streak logic?** → consecutive days with `Σduration>0`, anchored today-or-yesterday, 90-day window.
22. **Leaderboard rank?** → total hours all-time desc; relative 5-point scores vs current max (unstable).
23. **Leaderboard at 100k?** → dies reading raw `activities`; point it at the nightly `dailysummaries` rollup (already built), then a `UserStats` running total / Redis ZSET.
24. **"commits" on leaderboard?** → actually `activityCount`, mislabelled.
25. **Groups membership?** → `groupmembers` join table, unique compound index. Groups are the reason the app exists — contest weeks / practice pods for a friend group.
26. **Double-join?** → unique index → **409** (handler detects `11000`).
27. **Group admin?** → none; `createdBy` stored, never used for authz.
27b. **Group compares what?** → hours + lines per member today. The extension already stores per-person failed commands / failed builds / repeated failures — "who hit the most errors" just isn't surfaced in the group view yet (extend the `$group` with `$sum` of those counters).
28. **Is Insights ML?** → no, deterministic statistics; LLM narration designed, not built.
29. **consistencyIndex?** → `1 − coefficient of variation` of daily minutes, clamped [0,1].
30. **truePeakWindow?** → most productive hour (weighted commits/lines/churn), not busiest.
31. **Insights cached?** → no; recomputed every load.
32. **Insufficient data?** → focus cards show "—" until extension 2.1.0; estimation needs 2 goals.
33. **Cheat the leaderboard?** → yes: `curl` `/track` with `duration:3600` in a loop; no rate limit / validation.
34. **Prevent cheating?** → validate duration, rate-limit per key, idempotency key, corroborate with edit/focus/git signals.
35. **Tests?** → `node:assert` scripts; **11 backend suites (~114 assertions) + 2 extension**; GitHub Actions CI on push; **no frontend tests, nothing vs a real DB**.
36. **`routeGuards.test.js`?** → static scan; fails if a sensitive route loses its auth middleware.
37. **Error handling?** → per-route `try/catch` → `next(err)` → **central handler** → `500 {error, id}` (correlation id, no leak; since 2026-09-09). Deliberate 4xx stay per-route.
38. **Deploy?** → Vercel (FE) + Render (BE) + Atlas; `node-cron` breaks on serverless (H-13); GitHub Actions CI as of 2026-09-09.
39. **Frontend build?** → ✅ green (was 29 `tsc -b` errors, fixed 2026-09-09; M-13). CI enforces it.
40. **Biggest weakness?** → the API key model + no ingest validation/rate limiting; and testing depth.

---

## Things NOT to claim / traps

- Don't call Insights "AI" or "ML" — it's statistics. Say so first.
- Don't say the leaderboard is "optimised" — it's an O(n) scan; know the rollup fix.
- The write path buckets now (10-min `$inc` upsert) — say that, not "append-only per-flush". Totals are unchanged; time-of-day precision is a 10-min grid.
- Don't say "the API key is just an identifier" — it's a credential.
- Frontend build is green as of 2026-09-09 (CI enforces). *(Historically `tsc -b` had 29 errors.)*
- Don't claim integration test coverage — there is none against a real DB.
- Don't claim the extension has an offline queue — it's memory-only.
- The Dashboard "Repeated Failures" panel now shows **real** `repeatedFailedCommands` (fixed 2026-09-09).
- Goals to-dos aren't persisted; Teams UI is orphaned.
- Don't over-claim solo authorship — 3 contributors; describe what you can defend.

---

## Sentences that make you sound senior

1. "The product is really about friendly competition in a friend group — a group is a contest week or a practice pod, the extension does the tracking so nobody self-reports, and the group leaderboard is the payoff; the next feature is surfacing the per-person error/build-failure comparison the extension already collects."
2. "I recently moved ingest from one row per flush to an atomic `$inc` into a 10-minute `(user, project, language)` bucket — real seconds are summed either way so every total is byte-identical, but the write and row rate dropped about 10×, and I kept `ACTIVITY_BUCKET_MS=0` as an escape hatch to the old behaviour."
3. "The API key is functionally an unscoped, non-expiring plaintext bearer credential — a fine MVP, but I'd hash it at rest with a keyId prefix and add rotation with a grace window."
4. "The leaderboard is O(all activity) per request; I've built the nightly `dailysummaries` rollup that turns it into an O(user·days) read, and a Redis sorted set is the endgame for rank lookups."
5. "Insights is deterministic descriptive statistics — coefficient of variation, weighted scoring, medians — chosen so every number is explainable; the LLM narration layer is designed with a numbers-must-be-grounded validator but not built."
6. "I audited my own code into `IMPROVEMENT_PLAN.md` — 30-odd findings by severity — and closed the high-severity security items with a regression test that statically scans routes and fails if an auth middleware disappears."
