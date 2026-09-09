# CodeTrackr — Interview Question Bank & Answers

> Grounded in the actual repository (2026‑09‑07, `feat/security-and-insights`). Answers are
> written to be **spoken**, not read aloud verbatim. `[ACTUAL]` = in the code today;
> `[RECOMMENDED]` = what you'd do, clearly labelled so you never over-claim.
>
> **Changed 2026‑09‑08:** "one document per flush" → the backend now **`$inc`-upserts a
> 10-minute `(user, project, language)` bucket**; extension 2.3.0 skips signal-less flushes,
> `minFlushMinutes` default 2; sparse analytics sub-docs; `date` field dropped; `DailySummary`
> nightly rollup + 400d TTL. Totals unchanged. `ACTIVITY_BUCKET_MS=0` = legacy per-flush.
>
> Categories: A Project · B Architecture · C Extension · D Backend · E MongoDB · F Auth/Key ·
> G Frontend · H ML/Insights · I Leaderboard · J Groups · K Security · L Scalability ·
> M Debugging · N Trick/follow-up · O Code-level · P HR/behavioural.

---

## A. Project overview

**A1. Tell me about CodeTrackr.**
> A coding-activity tracker built around friendly competition in a friend group. A VS Code
> extension records your coding activity — time per language, editor churn, terminal commands
> and whether they passed or failed, git commits, focused minutes — and sends it to my
> Express/MongoDB backend, authenticated by an API key you get from the website after a Google
> login. The backend merges the flushes into 10-minute activity records. A React dashboard
> turns that into daily/weekly charts, **groups you create with your friends that each get a
> per-member leaderboard**, a global leaderboard, goal tracking on a calendar with deadline
> notifications, and a private Insights page of derived metrics like your most productive
> hour. MERN stack plus a TypeScript VS Code extension; frontend on Vercel, backend on Render,
> MongoDB Atlas.

**A2. Why did you build it?**
> My friend group runs informal coding contests and daily-practice streaks, and everyone
> always *claimed* they'd put in the hours. I wanted to just see it — make a group, everyone
> installs the extension, and the group page shows who actually coded, in what languages, and
> (because the extension tracks failed commands and builds too) roughly who was fighting the
> most errors. The personal metrics — focused vs elapsed time, churn, most-productive hour —
> grew out of the same "measure it honestly" idea. WakaTime measures time-in-editor but has no
> group-competition angle.

**A3. What problem does it solve?**
> In a group of friends who code together there's no honest, low-effort way to see who's
> actually doing the work — self-reported effort is unreliable and nobody wants to manually
> log anything. CodeTrackr makes it automatic and comparable: a group leaderboard of hours and
> lines, per-person command/build success, plus personal metrics (focused vs elapsed, churn,
> estimate vs actual).

**A4. What makes it different from a normal coding tracker?**
> It's built *around* the group leaderboard — the competition is the point, not a side
> feature. It records command/build/test success and failure per person, not just time. And
> the personal side measures *focused* time and "flow blocks" not just elapsed, tracks churn
> so a refactor isn't invisible, and separates your busiest hour from your most productive
> one.

**A5. What was the hardest part?**
> Making the time number honest. V1 counted wall-clock elapsed from session start, so leaving
> VS Code open inflated everything, and it measured lines as the delta of `document.lineCount`,
> which is zero for any replace-in-place edit — i.e. most refactoring. I built an idle/pause
> state machine, switched to gross insert/delete counters, and added churn (lines written then
> deleted within 10 minutes). It's unit-tested against the built bundle with a stubbed
> `vscode`.

**A6. Biggest technical challenge?**
> Same as A5, plus the security/correctness audit — I found and fixed things like analytics
> endpoints readable by user id with no ownership check, plaintext group passwords, and an
> `AUTH_BYPASS` env flag that disabled all auth. Those are in `IMPROVEMENT_PLAN.md` with tests
> that statically scan the routes and fail if the auth middleware disappears.

**A7. What would you improve?**
> Hash the API keys and support rotation/per-device keys; replace the leaderboard's
> full-collection scan with a `UserStats` rollup; move analytics aggregation into MongoDB
> `$group`; fix the 29 TypeScript errors so `npm run build` passes; add integration tests
> against a real database.

**A8. What are you most proud of?**
> That I audited my own code honestly. There's a document listing 30-odd findings by severity,
> and I closed the high-severity ones with regression tests. A lot of student projects don't
> have that.

**A9. What's the current status?**
> Security batch and the Insights page are done on the current branch. Leaderboard scaling,
> the serverless-cron fix, and most medium/low items are open. The extension is packaged as
> 2.2.0; I can't confirm from the repo that 2.2.0 is live on the Marketplace.

---

## B. Architecture

**B1. Explain the architecture.**
> Client–server, RESTish, modular monolith. Three clients — the VS Code extension, the React
> SPA, and effectively `curl` — talk to one Express backend and one MongoDB. Features are
> separate Express routers sharing one connection pool and one deploy. Partial MVC: Mongoose
> models, routers as controllers, React as the view, with a thin service layer only for
> metrics, authorization, password hashing, ingest normalisation, and the scheduler. No queue,
> no cache, no gateway, no WebSockets.

**B2. Why this architecture?**
> One backend developer, free-tier budget, and the features genuinely share the data model —
> everything hangs off `activities` and `users`. A monolith deploys and debugs as one process
> with no cross-service consistency problems. The parts that would justify extraction later —
> high-volume ingest, heavy leaderboard aggregation — are exactly the parts I've flagged for a
> queue + worker + rollup evolution.

**B3. How does data flow through the system?**
> Ingest: extension event → tracker counters → 30s flush → `POST /api/extension/track` with an
> `x-api-key` header → `verifyApiKey` does `User.findOne({apiKey})` → normalise the payload →
> `Activity.create` → one document. Read: browser → `GET /api/analytics/:id` with the JWT
> cookie → `isAuthenticated` → ownership check → `Activity.find` for the window → aggregate in
> JavaScript → JSON → Chart.js.

**B4. Why separate the extension and the web app?**
> They're different runtimes with different jobs — the extension is a passive collector in the
> editor, the web app is an interactive dashboard. They share only the backend API. Coupling
> them would mean shipping dashboard code to every VS Code install.

**B5. What's the bottleneck?**
> The global leaderboard. It aggregates the entire `activities` collection and loads every user
> into Node on every request — O(all activity + all users) with no window, cache, or
> pagination. It's the first thing that fails as data grows.

**B6. How would you scale the architecture?**
> `UserStats` rollup updated on ingest so the leaderboard reads O(users) from an index (or a
> Redis sorted set for O(log n) rank). Move analytics from JS `reduce` to MongoDB `$group`
> pipelines / precomputed rollups. Past ~100k users, a queue in front of ingest, shard
> `activities` by `userId`, Redis for caching and rate-limit counters.

**B7. Is it MVC?**
> Partially. Models are Mongoose schemas; the "controllers" are the route handlers (there's no
> separate controller layer); the view is React. A proper controller/service split exists only
> for the metrics and auth-helper code. I'd call it "MVC-ish with a thin service layer".

**B8. Monolith vs modular monolith vs microservices — which is this and why?**
> Modular monolith. One process, but features are cleanly separated into routers and a few
> services, so extracting one later (ingest first) is mechanical. Full microservices would add
> network hops and distributed transactions for a project with one datastore and one
> developer.

---

## C. VS Code extension

**C1. How does the extension activate?**
> `activationEvents: ["onStartupFinished"]` — it activates shortly after VS Code finishes
> starting, not lazily on a command, because tracking should be passive. `activate()` creates
> five trackers, registers seven commands, subscribes to config changes, and calls `start()`.

**C2. Which VS Code APIs does it use?**
> `workspace.onDidChangeTextDocument / onDidSaveTextDocument / onDidOpenTextDocument`,
> `window.onDidChangeActiveTextEditor / onDidChangeWindowState /
> onDidStart|EndTerminalShellExecution`, `debug.onDidStart|TerminateDebugSession /
> onDidChangeBreakpoints`, `commands.registerCommand`, `workspace.getConfiguration`,
> `window.showInputBox / showWarningMessage / setStatusBarMessage`, `env.openExternal`, and the
> built-in `vscode.git` extension's API (`getExtension('vscode.git').exports.getAPI(1)`).

