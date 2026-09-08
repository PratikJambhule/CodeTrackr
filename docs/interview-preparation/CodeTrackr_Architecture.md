# CodeTrackr — Architecture & Data Flow (Interview Deep-Dive)

*Reconstructed from the actual codebase on 2026-09-07 (branch `feat/security-and-insights`).
Where this contradicts the informal project description, the code is authoritative.*

> **Changed 2026‑09‑08:** the ingest write model. `POST /api/extension/track` no longer does
> one `Activity.create` per flush — it **`$inc`-upserts a 10-minute `(userId, projectName,
> language)` bucket** (`services/activityBucket.js` → `planActivityWrite`). The extension
> (2.3.0) skips signal-less flushes. Analytics sub-docs are sparse; the `date` field is gone;
> a `DailySummary` nightly rollup + 400-day TTL exist. `$inc.duration` is real seconds so
> **every total is unchanged** — only time-of-day resolution drops to the 10-minute grid.
> `ACTIVITY_BUCKET_MS=0` restores the old behaviour. Mentally substitute
> "`Activity.create()`" → "bucket `$inc` upsert" below.

---

## 1. System overview

CodeTrackr is a **client–server, REST, modular-monolith** web application with three clients
of one backend:

| Component | Runtime | Deploy target | Talks to backend via |
|---|---|---|---|
| VS Code extension | TypeScript → esbuild CJS bundle, runs in the VS Code extension host (Node) | VS Code Marketplace (`CodeTrackr-ext.codetrackr-vscode`) | `axios` POST, `x-api-key` header |
| React dashboard (SPA) | React 19 + Vite 7, runs in the browser | Vercel (`code-trackr-frontend.vercel.app`) | `fetch(..., {credentials:'include'})`, JWT cookie |
| Backend API | Node 18 + Express 5 + Mongoose 8 | Render (primary, per extension default) — Vercel serverless config also present | — |
| Database | MongoDB (Atlas) | Atlas cluster | Mongoose driver (TLS) |

There is **no** API gateway, message queue, cache, search index, or WebSocket layer.
Everything is synchronous HTTP + one MongoDB.

```
                         ┌────────────────────────┐
                         │        Developer        │
                         └───────────┬────────────┘
                    signs in         │        installs + configures
             (Google OAuth)          │        (pastes API key)
                         ┌───────────▼────────────┐        ┌───────────────────────────┐
                         │   React Dashboard SPA   │        │   VS Code Extension        │
                         │   (Vercel)              │        │   (Marketplace)            │
                         └───────────┬────────────┘        └─────────────┬─────────────┘
              GET/POST, JWT cookie   │                                    │  POST /api/extension/track
              credentials:'include'  │                                    │  header x-api-key: <64 hex>
                                     ▼                                    ▼
      ┌──────────────────────────────────────────────────────────────────────────────────────┐
      │                     Express API   (app.js)                                            │
      │  CORS(allowlist,credentials) → express.json → cookie-parser → passport.initialize     │
      │                                                                                      │
      │   /auth/*            passport-google-oauth20 → sign JWT → httpOnly cookie             │
      │   /api/extension/*   verifyApiKey  → normalise payload → Activity.create()            │
      │   /api/analytics/*   isAuthenticated + ownership → Activity.find → JS aggregation     │
      │   /api/metrics       isAuthenticated → metricsService → metricsDerive (pure stats)    │
      │   /api/leaderboard   isAuthenticated → aggregate ALL activity + ALL users in Node     │
      │   /api/groups|goals|teams|notifications/*   isAuthenticated (+ per-feature checks)    │
      │                                                                                      │
      │   services/notificationScheduler.js   node-cron  '0 * * * *'  (hourly)               │
      └───────────────────────────────────────┬──────────────────────────────────────────────┘
                                              │ Mongoose
                                              ▼
                        ┌──────────────────────────────────────────────┐
                        │  MongoDB (Atlas)                             │
                        │  activities · users · groups · groupmembers  │
                        │  goals · teams · notifications               │
                        └──────────────────────────────────────────────┘
```

**Architectural classification (say this in an interview):**
- *Client–server* — three thin clients, one authoritative server + DB.
- *RESTish* — resource-oriented URLs, JSON, HTTP verbs; not strict REST (no HATEOAS, some RPC-style paths like `/groups/:id/join`).
- *Modular monolith* — a single Express process; features are separate routers (`routes/*.js`) sharing one DB connection and one deploy unit.
- *Partial MVC* — Mongoose **models**; routers act as **controllers**; React is the **view**. A **service layer** exists only for `metrics`, `authorization`, `passwordHash`, `activityNormalizers`, `notificationScheduler` — everything else is route → Mongoose directly.
- *Not* microservices, *not* event-driven, *not* CQRS (though the recommended leaderboard rollup would be a read-model / CQRS-lite step).

---

## 2. Component responsibilities

### 2.1 VS Code extension (`extension/src/`)

| File | Responsibility |
|---|---|
| `extension.ts` | Activation (`onStartupFinished`), flush timer, idle/pause state machine, payload assembly, `axios` POST, command registration, API-key setup/verify UI, status-bar messages. |
| `editorTracker.ts` | Per-interval editor counters: chars/lines inserted & deleted, **churn** (lines written then deleted within 10 min), undo/redo, saves, file switches, unique files, read-vs-write attention split (5 s sampler), large-insert flags. |
| `focusTracker.ts` | Window focus/blur time via `onDidChangeWindowState`; **flow blocks** — a working stretch that closes after 2 min idle; emits `flowBlocksMs[]` + `longestBlockMs`. |
| `gitStateTracker.ts` | Subscribes to the built-in `vscode.git` extension API; increments `commits` when `repo.state.HEAD.commit` changes; tracks uncommitted file count + age. Counts GUI/Source-Control commits, not just terminal `git commit`. |
| `terminalTracker.ts` + `analyticsAggregator.ts` + `commandClassifier.ts` + `gitTracker.ts` | `onDidStart/EndTerminalShellExecution` → classify (category, build/test/debug, git action) → success/failure by exit code → per-category counts, build/test success rates, repeated-failure detection. Commands are **sanitised** (`token=…` → `token=***`) and truncated. |
| `debugTracker.ts` | Debug session / breakpoint / exception counts; folded into `terminalAnalytics.debuggingSessions`. |

Each tracker implements the same contract: `getIntervalSnapshot()` (peek) and
`consumeInterval()` (snapshot **and reset**). One flush = one `Activity` document =
the sum of all trackers' `consumeInterval()` for that window.

### 2.2 Backend (`backend/`)

| Path | Responsibility |
|---|---|
| `app.js` | Express bootstrap: `trust proxy`, CORS allowlist (`FRONTEND_URL` + localhost:5173/5174, `credentials:true`), `express.json()`, `cookie-parser`, `passport.initialize()`, health route, `mongoose.connect`, mount 10 routers, `initScheduler()`, `app.listen()`. |
| `api/index.js` | `module.exports = (req,res) => serverless(app)(req,res)` — Vercel serverless adapter. |
| `config/passport.js` | Google OAuth 2.0 strategy. Find-or-create `User` by `googleId`; new users get `generateApiKey()`. **Throws at import** if any `GOOGLE_*` env var is missing. |
| `middleware/auth.js` | `isAuthenticated` (JWT from `req.cookies.token`), `verifyApiKey` (`User.findOne({ apiKey })`), `AUTH_BYPASS` handling (refused in production). |
| `routes/*.js` | Controllers. Each route: middleware → validate → Mongoose call(s) → shape JSON → `try/catch` → `500 {message, error}`. |
| `services/authorization.js` | `sameUser(a,b)`, `assertOwnership(requestedId, sessionId)` → `{ok,status,message}`, `isBypassAllowed(env)`. Dependency-free (unit-tested). |
| `services/passwordHash.js` | `crypto.scrypt` hash/verify for **group** passwords. Format `scrypt$salt$hash`. Verifies legacy plaintext too; `routes/groups.js` upgrades on next successful join. |
| `services/activityNormalizers.js` | `normalizeEditor/Focus/GitAnalytics(body)` — coerce to non-negative finite numbers, default missing sub-docs to zero, cap `flowBlocksMs` at 200. Tolerates payloads from older extension versions. |
| `services/metricsService.js` | `buildMetrics(userId, {days, timezoneOffset})` — runs the MongoDB aggregations the Insights page needs; delegates maths to `metricsDerive`. |
| `services/metricsDerive.js` | Pure functions: `deepWorkRatio`, `flowBlockStats`, `consistencyIndex`, `truePeakWindow`, `estimationCalibration`. No DB, no deps — fully unit-tested. |
| `services/notificationScheduler.js` | `node-cron` `'0 * * * *'` + an immediate run on startup: `checkUpcomingDeadlines` (6–7 h out, in-progress, not yet reminded) and `checkOverdueGoals` (deadline passed). |