**C3. What events are monitored and what's collected?**
> Editor edits (gross chars/lines inserted & deleted, churn, undo/redo, saves, file switches,
> read-vs-write attention split, large-insert flags), window focus/blur time and flow blocks,
> git commits + uncommitted file count/age via the Git extension, terminal command executions
> (category, build/test/debug, git action, success/failure by exit code, repeated failures),
> and debug sessions.

**C4. How frequently is data collected and sent?**
> A timer ticks every `flushIntervalSeconds` (default 30s). A flush POSTs only when buffered
> active minutes reach `minFlushMinutes` (**default 2** since 2.3.0, was 0.5) *and* the payload
> has real signal (`payloadHasSignal` — edits/commands/commits). So roughly a POST every ~2
> minutes of real coding.

**C5. Is data batched?**
> Not over HTTP — one `POST /api/extension/track` per flush. But since 2026‑09‑08 the
> **backend merges** them: it floors the timestamp to a 10-minute boundary and `$inc`-upserts
> a `(user, project, language, bucketStart)` document, so many flushes in a window become one
> row. `/track/batch` (`insertMany`) exists but the extension never calls it.
> `ACTIVITY_BUCKET_MS=0` reverts to one `Activity.create` per flush.

**C6. Is there buffering / debouncing / throttling?**
> Active minutes are buffered in the `state` object between ticks and across a failed flush.
> There's a 5s attention sampler and a 15s focus ticker. Edits aren't debounced — they bump
> `lastActivityMs` and increment counters directly.

**C7. What happens when the user is idle?**
> After 2 minutes with no edit/nav event, it flushes the tail, sets `isPaused = true`, and
> stops buffering. It resumes on the next real activity event.

**C8. What happens when VS Code closes?**
> `deactivate()` does a best-effort final `flushIfNeeded(true)`, then stops the trackers. If
> that POST fails, the tail is lost.

**C9. What happens with no internet / backend down?**
> `axios` throws; the buffered minutes are kept **in memory** and retried on the next tick.
> There's no disk queue, so a VS Code restart loses anything un-flushed.