### 2.3 Frontend (`frontend/src/`)

| Path | Responsibility |
|---|---|
| `main.tsx` | `createRoot` + `<StrictMode><ThemeProvider><App/></ThemeProvider>`. |
| `App.tsx` | `BrowserRouter`; on mount `GET /api/user/profile` → set/clear `user`; unauthenticated → only `/login`; authenticated → nav shell + routes; `handleLogout`. |
| `config.ts` | `API_URL = VITE_API_URL || VITE_LOCAL_API_URL || 'http://localhost:5050'`. |
| `contexts/ThemeContext.tsx` | 28 theme palettes, `localStorage.selectedTheme`, applies CSS custom properties, `useTheme()` hook. |
| `pages/Login.tsx` | Single button → `window.location.href = API_URL + '/auth/google'`. |
| `pages/Onboarding.tsx` | `GET /api/user/profile` → show API key + install steps; `POST /api/user/complete-onboarding` → `/dashboard`. |
| `pages/Dashboard.tsx` | Daily/weekly toggle; `GET /api/analytics/:id`, `/weekly/:id`, `/timeslot/:id`; chart.js Line/Pie/Bar; 2-hour drill-down. **"Repeated Failures" panel = hardcoded mock data.** |
| `pages/Insights.tsx` | `GET /api/metrics?days=&timezone=`; 5 metric cards + 4 secondary tiles; hides focus metrics until extension 2.1.0 data exists. |
| `pages/Leaderboard.tsx` | `GET /api/leaderboard`; table + computed "team average" row. |
| `pages/Goals.tsx` | Calendar; `GET /api/goals`, `POST /api/goals/create`. To-do list is **client-state only**. No progress/complete/delete. |
| `pages/Groups.tsx` | `my-groups` / `discover` tabs; create / join / leave / details (members + group leaderboard). |
| `pages/Profile.tsx` | `GET /api/user/profile`; show/copy API key; `POST /api/user/regenerate-api-key`. |
| `pages/Teams.tsx` | Exists, **not routed** — orphaned. |
| `components/NotificationPanel.tsx` | Polls `/api/notifications` + `/unread-count` every 30 s; browser `Notification` API. |

---

## 3. Data flow — extension → backend → database