**C10. Where is the API key stored locally? Is it secure?**
> In the user's global `settings.json` via `workspace.getConfiguration('codetrackr').update
> ('apiKey', key, ConfigurationTarget.Global)` — **plaintext**. It should use VS Code
> SecretStorage (`context.secrets`), which uses the OS keychain. That's a recommended fix.

**C11. What if the user enters an invalid key?**
> `Setup API Key` calls `GET /api/extension/verify`; a 401 shows "that API key was rejected".
> During normal tracking a 401 triggers a one-time actionable prompt ("Set API Key" / "Open
> Dashboard"), gated by `authWarningShown` so it only nags once per session.

**C12. What if the key expires?**
> Keys don't expire. Only regeneration invalidates one, and then the next flush 401s and
> prompts.

**C13. What if the user changes account?**
> They regenerate on the new account and re-run Setup API Key. The extension has no notion of
> "which account" beyond the key string.

**C14. How is duplicate activity handled? Same payload twice?**
> Still not idempotent, but bounded now: a replay `$inc`s the *same 10-minute bucket* rather
> than creating a second row, so it double-counts *within* one bucket instead of adding a
> phantom document. The proper fix is a client-generated uuid per flush plus a unique index or
> a short dedupe window.

**C15. Why stamp the payload with the interval start, not "now"?**
> Stamping upload time pushed every session forward in the day and skewed hour-of-day
> analytics. `timestamp = ISO(now - durationSeconds*1000)`.

**C16. How does churn tracking work?**
> When lines are deleted, `EditorTracker.consumeChurn` attributes them against still-fresh
> insertions (within a 10-minute window), newest first, and counts the overlap as churn —
> "I wrote this and immediately deleted it". Deletes with no matching recent insert are just
> `linesDeleted`, not churn.

**C17. How does it detect commits made in the Source Control panel?**
> `GitStateTracker` subscribes to the built-in Git extension's `repo.state.onDidChange` and
> increments `commits` whenever `repo.state.HEAD.commit` changes. That catches GUI/GitLens
> commits, not just terminal `git commit`. It never reads commit messages or diffs.

**C18. How was the extension packaged and published?**
> esbuild bundles `src/extension.ts` + deps into `dist/extension.js` (`--external:vscode`),
> `vsce package` makes the `.vsix`, `vsce publish` with an Azure DevOps PAT. There was an
> incident: a `2.1.0` was uploaded before `2.0.x`, and the Marketplace serves the highest
> version *number*, so it served stale code for months until `2.2.0` superseded it.

**C19. What's the `consumeInterval` contract?**
> Every tracker exposes `getIntervalSnapshot()` (peek, no side effect) and `consumeInterval()`
> (return the snapshot **and reset** the counters). `buildPayload` calls `consumeInterval` on
> all of them; one flush = the sum of all trackers for that window. Gauges like
> `uncommittedFiles` are point-in-time and not reset.

**C20. How is command privacy handled?**
> `sanitizeCommand` redacts `token=/password=/apikey=/bearer` patterns to `***`, then
> `normalizeCommand` reduces to a short canonical form (`git commit`, `npm run build`) and
> truncates to 120 chars. `activation.test.js` asserts the payload never contains the
> workspace path or inserted text.

**C21. What breaks if the backend adds a new required field to the payload?**
> Old extension installs would 400. That's why the backend's changes are additive and the
> normalisers default every missing field to zero — an old payload still stores, just with
> zeros for the new metrics.

---

## D. Backend

**D1. Walk me through a request from the extension.**
> `POST /api/extension/track` → CORS (a server-to-server call has no `Origin`, so it's allowed)
> → `express.json()` parses the body → `verifyApiKey` reads `x-api-key`, `User.findOne
> ({apiKey})`, attaches `req.user` → the handler checks `fileName && language && duration`,
> parses `timestamp` (falls back to now), runs the four `normalize*Analytics` functions →
> `planActivityWrite(normalized, when)` decides: **bucket** (has signal) → `Activity.
> findOneAndUpdate` `$inc`-ing the 10-minute `(user,project,language,bucketStart)` document,
> `upsert:true`, `11000`-retry; **merge** (no signal) → `$inc` only an existing bucket's
> duration; **legacy** (`ACTIVITY_BUCKET_MS=0`) → `Activity.create`. `201` (or `202` for merge).

**D2. Express 4 vs Express 5 — why does it matter here?**
> Express 5 propagates rejected promises from async handlers to the error pipeline
> automatically, so I don't need `.catch(next)` on every route. In practice there's no central
> error handler, so a thrown error still becomes a generic 500 — the routes catch their own
> errors and return `{ message, error: err.message }`, which leaks internals (M-10).

**D3. Where's your validation layer?**
> Minimal — `if (!fileName || !language || !duration)` on ingest, and the normalisers clamp
> sub-document numbers to non-negative. `express-validator` is a dependency and unused (M-4).
> `!duration` also wrongly rejects a legitimate `0`. I'd add schema validation with bounds
> (`0 < duration <= 3600`, `timestamp` within a sane range).

**D4. How do you handle async errors?**
> Every handler is a `try/catch` returning a 500 with `err.message`. There's no central error
> middleware — that's a known gap; the fix is one `app.use((err,req,res,next)=>...)` that logs
> server-side with a request id and returns a generic body.

**D5. Middleware order?**
> `cors` → `express.json` → `cookie-parser` → `passport.initialize` → routers. No `helmet`, no
> rate limiter. `helmet` and `express-rate-limit` are installed but not wired in (M-3) — the
> old `server.js.old` used them; they were dropped in the rewrite.

**D6. How is CORS configured?**
> An allowlist: `FRONTEND_URL` plus `localhost:5173/5174`, `credentials: true`. Requests with
> no `Origin` (the extension) are allowed; disallowed origins get `callback(null, false)` — no
> error thrown, the browser just blocks it.

**D7. Authentication vs authorization in the backend?**
> Authentication: `isAuthenticated` (JWT cookie) for the web, `verifyApiKey` (header) for the
> extension. Authorization: `services/authorization.js` — `assertOwnership` on analytics (403
> if `:userId` ≠ session), membership checks on group details and team reads, owner-scoped
> queries on goals (`findOne({_id, userId})`), and `/api/metrics` takes no `:userId` at all so
> it's IDOR-proof by construction.

**D8. What status codes do you use?**
> 200 reads, 201 creates, 400 bad input, 401 unauth, 403 not entitled, 404 not found, 500
> thrown. No 409 (double-join returns 500), no 429 (no rate limiting).

**D9. How does the notification scheduler work and what's wrong with it?**
> `node-cron` `'0 * * * *'` plus an immediate run on startup. `checkUpcomingDeadlines` finds
> in-progress goals due in 6–7 hours that haven't been reminded and creates a notification;
> `checkOverdueGoals` does the same for past-deadline goals. On serverless it's broken (H-13):
> every cold start re-runs the immediate sweep and the hourly cron never fires. The fix is
> Vercel Cron or an external trigger hitting a protected internal route.

**D10. What does `AUTH_BYPASS` do and is it safe?**
> It disables all authentication and attaches the most-active user to every request — a dev
> convenience. It's refused when `NODE_ENV === 'production'` (`isBypassAllowed` checks both the
> flag and the env), and `authorization.test.js` asserts that. It's still a footgun in dev.

---

## E. MongoDB

**E1. Describe the schema.**
> Eight collections. `activities` is the high-volume one — since 2026‑09‑08 **one document per
> 10-minute `(user, project, language)` window** (`$inc`-merged), with `userId` (a String, the
> hex of `users._id`), file/language/project, `duration` in seconds, line counts, `timestamp`
> (= `bucketStart`), `files[]`, `flushCount`, and four *sparse* analytics sub-documents
> (terminal, editor, focus, git — only non-zero leaves stored). `users` (googleId, email,
> plaintext `apiKey`), `groups` + `groupmembers` (a join table with a unique compound index),
> `goals`, `teams` (embedded `members` array), `notifications`, and `dailysummaries` (nightly
> rollup, one per user per UTC day).

**E2. Why is `userId` a String on `activities` but an ObjectId elsewhere?**
> Historical — early ingest stored the hex string. It forces `$toObjectId` coercion in the
> leaderboard pipeline and blocks `$lookup`. Migrating it to ObjectId with a dual-read compat
> window is on the list (M-6).

**E3. Embedding vs referencing — where did you use each and why?**
> `groupmembers` is a reference join table because groups need efficient membership queries,
> a uniqueness guard, and "discover groups I'm not in". `teams.members` is an embedded ObjectId
> array — simpler, but it has a lost-update window on concurrent `push` and no uniqueness
> guarantee. If I consolidated, teams would become a join table too (or I'd delete teams — the
> UI doesn't use it).

**E4. What indexes do you have?**
> On `activities` (updated 2026‑09‑08): `{userId:1}`, **`{userId:1,timestamp:-1}`**,
> `{userId:1,projectName:1}`, `{userId:1,language:1}`, a **partial-unique**
> `{userId:1,projectName:1,language:1,bucketStart:1}` (`partialFilterExpression: bucketStart
> exists` — the race-safe bucket-merge guard), and a **400-day TTL on `{createdAt:1}`**. The
> old `{userId:1,date:-1}` was dropped. Unique compound `{groupId:1,userId:1}` on
> `groupmembers`; unique `{userId:1,day:1}` on `dailysummaries`; unique on
> `users.googleId/email/apiKey` (sparse).

**E5. Any missing indexes?**
> Not on the per-user reads any more — I added `{userId:1,timestamp:-1}`, which every
> analytics/metrics/streak query uses (they filter on `timestamp`; the old index was on a dead
> `date` field). What's still missing is anything to help the leaderboard's collection-wide
> `$group` — but that's a full scan by nature; the fix is a `UserStats` rollup, not an index.

**E6. How do you do aggregations?**
> Two ways, inconsistently. `computeStreak`, `/summary`, `/api/metrics`, the group-details
> leaderboard, and now the daily rollup use real `$match`/`$group` pipelines. The
> daily/weekly/timeslot analytics endpoints do `Activity.find()` then `.reduce()` in Node —
> tech debt (M-1); bounded now that docs are bucketed (~hundreds not ~thousands) but still
> ships them to the app to sum.

**E7. Give me an example aggregation pipeline in the project.**
> The streak: `$match { userId, timestamp: { $gte: 90d } }` → `$group` by
> `$dateToString` of `timestamp − timezoneOffsetMs` with `seconds: { $sum: '$duration' }` →
> `$match { seconds: { $gt: 0 } }`. Then in Node it builds a Set of active day-keys and walks
> backward from today (or yesterday) counting consecutive days.

**E8. Consistency and transactions?**
> No transactions anywhere. Ingest is now an atomic `findOneAndUpdate` with `$inc` into a
> bucket — race-safe (two concurrent flushes for the same window both apply; the partial
> unique index handles the upsert-insert race with a `11000`-retry). The weak spots elsewhere
> are `team.members.push` (should be `$addToSet`) and the double-join race (caught by the
> unique index but returned as a 500).

**E9. When would PostgreSQL be better?**
> The relational parts — group/team membership, goal ownership — where foreign keys and
> cascades would remove defensive null-checks; and the leaderboard, which is a `GROUP BY
> user_id` that Postgres does with a covering index instead of loading the table into Node.
> Transactions for the multi-step group flows. A time-series DB like Timescale would be even
> better for the activity stream itself.

**E10. When is MongoDB better?**
> Here: append-only self-contained documents, schema evolution without migrations (I added
> three sub-documents with no ALTER), the per-user-window access pattern, no hot-path joins,
> and a free managed tier.

**E11. How would you handle the activity collection growing to hundreds of millions of docs?**
> The first step is done — merging flushes into 10-minute buckets cut the write/row rate ~10×,
> and a 400-day TTL caps growth. Next: the `dailysummaries` rollup already exists; repoint the
> all-time reads (leaderboard, `/summary`, `metrics >90d`) at it and tighten the raw TTL. Then
> shard raw `activities` on `userId` (hashed) so per-user queries stay single-shard; archive
> anything past the TTL to a columnar warehouse for trend analysis.

**E12. You changed the write model recently — walk me through it.**
> Ingest was an append-only event log: one row per 30–90s flush, each repeating the metadata
> plus four mostly-zero analytics objects. I added a pure `planActivityWrite` that decides how
> to persist a flush, and the route now does an atomic `Activity.findOneAndUpdate` with `$inc`
> into a `(user, project, language, 10-minute window)` document. `$inc.duration` is the real
> measured seconds — every total (hours, lines, streak, leaderboard) is byte-for-byte the same;
> only time-of-day resolution drops to a 10-minute grid, which is the finest any dashboard
> reads. Row count fell ~10×. I also made the sub-docs sparse, dropped a dead `date` field,
> added the `timestamp` index, and built a nightly `dailysummaries` rollup + 400-day TTL.
> `ACTIVITY_BUCKET_MS=0` is the rollback switch. It's covered by 4 new pure-function test
> suites; there's still no integration test against a real DB.

**E12. Race conditions in the DB layer?**
> Double-join (unique index → 500 instead of 409); `team.members.push` lost update;
> two-members-leave-at-once both deleting an empty group (benign). Ingest itself is
> race-free — single insert.

---

## F. Authentication & the unique key

**F1. Why did you use a unique key for the extension?**
> There's no browser in the VS Code extension host to run an OAuth redirect, and I wanted
> tracking to work offline once configured. An API key is one `findOne` and trivially
> regenerated. It's a legitimate MVP choice — but I'd call it what it is in a review.

**F2. Is the unique key actually authentication?**
> Yes. It's a bearer credential — possession alone authorises writes, no second factor, sent
> on every request. It's not "just an identifier"; an identifier would be safe to expose.
> Functionally it's an unscoped, non-expiring API token, stored in plaintext.

**F3. Why not OAuth between the extension and backend?**
> The right answer is an OAuth 2.0 device-authorization flow, but it's more moving parts — a
> polling endpoint, token refresh, the "authorize in a browser" step. The key was faster to
> ship. For production I'd move to the device flow or have the dashboard mint a short-lived
> signed ingest token.

**F4. Why not a JWT between extension and backend?**
> Same reason — a JWT needs an issue/refresh mechanism and the extension is often offline. If I
> keep the header model I'd at least make it a short-lived JWT the dashboard issues, so it
> expires and carries a scope (`aud: 'ingest'`).

**F5. What happens if someone steals another user's key?**
> They can forge unlimited activity for that user — inflate the global leaderboard, corrupt the
> victim's analytics. They can't read the victim's dashboard (that needs the JWT cookie) or
> touch groups/goals. Only rotation stops it, and rotation is all-or-nothing.

**F6. How do you prevent impersonation?**
> Today: not much beyond "the key is 256 bits so it can't be guessed". There's no rate limit,
> no anomaly detection, no per-device binding. That's the weakness.

**F7. How would you rotate the key safely?**
> Support multiple named keys per user with independent revocation, and rotation with a grace
> window — the old key stays valid for 24 hours after you generate a new one so tracking
> doesn't silently break while you update the extension.

**F8. Should the key be stored hashed?**
> Yes. Issue it as `ct_<keyId>_<secret>`, store `sha256(secret)` (keys are high-entropy so a
> slow KDF isn't required), look up by the indexed `keyId`, compare the hash in constant time.
> A DB leak then yields no usable keys. Right now `users.apiKey` is plaintext.

**F9. How would you redesign the whole extension-auth story for production?**
> OAuth 2.0 device flow: the extension shows a code, the user approves it in the dashboard, the
> extension gets a short-lived access token + refresh token, scoped to ingest. No long-lived
> secret ever lives in `settings.json`. Plus rate limiting, `duration` validation, and an
> idempotency key on ingest as defence in depth.

**F10. Walk me through the web auth flow.**
> `/login` redirects to `GET /auth/google` → Passport Google strategy → callback find-or-creates
> the user (new users get an API key) → sign a JWT `{id,name,email,isFirstLogin}` with a
> 1-day expiry → set it as an httpOnly cookie (`secure` + `sameSite:'none'` in prod) →
> redirect to `/onboarding` or `/dashboard`. Protected routes verify the cookie and
> `User.findById`.

**F11. Why a JWT in a cookie instead of a server session?**
> Stateless — no session store to run, and it survives a serverless cold start. `httpOnly`
> stops JavaScript from reading it. The cost is no server-side revocation and no refresh token,
> so expiry is a hard logout.

**F12. What are the weaknesses of your JWT setup?**
> `JWT_SECRET` has a hardcoded fallback `'your_jwt_secret'` — if that's ever live, tokens are
> forgeable (M-9). No refresh token. No revocation list. `sameSite:'none'` plus no CSRF token
> means the no-body POSTs are theoretically forgeable (low impact).

**F13. How does the extension get the key, exactly?**
> The user copies it from the Onboarding or Profile page (it's in the `GET /api/user/profile`
> response), runs `CodeTrackr: Setup API Key`, pastes it into a password-masked input box
> (min 16 chars), and it's saved to global VS Code config.

**F14. What database query links an incoming payload to a user?**
> `User.findOne({ apiKey })` in `verifyApiKey`, backed by the unique sparse index on
> `users.apiKey`. The resulting `_id` (as a string) becomes `Activity.userId`.

**F15. What if two users somehow had the same key?**
> They can't — the unique index rejects the second write, and 256 bits of `crypto.randomBytes`
> makes an accidental collision astronomically unlikely. If it happened, `findOne` would return
> whichever the index found first — a reason to prefer a `keyId` lookup.

---

## G. Frontend

**G1. Describe the frontend architecture.**
> React 19 + Vite + TypeScript + Tailwind. `App.tsx` is a router plus an auth gate — it fetches
> `/api/user/profile` on mount and only renders the app if that's a 200. Pages are Dashboard,
> Insights, Leaderboard, Goals, Groups, Profile, Onboarding, Login. State is local `useState`
> plus prop-drilling the `user` object; the only Context is `ThemeContext` for the 28 themes.

**G2. How do you manage server state?**
> Honestly, badly — every page refetches on navigation with `cache:'no-cache'`.
> `@tanstack/react-query` is installed but unused. Adopting it is a medium-term item; it'd give
> caching, dedup, and retry.

**G3. Why no Redux / Zustand?**
> There's little shared client state — `user` is the only cross-page value and it's small
> enough to prop-drill. The thing that actually needs management is *server* state, and that's
> React Query's job, not Redux's.

**G4. What React hooks do you use and where?**
> `useState` and `useEffect` everywhere; `useCallback` on `fetchAnalytics`/`fetchMetrics` to
> keep a stable dependency for the effect; `useRef` in `NotificationPanel` for click-outside;
> `useContext` via a `useTheme()` hook that throws if used outside the provider.

**G5. What runs twice in StrictMode and does it matter?**
> The mount effects — the data fetches. They're idempotent GETs, so a double fire in dev is
> harmless (two identical requests). It'd matter if an effect had a side effect like a POST.

**G6. `Dashboard` fires three requests on mount, one redundant — why?**
> `useEffect([])` calls `fetchAnalytics` + `fetchWeekly`; `useEffect([viewMode])` also calls
> `fetchAnalytics` on the first render because `viewMode` "changes" from undefined to `'daily'`
> conceptually. One duplicate call (M-11). Fix: a "first render" ref guard, or React Query
> dedup.

**G7. How does theming work?**
> `ThemeContext` holds one of 28 palettes, persisted to `localStorage.selectedTheme`, and an
> effect writes each colour to a CSS custom property on `:root`. Components mostly use inline
> `style={{ color: theme.colors.x }}` — verbose. A better design is CSS variables plus Tailwind
> `theme.extend` so `text-primary` just works; `tailwind.config` `extend` is currently empty.

**G8. How do you render charts?**
> Chart.js 4 via react-chartjs-2 — Line for hourly/daily hours, Pie for language breakdown, Bar
> for terminal success/failure and command usage. Scales and elements are registered globally
> in `Dashboard.tsx`.

**G9. Chart.js vs Recharts — which would you pick now?**
> Recharts. It's declarative React components, no global registration, and easier to theme.
> Chart.js is canvas — not accessible, hard to server-render.

**G10. Any bugs in the frontend you know about?**
> Three real ones. The "Repeated Failures" panel on the dashboard renders hardcoded mock
> arrays instead of the real `repeatedFailedCommands` the backend computes. The Goals page's
> to-do items only mutate React state — nothing is persisted. And `Teams.tsx` exists but isn't
> routed. Plus `npm run build` fails because `tsc -b` has 29 pre-existing type errors.

**G11. How do loading and error states work?**
> Each page has a `loading` boolean → spinner text. Failed fetches `console.error`; `Insights`
> has an explicit error card with a retry button; `Groups` uses `alert()`. A shared typed
> fetch hook with toasts would make it consistent.

**G12. How does the frontend know who's logged in?**
> `App.tsx` fetches `/api/user/profile` with `credentials:'include'`. The JWT cookie goes
> along; a 200 means logged in and gives the `user` object; anything else renders `/login`.

---

## H. ML / Insights

**H1. Is the Insights page machine learning?**
> No. It's deterministic descriptive statistics — coefficient of variation for consistency, a
> weighted linear score for the productive-hour ranking, medians for flow blocks, a ratio for
> estimation accuracy. No model, no training, no inference, no Python, no LLM.

**H2. Why statistics instead of ML?**
> No labelled outcomes to learn from and not enough users. Stats work from the first data
> point, have no training pipeline, and every number is explainable in a review. ML makes sense
> once I store outcomes like goal slippage or retention and have a user base.

**H3. Walk me through the Insights pipeline.**
> `GET /api/metrics` → `isAuthenticated` (no `:userId` — identity is the session) →
> `buildMetrics` runs four `Activity.aggregate` calls: a totals `$group`, a by-day `$group`, a
> by-hour `$group`, and a goal/actual-hours pairing. Then `metricsDerive` — pure functions —
> computes deep-work ratio, flow-block stats, consistency index, true peak window, and
> estimation calibration. JSON back to the page, which renders cards.

**H4. Define the consistency index.**
> `1 − (standard deviation / mean)` of daily coding minutes, clamped to `[0, 1]`. A perfectly
> steady week scores 1; an erratic one scores low. It rewards sustainable habits over heroic
> bursts.

**H5. What's "true peak window"?**
> The hour that maximises `commits*10 + linesInserted/10 − churnLines/5` among hours with
> tracked time. The point is that your *busiest* hour is often not your *most productive* one —
> the seed script deliberately makes 2pm busy-but-churny and 9pm productive so you can see the
> two diverge.

**H6. How is the data preprocessed?**
> Aggregated in MongoDB with `$ifNull` guards so metrics that depend on extension-2.1.0 fields
> read missing values as zero for older activity. `flowBlocksMs` arrays are pushed and
> flattened. Daily minutes come from a `$dateToString` group in the user's timezone. No
> normalisation or feature scaling — it's not ML.

**H7. Is inference performed? Is there a trained model?**
> No and no. It's all closed-form arithmetic.

**H8. Is an external AI / LLM API used?**
> No. An LLM narration layer is *designed* in `docs/TRACKING_ROADMAP.md` — Gemini was the pick,
> with a hard rule that any number it outputs must be traceable to the structured metrics
> object to prevent hallucination — but it's not built.

**H9. Is insight generation sync or async? Cached?**
> Synchronous — the request awaits four aggregations. **Not cached** — recomputed on every page
> load and every window change. Caching per `(userId, window)` is a known gap.

**H10. What happens with insufficient data?**
> `flowBlocks.blockCount === 0` (pre-2.1.0 extension) → the focus/flow/churn/read/switch cards
> render "—" with a "please update" banner. `estimationCalibration` returns `null` below 2
> completed goals → a prompt to complete goals with a tech stack set.

**H11. What happens if the ML processing fails?**
> The route catches it and returns `500 { success: false }`; the page shows "Could not load
> your insights" with a retry button.

**H12. How is the output validated?**
> For the current stats layer, the functions clamp their own ranges (`consistencyIndex ∈ [0,1]`,
> `deepWorkRatio ≤ 1`) and `metrics.test.js` asserts edge cases. For the *designed* LLM layer,
> a validator would reject any figure not present in the metrics object.

**H13. If you had to add real ML, how would you approach it?**
> Feature-engineer per-session vectors (focused minutes, deep-block count, churn ratio,
> commits, context switches, hour-of-day), z-score normalise per user because habits are
> relative, then start unsupervised — k-means or a GMM over session vectors to find archetypes
> like "deep focus", "exploratory", "firefighting". Supervised only once I have a real label
> like goal slippage. Serve it from a batch job writing an `insights` collection, never inline
> in the request. Evaluate with hold-out RMSE/AUC and watch for leakage.

**H14. How would you prevent LLM hallucination in the narration layer?**
> Constrain output to a JSON schema, prompt with *only* the structured metrics (no raw data),
> and run a post-generation validator that rejects the response if it contains any number not
> in the metrics object. Cache the narration keyed on a hash of the metrics so it's stable.

**H15. What's the latency budget and how would you meet it?**
> The stats layer is a few aggregations — sub-second at current scale. An LLM call is
> 1–3 seconds, so it'd be generated async (on ingest rollup or a nightly job) and served from
> cache, never blocking the page.

---

## I. Leaderboard

**I1. What metric determines ranking?**
> Total coding hours (`Σ duration / 3600`) over all time, descending. Ties break on array
> order. `rank = index + 1`.

**I2. Is ranking computed in MongoDB or Node?**
> Both. A MongoDB `$group` sums duration/lines per user and `$addToSet`s project names, then
> Node merges that with `User.find({})`, sorts, and computes the relative scores.

**I3. Is it cached?**
> No — recomputed on every request. Always fresh, always expensive.

**I4. How are ties handled?**
> They aren't, really — same `totalHours` keeps the merge order. I'd add a deterministic
> tie-break (most recent activity, then `userId`).

**I5. What query is used?**
> `Activity.aggregate([{ $addFields: coerce userId to ObjectId }, { $group: by user, sum
> duration/lines, addToSet project, count }, { $addFields: totalHours, projectCount, ... }])`
> over the **entire collection**, plus `User.find({}).lean()`.

**I6. What happens with 100k users?**
> It times out. The aggregate scans every activity document ever written and Node loads every
> user. There's no time window, no `$limit` in the pipeline, no pagination.

**I7. How would you optimise the leaderboard for 10 million users?**
> A `UserStats` rollup collection — `{ userId, totalSeconds, totalLinesAdded, activityCount,
> updatedAt }` — incremented with `$inc` on ingest. The leaderboard becomes
> `UserStats.find().sort({ totalSeconds: -1 }).limit(50)` — an indexed read of `U` docs, not a
> scan of `A`. For O(log n) rank lookups ("what's my rank?"), a Redis sorted set: `ZADD` on
> rollup update, `ZREVRANGE` for a page, `ZREVRANK` for your position. Add time-windowed
> rollups for weekly/monthly boards, paginate, and cache the top-N.

**I8. The relative scoring shifts for everyone when the top user codes — is that a bug?**
> It's a design smell. `speed/quality/engagement/impact` are `ratio-to-current-max * 5`, so the
> denominator moves. I'd switch to absolute or percentile-based scores so a user's number is
> stable unless *their* activity changes.

**I9. "commits" on the leaderboard — what is it actually?**
> It's `activityCount` — `$sum { $ifNull: ['$flushCount', 1] }`, i.e. the number of flushes
> (since bucketing; was raw doc count). Still not `gitAnalytics.commits` — mislabelled. Should
> sum the real git commits.

**I10. Privacy issue with the leaderboard?**
> It returns every user's email. Should return a display name or handle only.

**I11. How does the group leaderboard differ?**
> Same aggregation pattern scoped to the group's member IDs, all-time, no pagination. The
> `Promise.all(members.map(async ...))` has no `await` inside, so the async wrapper is
> pointless.

---

## J. Groups

**J0. What are groups for?**
> They're the reason the project exists. My friends and I run coding contests and daily-practice
> streaks; a group is how you scope the competition — everyone joins, everyone's editor is
> tracked automatically, and `GET /:groupId/details` returns the member list plus a per-member
> leaderboard (`codingHours`, `totalLinesAdded`). The original idea also included comparing
> *errors* — the extension does record each member's failed commands/builds/repeated failures
> — but the group leaderboard doesn't surface that yet; it's the top item on my list and a
> read-path change only (extend the same `$group` with `$sum` of the failure counters).

**J1. How are groups created?**
> `POST /api/groups/create` with name, description, visibility, and (for private) a password.
> The password is scrypt-hashed, the `Group` is saved, and the creator is auto-added as a
> `GroupMember`. The response strips the password.

**J2. How do users join?**
> Public: `POST /:groupId/join` with an empty body — no password check. Private: the body
> carries a password, `verifyPassword(password, group.password)` runs (scrypt, or plaintext for
> legacy rows which then get rehashed), 401 on mismatch, else a `GroupMember` is created.

**J3. How is membership stored?**
> A `groupmembers` join table — `{ groupId, userId, joinedAt }` with a unique compound index
> on `{groupId, userId}`. That's the right model for many-to-many and the index is the one hard
> concurrency guard in the system.

**J4. How do users leave?**
> `POST /:groupId/leave` deletes the `GroupMember`. If the group then has zero members,
> `Group.findByIdAndDelete` — the group self-destructs when empty.

**J5. Is there a group admin / owner?**
> `createdBy` is stored but never used for authorization. There's no kick, rename, delete, or
> ownership transfer. Adding a `role` column to `groupmembers` and gating mutations on
> `role === 'owner'` is the fix.

**J6. What race conditions exist?**
> Double-join — the unique index catches it but the error surfaces as a 500 (should be 409).
> Two members leaving simultaneously can both compute `remainingMembers` and one deletes the
> empty group — harmless but not transactional. Password brute force on `/join` — no rate
> limit.

**J7. Are private groups hidden?**
> No — `discover` lists every group you're not in, including private ones (name, description,
> creator). They're password-gated, not hidden. I'd exclude private groups from discovery
> unless invited.

**J8. How would you add invitations?**
> An `invites` collection — `{ groupId, invitedEmail/userId, token, expiresAt, status }`. The
> owner creates an invite, the invitee accepts via a tokenised link, which creates the
> `GroupMember`. Revocable, auditable, no shared secret — strictly better than a group
> password.

**J9. How would you build a group activity feed?**
> Either poll a `GET /:groupId/feed` endpoint that queries recent `activities` for member IDs,
> or — for real-time — a WebSocket room per group that the ingest path publishes to.

**J10. The original goal was comparing errors and contest-week activity — how would you finish that?**
> Two small changes. **Errors:** the group-details endpoint already `$group`s member activity
> for hours and lines; add `$sum` of `terminalAnalytics.failedCommands` / `failedBuilds` /
> `debuggingSessions` and a computed `buildSuccessRate`, then render the columns. **Contest
> weeks:** add `?from=&to=` to `/:groupId/details` and a `$match` on `timestamp`; store
> `contestStart`/`contestEnd` on the group and default the window to that. The 10-minute
> bucketing doesn't interfere — buckets are stamped `bucketStart`, so a time-range `$match`
> still works. Both are read-path only, no schema change.

---

## K. Security

**K1. Do a security review of your own project.**
> Fixed: analytics/leaderboard now require auth + ownership; legacy open write/read endpoints
> deleted; group passwords scrypt-hashed; `AUTH_BYPASS` refused in production; IDORs on
> goals/teams closed. Still open: the API key is plaintext and non-expiring; no rate limiting
> anywhere; no security headers (`helmet` unused); no request validation on ingest; error
> responses echo `err.message`; the leaderboard leaks emails; no idempotency on ingest; the
> group search regex is a ReDoS vector; `JWT_SECRET` has an unsafe fallback.

**K2. Biggest security risk?**
> The API key model combined with no ingest validation or rate limiting. A valid key plus one
> `curl` with `duration: 999999999` corrupts the global leaderboard, and there's nothing to
> stop it.

**K3. How would you prevent activity fraud / leaderboard cheating?**
> Validate `duration` (1–3600s per flush) and `timestamp` (within the last 24h); rate-limit per
> key; require a client idempotency key so replays are rejected; run anomaly detection on the
> duration-to-edits ratio; and derive leaderboard rank from server-computed metrics, not raw
> client-supplied duration alone.

**K4. Is there SQL/NoSQL injection risk?**
> The group `discover` search puts user input straight into `$regex` — that's a ReDoS risk and
> an unescaped pattern. Elsewhere values are passed as query *values*, not operators or
> `$where`, so classic operator injection is limited, but any place a raw request-body object
> reaches a query should be audited (e.g. that nobody passes `{ "$ne": null }` as a field
> value).

**K5. XSS?**
> Low risk — React escapes by default and there's no `dangerouslySetInnerHTML`. User strings
> (group names, goal titles) render as text.

**K6. CSRF?**
> The cookie is `sameSite:'none'` in production with no CSRF token, so the no-body POSTs
> (logout, onboarding flag, key regeneration) are theoretically forgeable. Low impact but I'd
> add a token or move ingest to a separate origin and use `sameSite:'lax'`.

**K7. How are secrets managed?**
> `.env` locally (gitignored — verified not in the repo), platform env vars in deploy.
> Weakness: `JWT_SECRET` falls back to a literal string if unset; `config/passport.js`
> correctly throws if the Google vars are missing.

**K8. Replay attacks?**
> Possible on ingest — capture one valid POST, replay it N times, get N× the activity. No
> idempotency key, no nonce. Fix: a client-generated uuid per flush plus a unique index or a
> short-lived dedupe set.

**K9. Rate limiting?**
> None. `express-rate-limit` is installed and unused. `/auth/google`, `/api/extension/track`,
> and `/join` are all uncapped.

**K10. Broken access control — any left?**
> The high-severity IDORs are fixed (analytics ownership, goal scoping, team/group membership,
> `/api/metrics` has no `:userId`). Remaining: group `discover` enumerates private groups; no
> group-owner authorization; the leaderboard's email exposure is an info-disclosure issue.

**K11. How do you log securely?**
> Currently ~40 `console.log` calls, some printing user IDs per request. That should be a
> levelled structured logger that redacts identifiers and never logs secrets.

**K12. Extension-specific security?**
> The key lives in `settings.json` (plaintext) — should be SecretStorage. Terminal commands are
> sanitised (`token=***`) and truncated before transmit. No file contents, diffs, commit
> messages, or absolute paths are ever sent — there's a test asserting the payload has no
> workspace path.

---

## L. Scalability

**L1. What breaks first as you grow?**
> The global leaderboard — O(all activity) aggregation in application memory on every request.

**L2. 10,000 users — what's the state?**
> Ingest is trivial (hundreds of writes/min). Analytics are bounded per user but wasteful
> (M-1). The leaderboard starts taking seconds once `activities` is tens of millions of docs.
> Add `{userId:1,timestamp:-1}` and a windowed leaderboard as stopgaps.

**L3. 100,000 users?**
> The leaderboard is unusable without a rollup. No caching means repeated identical analytics
> recomputation. The `node-cron` overdue sweep (an unindexed `findOne` per overdue goal) gets
> expensive. One Mongo primary still copes with writes.

**L4. 1,000,000 users?**
> Wrong shape. Queue in front of ingest, workers writing to sharded `activities` (hashed on
> `userId`) plus rollups, Redis sorted set for the leaderboard, Redis cache for insights,
> analytics served from precomputed rollups, raw docs archived to a warehouse, and real
> observability.

**L5. 10,000,000 users — leaderboard specifically?**
> Redis sorted set: `ZADD leaderboard <totalSeconds> <userId>` whenever the rollup updates.
> `ZREVRANGE 0 49` for the top page, `ZREVRANK userId` for "your rank", `ZRANGEBYSCORE` for
> pagination. O(log n) writes, O(log n + page) reads. Rebuild from the rollup collection if
> Redis is lost.

**L6. How do you keep ingest latency low under load?**
> Make the API handler do the minimum — validate and enqueue, don't write synchronously.
> Workers batch-insert and `$inc` the rollups. The extension already tolerates delay (it
> buffers), so a queue adds no user-visible latency.

**L7. Caching strategy?**
> Redis: leaderboard sorted set (write-through on rollup update), insights per
> `(userId, window)` with a short TTL, rate-limit counters. HTTP `Cache-Control` on analytics
> with a 30–60s max-age. React Query on the client for dedup.

**L8. Would you add a message queue? Which?**
> Yes, past ~10k concurrent users — SQS for managed simplicity, or Kafka if I also want a
> durable event log to replay for analytics/warehouse loads. Not before then; it's premature
> complexity at demo scale.

**L9. Horizontal scaling — what has to change?**
> The API is already stateless (JWT, no session store) so it scales horizontally as-is once
> `node-cron` moves out of the process. Mongo needs a replica set then sharding. Redis for any
> shared counter/cache state.

---

## M. Debugging scenarios

**M1. A user's activity isn't appearing on the dashboard. Debug it.**
> In order: (1) `Show Connection Info` — is the extension running, key set, backend URL right?
> (2) `verify` returns 401? → regenerate + re-setup. (3) `apiBase` — the old localhost
> regression. (4) Is it flushing? — `duration < 0.5 min` sends nothing; try `Flush Now`.
> (5) Network — Render free tier cold start can exceed the 15s axios timeout once.
> (6) Backend logs — 400 (missing field) or 500 (Mongo). Query `activities` by the string
> `userId`. (7) Dashboard fetch — 401 (session expired), 403 (wrong id), missing
> `credentials:'include'`. (8) Timezone — a near-midnight flush buckets to an adjacent day.
> (9) It's there but hidden — mock "Repeated Failures" panel, or Insights needs 2.1.0 data.

**M2. The leaderboard times out. Debug it.**
> Check `db.activities.countDocuments()` and `explain()` the aggregate. It's a full collection
> scan by design (H-7). Stopgap: add a `$match { timestamp: { $gte: 30d } }` and `$sort` +
> `$limit` inside the pipeline. Real fix: a `UserStats` rollup.

**M3. Streak shows 0 but the user coded yesterday.**
> `computeStreak` anchors on today or yesterday within a 90-day window and only counts days
> where `Σ duration > 0`. Check: was yesterday's flush `duration > 0`? Is `?timezone=` being
> sent (so day bucketing matches)? Is there a gap between yesterday and the anchor? Is the
> activity older than 90 days?

**M4. Goal progress is stuck at 0%.**
> Progress counts only activity where `language === goal.techStack` **exactly** (case
> sensitive) and `timestamp <= deadline`. A goal with `techStack: 'React'` won't match
> `language: 'javascript'`. Check the exact strings; consider an alias map.

**M5. Notifications never arrive.**
> Is the backend serverless? `node-cron` won't fire between requests (H-13). On Render, did the
> free-tier process sleep? Are there goals matching the 6–7 hour window with
> `reminderSent: false`?

**M6. Duplicate activity after a flaky connection.**
> No idempotency — the extension retried and the backend stored both. Confirm two docs with
> near-identical fields and adjacent `createdAt`. Fix: idempotency key + unique index.

**M7. `npm run build` fails on the frontend.**
> `tsc -b` reports 29 errors (mostly unused imports/vars, 2 real type errors). `vite build`
> alone works. Fix the errors or split the script.

**M8. The extension isn't tracking terminal commands.**
> `onDidStartTerminalShellExecution` requires a recent VS Code and shell integration enabled.
> `TerminalTracker.start` logs "not supported in this VS Code version" and no-ops if the API is
> missing.

**M9. Group join returns 500 instead of 409 on a double-join.**
> The unique compound index on `groupmembers` throws a duplicate-key error, which the route's
> generic `catch` maps to 500. Fix: detect `err.code === 11000` and return 409.

**M10. A CORS error in the browser console.**
> The origin isn't in the allowlist (`FRONTEND_URL` + localhost:5173/5174). Check
> `FRONTEND_URL` on the backend matches the deployed frontend origin exactly (scheme + host +
> port), and that the request sends `credentials:'include'` since `credentials: true` is set.

---

## N. Trick / follow-up questions (interviewer challenges the answer)

**N1.**
> **Q:** Why MongoDB? **A:** Append-only documents, schema evolution without migrations,
> per-user-window access.
> **Follow-up:** But you have a join table (`groupmembers`) and embedded arrays (`teams`) —
> isn't that a relational model fighting a document store?
> **A:** Partly, yes. The join table is me reaching for a relational pattern because groups
> need it. It works — the unique compound index gives me the guarantee — but it's a sign that
> the *social* half of the app would be happier in Postgres. The *activity* half, which is the
> bulk and the hot path, genuinely suits documents.

**N2.**
> **Q:** Why not PostgreSQL? **A:** The activity stream suits documents and Atlas has a free
> tier.
> **Follow-up:** Postgres has JSONB and a free tier too. Be specific.
> **A:** Fair. The concrete reasons were: I added three nested analytics objects with zero
> migration effort because Mongoose just defaults them; and the team's existing muscle memory
> was Mongoose. Neither is a *technical* knockout for Postgres — if the relational features
> were the priority I'd have picked Postgres + JSONB for the activity payload.

**N3.**
> **Q:** Why not Firebase? **A:** I wanted control over the API and the aggregation logic.
> **Follow-up:** Firestore does aggregation and auth for free — you'd have shipped faster.
> **A:** True for the CRUD and auth. But the analytics are custom aggregations over a
> high-volume collection, and Firestore's aggregation and pricing model (per-document reads)
> would have hurt — the daily endpoint alone reads a week of documents. And the VS Code
> extension needs a stable server API regardless. I'd still run my own backend for ingest and
> analytics.

**N4.**
> **Q:** Why not Redis? **A:** Nothing needs it yet.
> **Follow-up:** Your leaderboard is O(n) per request — that's a "needs it now" situation.
> **A:** The *right* first fix is the rollup collection, which changes the complexity class. A
> Redis sorted set on top of that gives O(log n) rank lookups and is the production answer.
> But a cache without the rollup just hides an O(n) recompute behind a TTL — it doesn't fix the
> underlying scan.

**N5.**
> **Q:** Why not Kafka? **A:** One write per user per minute fits one Mongo node.
> **Follow-up:** What's your actual number for "when Kafka earns its place"?
> **A:** When peak ingest writes threaten p99 latency on the API, or when I want a replayable
> event log for warehouse loads — roughly past 10k concurrent active users, or ~thousands of
> writes/second. Below that it's operational overhead for no benefit.

**N6.**
> **Q:** Why not WebSockets? **A:** Notifications poll every 30s and that's fine.
> **Follow-up:** Polling from every open tab is load you're choosing to take.
> **A:** Correct — it's N clients × one request / 30s. At small scale it's cheaper to operate
> than a WebSocket fleet. I'd switch when I add real-time group activity, where polling latency
> actually matters, and I'd use the switch to also cut the notification polling.

**N7.**
> **Q:** Why not OAuth for the extension? **A:** No browser in the extension host, wanted
> offline.
> **Follow-up:** The device authorization flow exists exactly for headless clients. Why not
> that?
> **A:** It's the right answer and I'd build it for production. For the MVP it was more moving
> parts — a polling endpoint, token refresh, expiry handling in an often-offline client —
> versus one `findOne`. I made a speed trade-off and I can articulate its cost.

**N8.**
> **Q:** Why not JWT between extension and backend? **A:** Needs issue/refresh, extension is
> offline.
> **Follow-up:** A 30-day JWT with no refresh is still better than a never-expiring plaintext
> key.
> **A:** Agreed — that's a strictly-better intermediate step: the dashboard mints a signed
> `aud: 'ingest'` token, the extension stores it, it expires, and I can revoke by rotating the
> signing key. I'd do that before a full device flow.

**N9.**
> **Q:** Why not microservices? **A:** One dev, one DB, shared model.
> **Follow-up:** You've identified ingest as the scaling problem — that's a service boundary
> screaming at you.
> **A:** Yes, and ingest is the one service I'd extract first — it's stateless, write-only, and
> would sit behind a queue. But the *rest* of the app (analytics, groups, goals) shares the
> data model and has no independent scaling need, so splitting it further would be cargo-culting.

**N10.**
> **Q:** Why not store everything in one collection? **A:** I nearly do — `activities` is one
> collection.
> **Follow-up:** Then why separate `users`, `groups`, etc.?
> **A:** Different lifecycles and access patterns. `users` is low-volume, read on every
> request, uniquely indexed. `activities` is high-volume, append-only, time-ranged. Merging
> them would mean every activity query steps over user documents and vice versa. The split is
> by access pattern, not by "it's a different noun".

**N11.**
> **Q:** Why not calculate insights on the frontend? **A:** The frontend would download every
> activity document.
> **Follow-up:** You could send a pre-aggregated payload and let the client do the final
> maths.
> **A:** That's basically what I do — the client gets the aggregated `metrics` object and just
> formats it. The heavy aggregation has to be server-side, next to the data. Doing the
> arithmetic client-side buys nothing and risks inconsistency between clients.

**N12.**
> **Q:** Why use ML for insights? **A:** I don't — it's statistics.
> **Follow-up:** So why is there an "Insights" page implying intelligence?
> **A:** The intelligence is in the metric *design* — separating productive from busy hours,
> using coefficient of variation instead of raw totals, comparing estimates to actuals. That's
> a considered analytics product, not a dumb sum. I just don't dress it up as ML, and the
> designed LLM layer would add narration, not new numbers.

**N13.**
> **Q:** Why not use simple rules instead of "ML"? **A:** I do — `metricsDerive` is thresholded
> rules on computed metrics.
> **Follow-up:** Then the roadmap's clustering is over-engineering?
> **A:** For the current product, yes — rules are enough. Clustering earns its place only if I
> want to *discover* session archetypes I didn't hand-define, and only with enough data. It's a
> "later, maybe" not a "should have".

**N14.**
> **Q:** Why not use an LLM? **A:** It would hallucinate the numbers.
> **Follow-up:** Constrained decoding and a validator solve that. So why isn't it built?
> **A:** Time, and it's genuinely the last 10% — the metrics have to be right first. The design
> is done: structured-metrics-only prompt, JSON schema output, a validator that rejects any
> unlisted figure, cached per metrics-hash.

**N15.**
> **Q:** What happens when your database grows? **A:** The leaderboard scan and unindexed
> timestamp filters get slow.
> **Follow-up:** Give me the migration plan, not the symptom.
> **A:** (1) Add `{userId:1,timestamp:-1}`. (2) Introduce a `UserStats` rollup written on
> ingest; cut the leaderboard over to it behind a flag. (3) Move analytics endpoints from
> `find().reduce()` to `$group`, sharing the metrics service's aggregation code. (4) Add
> `daily_stats` rollups for windowed views. (5) Archive raw `activities` older than N months.
> Each step is independently shippable.

**N16.**
> **Q:** What if the extension sends duplicate events? **A:** They're double-counted.
> **Follow-up:** How would you make ingest idempotent without killing throughput?
> **A:** Client generates a uuid per flush; the backend has a unique index on
> `(userId, idempotencyKey)` or checks a Redis set with a 10-minute TTL. A duplicate insert
> fails fast on the index; the API returns 200 with the existing doc's id. No throughput cost —
> it's one indexed lookup.

**N17.**
> **Q:** What if two requests arrive simultaneously? **A:** Ingest is a single insert, atomic.
> **Follow-up:** What about the group-join path?
> **A:** Two concurrent joins → the unique compound index rejects the second → currently a 500,
> should be a 409. No data corruption. The genuine lost-update risk is `team.members.push`,
> which I'd fix with `$addToSet`.

**N18.**
> **Q:** Can users manipulate leaderboard scores? **A:** Yes, trivially.
> **Follow-up:** Show me the exact request.
> **A:** `curl -XPOST https://api/api/extension/track -H "x-api-key: <mine>" -H "content-type:
> application/json" -d '{"fileName":"a.ts","language":"TypeScript","duration":3600}'` in a
> loop. No rate limit, no `duration` bound, no anomaly check. Each call adds an hour.