```
 (1) VS Code event: onDidChangeTextDocument / onDidSaveTextDocument /
     onDidChangeActiveTextEditor / terminal shell exec / git HEAD change / debug session
                     │
                     ▼
 (2) The relevant tracker updates in-memory counters.
     markActivity() refreshes state.lastActivityMs (idle detection).
                     │
     setInterval(flushIntervalSeconds, default 30s) tick:
                     │
        idle ≥ 2 min ? ──yes──► flush remaining active time, set isPaused=true, stop buffering
                     │no
                     ▼
 (3) flushIfNeeded(false): totalBuffered = bufferedMinutes + (now - startedMs)/60000
     totalBuffered ≥ minFlushMinutes (default 0.5) ?  ──no──► wait for next tick
                     │yes
                     ▼
 (4) buildPayload(durationSeconds):
       timestamp = ISO(now - durationSeconds*1000)   // START of the interval, not upload time
       fileName  = basename(activeEditor.fileName)    // NO path
       fileType, projectName (workspace.name), language (languageId)
       duration  = round(minutes*60)   [seconds]
       linesAdded/Removed  = editorAnalytics.linesInserted/Deleted
       terminalAnalytics = terminalTracker.consumeInterval()
       editorAnalytics   = editorTracker.consumeInterval()
       focusAnalytics    = focusTracker.consumeInterval()
       gitAnalytics      = gitStateTracker.consumeInterval()
       (+ debugTracker.consumeInterval().debugSessions → terminalAnalytics.debuggingSessions)
                     │
                     ▼
 (5) axios.post(`${apiBase}/api/extension/track`, payload,
       { headers: { 'x-api-key': apiKey }, timeout: 15000 })
       success → status bar "Activity tracked ✅", reset startedMs, bufferedMinutes=0
       error   → keep bufferedMinutes = totalBuffered (in MEMORY only), 401 → prompt
                     │
                     ▼  (over the network)
 (6) POST /api/extension/track   →  middleware/auth.verifyApiKey
       apiKey = req.headers['x-api-key'].trim()
       user = await User.findOne({ apiKey })       // plaintext equality, unique index
       !user → 401 "Invalid API key"
       user  → req.user = user ; next()
                     │
                     ▼
 (7) routes/extension.js handler:
       validate: fileName && language && duration  (else 400)
       when = parse(timestamp) || now  (guarded for NaN)
       terminalPayload  = normalizeTerminalAnalytics(...)
       editorAnalytics  = normalizeEditorAnalytics(req.body)     // clamp ≥ 0, default 0
       focusAnalytics   = normalizeFocusAnalytics(req.body)      // flowBlocksMs cap 200
       gitAnalytics     = normalizeGitAnalytics(req.body)
       Activity.create({ userId: req.user._id.toString(), ...fields, timestamp: when, date: when })
                     │
                     ▼
 (8) MongoDB: one new document in `activities`.
     201 { success:true, activity:{ id, fileName, language, duration, timestamp } }
```

**Key properties of this path:**
- **One document per 10-minute `(user, project, language)` window** (since 2026‑09‑08) — an
  atomic `findOneAndUpdate` with `$inc`. A heavy day = tens of docs, not hundreds.
  `ACTIVITY_BUCKET_MS=0` → the old per-flush `Activity.create`.
- **Not idempotent, but bounded** — a same-window replay `$inc`s the existing bucket rather
  than creating a second row. There's still no client-generated key / dedupe window, so it
  double-counts *within* the bucket.
- **No server-side auth for the *content*** beyond "is the key valid" — a valid key can POST
  any `duration`/`language`/`timestamp` it likes (only parseability and truthiness are checked).
- **Backdating works** — `timestamp` from the body is trusted, so a queued/late flush files
  under the correct day (H-5 fix); the same mechanism means a malicious client can write
  history.

---

## 4. Data flow — dashboard read path