**N19.**
> **Q:** How would you prevent cheating? **A:** Validate duration, rate-limit per key,
> idempotency keys, anomaly detection.
> **Follow-up:** A determined cheater spreads it out and stays under the anomaly threshold.
> **A:** Then you cross-check signals — hours with zero edits, zero focus events, and zero git
> activity are suspicious; a real coding hour has correlated editor and focus data. Weight the
> leaderboard on *corroborated* activity, and cap the contribution of any single flush.

**N20.**
> **Q:** Your `metricsDerive` functions are pure — why does that matter? **A:** They unit-test
> without a database.
> **Follow-up:** But the aggregations that feed them aren't tested against a real DB.
> **A:** Right — that's the gap I call out. The maths is proven; the queries are only
> syntax-checked and reasoned about. `supertest` + `mongodb-memory-server` closes it and it's
> on the plan.

---

## O. Code-level questions

**O1. `verifyApiKey` — time complexity and failure mode?**
> `User.findOne({ apiKey })` — O(log n) via the unique index. On a thrown error: `catch` → 500
> `{ message: 'Failed to authenticate API key' }`. No side effects, no race.

**O2. `computeStreak` — why anchor on "today or yesterday"?**
> So a day that hasn't started yet (no activity because it's 1am) doesn't read as a broken
> streak. It checks `keyFor(0)` then `keyFor(1)`; if neither is active, streak is 0.