```
 Browser: user opens /dashboard
        │
        ▼
 Dashboard.tsx useEffect → fetch(`${API_URL}/api/analytics/${user.id}?timezone=${tzOffsetMinutes}`,
                                 { credentials:'include', cache:'no-cache' })
        │  Cookie: token=<JWT>
        ▼
 Express: isAuthenticated
     token = req.cookies.token ; decoded = jwt.verify(token, JWT_SECRET||'your_jwt_secret')
     req.user = await User.findById(decoded.id)      // 401 if missing/expired
        │
        ▼
 routes/analytics.js  GET /:userId
     resolveOwnedUserId(req,res):
        assertOwnership(req.params.userId, req.user._id.toString())
        → 403 "You may only access your own data" if they differ  (closes the IDOR — H-1)
        │
        ▼
     activities = await Activity.find({ userId: userIdStr, timestamp: { $gte: sevenDaysAgo } })
     // pulls 7 days of docs to render 1 day (M-1)
        │
        ▼
     JS aggregation (.filter / .reduce / Map):
        todayActivities → totalHours, projectCount, totalLinesAdded
        computeStreak(userIdStr, tzOffset)  → separate 90-day $group aggregation
        hourlyMap → dailyActivity[24]
        languageMap → languageBreakdown[]
        buildTerminalSummary(todayActivities) → terminalSummary + timelines
        │
        ▼
     res.json({ totalHours, projectCount, totalLinesAdded, streakDays,
                dailyActivity, languageBreakdown, terminalSummary,
                terminalTimeline, buildTimeline, gitTimeline })
        │
        ▼
 Dashboard.tsx: setAnalytics(data) → chart.js Line/Pie/Bar render
```

Weekly and time-slot endpoints follow the same shape. `computeStreak` is the only place a
real MongoDB `$group` runs for the dashboard; `summary/:userId` also uses `$group`. Everything
else is `find()` + JavaScript.

---

## 5. Data flow — Insights / "ML" pipeline

```
 Browser: /insights → fetch(`${API_URL}/api/metrics?days=30&timezone=${tzOffset}`, {credentials:'include'})
        │
        ▼
 routes/metrics.js  GET /
     isAuthenticated
     days = clamp(parseInt(days), 1, 365) || 30
     timezoneOffset = parseInt(timezone) || 0
     metrics = await buildMetrics(req.user._id.toString(), { days, timezoneOffset })
     // NOTE: no :userId param anywhere — identity is the session only (IDOR-proof by design)
        │
        ▼
 services/metricsService.buildMetrics:
     since = now - days*86400e3 ; match = { userId, timestamp: { $gte: since } }

     (A) Activity.aggregate — one $group over `match`:
           focusedMs, blocks(=$push flowBlocksMs), churnLines, linesInserted,
           readMs, writeMs, fileSwitches, commits(gitAnalytics.commits), totalSeconds
     (B) Activity.aggregate — $group by local day  → daily minutes[]
     (C) Activity.aggregate — $group by local hour → { hour, minutes, commits, linesInserted, churnLines }[]
     (D) buildGoalPairs(userId): Goal.find({status:'completed'}) →
           Activity.aggregate $group by language for those tech stacks →
           [{ estimatedHours, actualHours }]
        │
        ▼
 services/metricsDerive.js  (pure, synchronous, no DB):
     deepWorkRatio(flowBlocksMs, focusedMs)        = Σ(block ≥ 25min) / focusedMs
     flowBlockStats(flowBlocksMs)                  = { medianMs, longestMs, deepBlockCount, blockCount }
     consistencyIndex(dailyMinutes)                = clamp(1 − stddev/mean, 0, 1)
     truePeakWindow(hourly)                        = argmax(commits*10 + linesInserted/10 − churnLines/5)
     estimationCalibration(goalPairs)              = mean(actual/estimated), needs ≥ 2 pairs, else null
     + churnRatio, comprehensionLoad, contextSwitchesPerHour, commits, totalHours
        │
        ▼
 res.json({ success:true, metrics:{ windowDays, deepWorkRatio, flowBlocks, consistencyIndex,
            truePeakWindow, estimationCalibration, churnRatio, comprehensionLoad,
            contextSwitchesPerHour, commits, totalHours } })
        │
        ▼
 Insights.tsx: 5 primary cards + 4 secondary tiles.
     hasFocusData = metrics.flowBlocks.blockCount > 0
       → if false, focus/flow/churn/read/switch cards render "—" + an "update to 2.1.0" banner
     estimationCalibration null → "complete 2 goals with a tech stack" copy
```

**This is descriptive statistics, computed on demand, not cached, not ML.**
An LLM narration layer is designed in `docs/TRACKING_ROADMAP.md` (§5) but **not built**; the
plan there insists any generated number must be traceable to the structured metrics object
(anti-hallucination), and Gemini was the chosen provider.