**O3. `buildPayload` in the extension — what's in it and what's deliberately not?**
> In: interval-start `timestamp`, `fileName` (basename), `fileType`, `projectName`, `language`,
> `duration` seconds, gross `linesAdded/Removed`, and the four analytics sub-objects. Not in:
> file contents, diffs, commit messages, absolute paths, full command strings (sanitised +
> truncated).

**O4. `normalizeFocusAnalytics` — why cap `flowBlocksMs` at 200?**
> To bound document size — a pathological or malicious client could otherwise send a huge
> array and bloat the collection. `ingest.test.js` asserts a 500-element input is capped to
> ≤ 200.

**O5. `leaderboard.js` `$addFields userIdObj` — explain the regex.**
> `activities.userId` is a String. `{ $regexMatch: { input: '$userId', regex: /^[0-9a-fA-F]{24}$/ } }`
> — if it looks like a 24-hex ObjectId, `$toObjectId` it so the `$group` key matches
> `users._id`; otherwise keep the string (legacy/garbage rows group separately).

**O6. `resolveOwnedUserId` — what does it return and why?**
> The user id to query, or `null` if it already sent a 401/403 response. Callers do
> `const id = resolveOwnedUserId(req, res); if (!id) return;`. It centralises the ownership
> check so every analytics route can't forget it — and `routeGuards.test.js` counts the calls
> to enforce that.

**O7. `EditorTracker.sampleAttention` — how does read vs write time work?**
> A 5-second sampler. If the last edit was within the elapsed interval, the interval counts as
> `writeMs`; otherwise `readMs`. It only samples while `window.state.focused` is not false, so
> reading with VS Code in the background doesn't inflate `readMs`.

**O8. `FocusTracker.consumeInterval` — why leave an open block open?**
> A flow block spans flush boundaries — you don't stop being "in flow" because 30 seconds
> elapsed. Only `tick()` closes a block, after 2 minutes idle. `consumeInterval` emits
> completed blocks and resets, but `blockStartMs` is untouched.

**O9. `metricsService.buildMetrics` — why `$push` then flatten in JS instead of `$reduce`?**
> `$group` with `$push: '$focusAnalytics.flowBlocksMs'` yields an array of arrays; the code
> does `blocks.reduce((all, arr) => all.concat(arr))`. `$reduce` with `$concatArrays` in the
> pipeline would keep it server-side — a minor improvement.

**O10. `groups.js` join — the "opportunistic migration". Explain.**
> After a successful `verifyPassword`, if `!isHashed(group.password)` (a legacy plaintext row),
> it rehashes with scrypt and saves. So plaintext passwords get upgraded lazily on the next
> correct login, with no big-bang migration.