---

## 6. Data flow — authentication (web)

```
 /login  ──click──►  window.location = API_URL + '/auth/google'
        │
        ▼
 GET /auth/google → passport.authenticate('google', { scope:['profile','email'], session:false })
        │  (redirect to Google consent)
        ▼
 Google → GET /auth/google/callback?code=...
        │
        ▼
 passport GoogleStrategy verify(accessToken, refreshToken, profile, done):
        user = User.findOne({ googleId: profile.id })
        exists → user.lastLogin = now ; user.isFirstLogin = false ; save
        new    → User.create({ googleId, name, email, profilePictureUrl, isFirstLogin:true })
                 user.generateApiKey()  // crypto.randomBytes(32).hex → 64 chars, PLAINTEXT
                 save
        done(null, user)
        │
        ▼
 callback handler:
        payload = { id, name, email, isFirstLogin }
        token   = jwt.sign(payload, JWT_SECRET || 'your_jwt_secret', { expiresIn:'1d' })
        res.cookie('token', token, { httpOnly:true,
                                     secure: isProd, sameSite: isProd ? 'none' : 'lax',
                                     maxAge: 24h })
        res.redirect(FRONTEND_URL + (isFirstLogin ? '/onboarding' : '/dashboard'))
        │
        ▼
 Frontend App.tsx mount → GET /api/user/profile { credentials:'include' }
        200 → setUser(data.user) → render app
        else → setUser(null) → /login
```

No refresh token, no server-side session table, no CSRF token (the cookie is `sameSite:'none'`
in production, which *does* allow cross-site sending — a gap, though there are few state-changing
GET routes and the JSON body + `credentials:'include'` pattern limits classic CSRF).

---

## 7. Data flow — account linking (the "unique key")

```
        Website (signup)                              VS Code Extension
             │ Google OAuth                                 │
             ▼                                              │
   User.create + user.generateApiKey()                      │
   apiKey = crypto.randomBytes(32).toString('hex')          │
   stored PLAINTEXT on users.apiKey (unique, sparse)        │
             │                                              │
   GET /api/user/profile  →  returns apiKey in JSON         │
             │  (Onboarding.tsx / Profile.tsx show it)      │
             ▼                                              ▼
   user copies the 64-char key  ───────────────►  "CodeTrackr: Setup API Key"
                                                  workspace config update('apiKey', key, Global)
                                                  → PLAINTEXT in ~/.../settings.json
                                                            │
                                                  every flush: header x-api-key: <key>
                                                            │
                                                            ▼
                                          verifyApiKey: User.findOne({ apiKey })
                                          → req.user ; Activity.userId = req.user._id.toString()
```

**Classification.** The key is **not merely an identifier** — a bare identifier would be safe
to expose. It is a **bearer credential**: possession alone authorises writes. It is:
- an **identifier** (resolves to exactly one user via the unique index),
- an **authenticator** for the ingest API (no second factor),
- a **pairing token** (links one extension install to one account),
- effectively an **unscoped, non-expiring API token** stored and compared **in plaintext**.

**Threat model.** Leak of the key → attacker can forge unlimited activity for that user
(inflate the leaderboard, corrupt their analytics) — but **cannot** read the victim's
dashboard (that needs the JWT cookie) or touch groups/goals. Rotation
(`/api/user/regenerate-api-key`) is the only mitigation and it is all-or-nothing (one key per
user, no grace window, no per-device keys).

**Recommended redesign** (see interview docs §7): store `sha256(key)` (or scrypt) at rest;
issue as `ct_<keyId>_<secret>` so lookup is by indexed `keyId` and comparison is
constant-time on the hash; support multiple named keys per user with independent revocation;
add rotation with a grace window; or move to short-lived signed ingest tokens minted by the
dashboard, or an OAuth 2.0 device-authorization flow.

---

## 8. Database — conceptual schema

```
        ┌─────────────┐                 ┌──────────────────────────────────────────┐
        │   users     │                 │              activities                  │
        ├─────────────┤                 ├──────────────────────────────────────────┤
        │ _id (OID)   │◄───── userId ───│ userId : String  (hex of users._id)      │
        │ googleId U  │  (string, not   │ fileName, fileType, projectName, language │
        │ email    U  │   a real ref)   │ duration : Number  (SECONDS)             │
        │ apiKey  U,S │                 │ linesAdded, linesRemoved                  │
        │ name        │                 │ timestamp : Date   date : Date            │
        │ isFirstLogin│                 │ terminalAnalytics { … }                   │
        └──────┬──────┘                 │ editorAnalytics   { … }                   │
               │                        │ focusAnalytics    { flowBlocksMs:[Num] }  │
               │ createdBy (OID)        │ gitAnalytics      { … }                   │
               ▼                        └──────────────────────────────────────────┘
        ┌─────────────┐    groupId (OID)   ┌──────────────────┐
        │   groups    │◄───────────────────│  groupmembers    │
        ├─────────────┤                    ├──────────────────┤
        │ _id (OID)   │                    │ groupId (OID)    │
        │ name        │    userId (OID) ───│ userId  (OID)    │──► users._id
        │ visibility  │                    │ joinedAt         │
        │ password S  │   UNIQUE(groupId,userId)              │
        │ (scrypt$…)  │                    └──────────────────┘
        │ createdBy   │──► users._id
        └─────────────┘

        ┌─────────────┐   userId (OID) ──► users._id      ┌───────────────┐
        │   goals     │                                   │  notifications│
        ├─────────────┤                                   ├───────────────┤
        │ userId (OID)│◄──────── goalId (OID) ─────────────│ goalId (OID)  │
        │ targetHours │                                   │ userId (OID)  │
        │ techStack   │                                   │ type (enum)   │
        │ deadline    │                                   │ read          │
        │ status enum │  (no route ever sets 'completed') └───────────────┘
        │ reminderSent│
        └─────────────┘

        ┌─────────────┐
        │   teams     │   members : [ OID ]  (embedded array → users._id)
        ├─────────────┤   createdBy : OID
        │ (backend    │   ── frontend Teams.tsx is NOT routed ──
        │  only)      │
        └─────────────┘
```

- **`activities.userId` is a `String`** (the hex of `users._id`), while every other collection
  uses real `ObjectId` refs. This forces the `$regexMatch` + `$toObjectId` coercion in
  `leaderboard.js` and blocks `$lookup` joins (M-6).
- **`groupmembers`** is a proper join table with a **unique compound index** `{groupId,userId}`
  — the only hard concurrency guard in the system.
- **`teams.members`** is an **embedded array** — a deliberately different modelling choice from
  groups (and the reason `team.members.push()` has a lost-update risk).
- **Indexes** (all on `activities`): `{userId:1}`, `{userId:1,date:-1}`, `{userId:1,projectName:1}`,
  `{userId:1,language:1}`. **Missing:** `{userId:1,timestamp:-1}` — every analytics/metrics
  query filters `timestamp`, not `date`.

### Typical queries

| Feature | Query |
|---|---|
| Ingest | `Activity.create({...})` / `Activity.insertMany([...])` |
| Daily dashboard | `Activity.find({ userId, timestamp: { $gte: 7d } })` then JS reduce |
| Streak | `Activity.aggregate([{$match:{userId, timestamp:{$gte:90d}}},{$group:{_id: localDayString, seconds:{$sum:'$duration'}}},{$match:{seconds:{$gt:0}}}])` |
| Summary | `Activity.aggregate([{$match},{$group:{_id:dayString,totalHours:{$sum:{$divide:['$duration',3600]}}}}])` |
| Global leaderboard | `User.find({})` + `Activity.aggregate([{$addFields: coerce userId},{$group by user}])`, merged in Node |
| Group details | `GroupMember.find({groupId}).populate('userId')` + `Activity.aggregate([{$match:{userId:{$in: memberIds}}},{$group}])` |
| Metrics | 4 `Activity.aggregate` calls (totals, by-day, by-hour, by-language-for-goals) |
| Goal progress | `Activity.find({ userId, language: goal.techStack, timestamp: { $lte: goal.deadline } })` then reduce |