**O11. `notificationScheduler.checkOverdueGoals` — the inefficiency?**
> For every overdue goal it does a `Notification.findOne({ goalId, type: 'deadline_missed' })`
> to check for a duplicate — an unindexed lookup per goal, every run. Fix: a
> `{ goalId:1, type:1 }` index, or a `overdueNotified` flag on the goal like `reminderSent`.

**O12. `Dashboard.tsx` `pieChartOptions.legend.labels.color: '#ffffff'` hardcoded — problem?**
> On a light theme the pie legend text is white-on-light and unreadable. It should use
> `theme.colors.text`. Small but real theming bug.

**O13. `App.tsx` — what determines whether the SPA shows the app or the login page?**
> `loadUserProfile()` on mount: `GET /api/user/profile` with `credentials:'include'`. 200 with
> `data.user.id` → `setUser`; anything else → `setUser(null)` → only `/login` renders.

**O14. `authorization.assertOwnership` — why 403 not 404 for another user's data?**
> The caller *is* authenticated, just not entitled — 403 is the honest code. A 404 would also
> be defensible (don't reveal the resource exists) but the code chose 403 and the test asserts
> it.

**O15. Why does `extension.ts` restart the timer on a config change?**
> `onDidChangeConfiguration` for `codetrackr.flushIntervalSeconds` calls `stop(); start()` —
> otherwise a new interval value wouldn't take effect until a window reload, because
> `setInterval` was created with the old value.

---

## P. HR / behavioural / project-discussion

**P1. What was your role on the team?**
> Full-stack, with a focus on the extension's tracking accuracy, the backend data model and
> API, and a security/correctness audit. I'd describe specific things I can defend in depth
> rather than claim the whole codebase.

**P2. How did you split work with your teammates?**
> *(Answer from your real experience.)* A safe framing: "We split by layer and feature — I
> owned [X], they owned [Y] — and we integrated through the API contract, which is why the
> extension and backend could evolve semi-independently."

**P3. How did you handle disagreements?**
> *(Real example.)* One concrete design tension in the repo: API key vs a heavier auth flow —
> we chose the key for speed with a documented plan to harden it.

**P4. What did you learn?**
> How much of "it works" is timezone handling and clock semantics; that measuring developer
> activity honestly is harder than it sounds (elapsed ≠ focused, net lines ≠ real work); the
> value of auditing your own code — writing `IMPROVEMENT_PLAN.md` changed how I saw the
> project; and, most recently, that the write model matters — going from one row per flush to
> a 10-minute `$inc` bucket cut write volume ~10× with zero change to the numbers, once I
> convinced myself `$inc` of real seconds is exactly the same sum as separate rows.

**P5. What would you do differently starting over?**
> Aggregate in MongoDB from day one; use a real test framework and an in-memory Mongo for
> integration tests from the start; hash the API keys immediately; and keep the frontend
> typecheck green in CI so it never drifts to 29 errors.

**P6. How do you know the project is "done"?**
> It isn't — it's a working demo with a documented backlog. "Done" for a launch would mean the
> security batch fully closed, the leaderboard rollup in place, integration tests, and CI.

**P7. Walk me through a bug you fixed.**
> The `date` field. Backdated flushes (a queued flush after being offline) were being filed
> under the *ingest* day, not the day the work happened, because `date` defaulted to `Date.now`
> and the handler didn't set it from `timestamp`. First fix: derive one `when` instant from the
> body's `timestamp` and write it to both fields. Then, doing the write-reduction work, I
> confirmed nothing actually *read* `date` (the `date:` tokens in the aggregations are the
> `$dateToString` parameter, referencing `$timestamp`) — so I deleted the field and its index
> entirely, with a one-off `$unset` migration. Fewer bytes per row, one less index to maintain.

**P8. How do you approach code review / quality?**
> The `IMPROVEMENT_PLAN.md` is the evidence — I catalogued findings by severity with problem /
> cause / fix / files / risk, then batched the fixes and wrote regression tests, including a
> static scan that fails if an auth-protected route loses its middleware.

**P9. What are you weakest at in this project?**
> Testing depth — nothing has run against a real database, and the frontend has zero tests.
> And I let the frontend typecheck rot. Both are known and planned, but they're the honest
> weak spots.