---

## 9. Sequence — "does a user's activity show up?"

```
extension flush ──► POST /api/extension/track ──► verifyApiKey ──► Activity.create ──► activities
                                                                                          │
dashboard open ──► GET /api/analytics/:id ──► isAuthenticated ──► ownership ──► Activity.find ──┘
              ◄── JSON ◄── JS aggregation ◄────────────────────────────────────────────────────
chart.js render
```

Failure points, in order (this is also the debugging runbook):
1. Extension not started / no API key / idle-paused / `duration < minFlushMinutes`.
2. Wrong `apiBase` (the 2.0.x localhost regression) or offline → payload lost (memory-only retry).
3. `verifyApiKey` 401 — key rotated / typo / trailing whitespace.
4. Ingest 400 — missing `fileName`/`language`/`duration` (or `duration === 0`).
5. Timezone: dashboard shows *today* in the browser's local day; a flush near midnight UTC vs local can land on the "wrong" day (weekly endpoint historically ignored the offset — M-2, fixed).
6. Dashboard hit the wrong user id, or session expired (401), or `credentials:'include'` missing (was a real bug — H-1 remediation).
7. Data is there but the panel is mock (Repeated Failures) or the metric needs 2.1.0 data (Insights focus cards).

---

## 10. Deployment topology

```
   ┌───────────────────────┐        ┌──────────────────────────┐        ┌────────────────────┐
   │ VS Code Marketplace    │        │ Vercel (static)          │        │ Render (Node)      │
   │ CodeTrackr-ext.        │        │ code-trackr-frontend     │        │ codetrackr-backend │
   │ codetrackr-vscode 2.2.0│        │ .vercel.app              │        │ -uckp.onrender.com │
   └───────────┬───────────┘        └───────────┬──────────────┘        └─────────┬──────────┘
               │ x-api-key                       │ JWT cookie                      │ Mongoose/TLS
               └───────────────────────────────► API ◄───────────────────────────┘
                                                 │
                                                 ▼
                                     ┌────────────────────────┐
                                     │ MongoDB Atlas cluster   │
                                     └────────────────────────┘
```

- `backend/vercel.json` shows a **serverless** deploy was also set up (`api/index.js` +
  `serverless-http`). If the backend actually runs serverless, `node-cron` in
  `notificationScheduler` is broken (H-13): each cold start re-runs the immediate sweep and
  the hourly schedule never fires because the process is frozen between requests.
- No Dockerfile, Procfile, or CI config in the repo. `frontend` build =
  `tsc -b && vite build` (currently red — 29 TS errors); `backend` start = `node app.js`;
  `extension` build = `tsc --noEmit && esbuild --minify`.

---

## 11. What is *not* in the architecture (and why an interviewer will ask)

| Absent | Why it's fine for now | When you'd add it |
|---|---|---|
| Message queue | ~1 write / user / minute; MongoDB absorbs it | ≥ 10⁴ concurrent users, or ingest spikes; decouple write path |
| Redis / cache | Leaderboard & insights recompute in < 1 s at current scale | Leaderboard scan too slow → cache the ranked list; insights → cache per (user, window) |
| WebSockets | Notifications poll every 30 s; good enough | Real-time collaborative/group features |
| API gateway | One service, one deploy | Multiple backend services, centralised auth/rate-limit |
| Search index | No text search | Group discovery over many groups |
| Analytics warehouse | Aggregations run fine on the OLTP store | Historical trend queries, cohort analysis, BI |
| Read model / CQRS | Reads recompute from the write model | `UserStats` rollup for the leaderboard is the first step |
