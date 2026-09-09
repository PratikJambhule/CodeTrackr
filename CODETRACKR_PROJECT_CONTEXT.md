# CODETRACKR — PROJECT CONTEXT (Durable Reference)

> **Purpose of this file.** A future AI assistant (or a new engineer) should be able to read
> this file and understand CodeTrackr *without re-deriving everything from the repository*.
> It records the **actual implementation** as of the `feat/security-and-insights` branch
> (analysis date: 2026‑09‑07), and clearly separates **what exists** from **what is
> recommended but not built**.
>
> When this file and the code disagree, the code wins — update this file.

---

## 1. What CodeTrackr is

CodeTrackr is a **developer-productivity analytics platform**. A VS Code extension passively
records coding activity and POSTs it to a Node/Express backend, which stores it in MongoDB.
A React dashboard visualises the data and adds social/gamification features (global
leaderboard, groups, goals) and a private **Insights** page of derived productivity metrics.

**Original motive (the "why").** It started as a way to keep **friendly competition** going in
the author's college friend group: create a **group** — for a contest week, or just daily
practice — and because everyone's editor is tracked automatically, the group page shows who
actually put in the hours and code. The extension also records **command / build / test
failures per person** (`terminalAnalytics`), so "who's hitting the most errors" is data the
app already collects; surfacing that in the group view (it currently ranks by hours + lines
added) is the natural next step, not yet built.

**One-line pitch:** "A coding-activity tracker built around friendly competition: install the
VS Code extension, join a group with your friends, and the app shows who coded the most, in
what languages, and how their build/command success rates compare — plus a global
leaderboard, goal tracking and a stats-based insights page. VS Code extension + React
dashboard + Express/MongoDB backend."

**Team:** Pratik Jambhule, Kartik Kharat, Soham Budhewar (per `extension/package.json`
`contributors` and repo git history — `Soham-Official/CodeTrackr` on GitHub). Do not invent
role splits beyond what git blame / commits show.

---

## 2. Repository layout

```
CodeTrackr-main/
├── backend/          Node 18 + Express 5 + Mongoose 8 REST API
│   ├── app.js                    Express app: CORS, json, cookieParser, passport, route mounts, mongoose.connect, app.listen
│   ├── api/index.js              Vercel serverless entry — wraps app.js with serverless-http
│   ├── config/passport.js        Google OAuth 2.0 strategy (passport-google-oauth20)
│   ├── middleware/auth.js        isAuthenticated (JWT cookie) + verifyApiKey (x-api-key header) + AUTH_BYPASS
│   ├── models/                   Activity, user, Goal, Group, GroupMember, Team, Notification
│   ├── routes/                   analytics, auth, extension, goals, groups, leaderboard, metrics, notifications, team, user
│   ├── services/                 authorization, passwordHash, activityNormalizers, metricsService, metricsDerive, notificationScheduler
│   ├── scripts/                  preview-insights.js, seed-demo-insights.js, cleanup-terminal-analytics.js
│   ├── tests/                    streak, ingest, metrics, authorization, routeGuards, passwordHash  (plain node:assert)
│   ├── tools/                    ~15 ad-hoc seed/cleanup scripts (dev only)
│   ├── server.js.old             Legacy monolith (unused, kept for reference — had helmet + rate-limit)
│   └── vercel.json               Serverless build config
├── frontend/         React 19 + Vite 7 + TS + Tailwind 3 SPA
│   └── src/
│       ├── App.tsx               Router + auth gate + nav shell
│       ├── config.ts             API_URL from VITE_API_URL
│       ├── contexts/ThemeContext.tsx   28 themes, localStorage, CSS vars
│       ├── pages/                Login, Onboarding, Dashboard, Insights, Leaderboard, Goals, Groups, Profile, Teams(orphaned)
│       └── components/           NotificationPanel, ThemeSelector, + decorative (Orb, Hyperspeed, LetterGlitch, TargetCursor, GradientText, TextType, ElectricBorder)
├── extension/        VS Code extension (TypeScript, esbuild bundle)
│   ├── src/extension.ts          Activation, flush timer, payload build, axios POST
│   ├── src/editorTracker.ts      Gross edits, churn, read/write attention split, file switches
│   ├── src/focusTracker.ts       Window focus time + "flow blocks"
│   ├── src/gitStateTracker.ts    Commits via built-in Git extension API
│   ├── src/terminalTracker.ts    Shell-execution events → command analytics
│   ├── src/analyticsAggregator.ts  Terminal counters aggregation
│   ├── src/commandClassifier.ts  Command category + sanitisation
│   ├── src/gitTracker.ts         detectGitAction() helper
│   ├── src/debugTracker.ts       Debug session counts (folded into terminalAnalytics)
│   ├── extension.js              Legacy v1 (excluded from .vsix via .vscodeignore)
│   ├── tests/                    trackers.test.js, activation.test.js (node:assert against dist bundle)
│   └── codetrackr-vscode-2.2.0.vsix   Packaged build
└── docs/
    ├── ARCHITECTURE.md           Pre-existing architecture notes (verify against code)
    ├── IMPROVEMENT_PLAN.md       13 High / 13 Medium / 7 Low findings, many marked FIXED
    ├── SESSION-LOG-2026-08-27.md Chronological engineering log
    ├── TRACKING_ROADMAP.md       Signals + derived-metrics design spec
    ├── diagrams-src/             figure-1 architecture .. figure-5 class diagram (HTML)
    └── interview-preparation/    ← generated 2026-09-07: Interview_Preparation.md, Interview_QA.md, Architecture.md, Interview_Cheat_Sheet.md, .pdf
```

There are **three** `package.json` files plus a **root** `package.json` that is just a
dependency dump (no name/scripts — flagged M‑7). Frontend and backend are **not** an npm
workspace; each is installed and deployed independently.

---

## 3. Tech stack (actual, from package.json)

| Layer | Stack |
|---|---|
| Extension | TypeScript 5, esbuild (CJS bundle, `--external:vscode`), `@vscode/vsce`, axios; `@types/vscode ^1.85` |
| Backend | Node 18, Express **5**, Mongoose **8**, jsonwebtoken, passport + passport-google-oauth20, cookie-parser, cors, dotenv, node-cron, serverless-http. **`helmet` + `express-rate-limit` wired 2026-09-09** on `/auth` + `/api/extension` (M‑3); `express-validator` still unused (M‑4). `three`/`postprocessing` in backend deps are spurious. |
| Database | MongoDB Atlas (connection via `MONGO_URI`) |
| Frontend | React **19**, Vite **7**, TypeScript ~5.9, Tailwind **3**, react-router-dom **7**, chart.js 4 + react-chartjs-2 + chartjs-plugin-datalabels, lucide-react, gsap, three/ogl/postprocessing (decorative visuals). **`@tanstack/react-query` is a dependency but unused.** |
| Auth | Google OAuth 2.0 → JWT in httpOnly cookie (web); random API key in `x-api-key` header (extension) |
| ML/Insights | **None.** Pure deterministic JavaScript statistics (`metricsDerive.js`). No Python, no trained model, no LLM. |
| Deploy | Backend: Render (`codetrackr-backend-uckp.onrender.com`, per extension default) — also has a Vercel serverless config. Frontend: Vercel (`code-trackr-frontend.vercel.app`). DB: MongoDB Atlas. |
| Testing | Plain `node:assert` scripts. 6 backend suites, 2 extension suites. No framework, no integration/e2e/DB tests, **zero frontend tests**. |

---

## 4. Architecture (client–server / modular monolith / REST / partial MVC)

```
 VS Code (extension)                        Browser (React SPA on Vercel)
        │  POST /api/extension/track               │  fetch(..., credentials:'include')
        │  header: x-api-key: <64-hex>             │  cookie: token=<JWT>
        ▼                                          ▼
 ┌───────────────────────────── Express API (Render / Vercel serverless) ─────────────────────────────┐
 │  app.js → CORS → express.json → cookieParser → passport.initialize → route routers                 │
 │  verifyApiKey  ─┐                         isAuthenticated ─┐                                        │
 │                 ▼                                          ▼                                        │
 │  routes/extension.js  → normalisers → Activity.create()    routes/analytics|leaderboard|metrics|... │
 │                                                            → Activity.find/.aggregate → JS reduce   │
 │  services/notificationScheduler.js  (node-cron, hourly)                                             │
 └───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                 ▼
                                        MongoDB Atlas
                              (activities, users, groups, groupmembers,
                               goals, teams, notifications)
```

- **Style:** client–server, RESTish, **modular monolith** (one Express process, feature routers).
  Partial **MVC**: models (Mongoose) + routes-as-controllers; a thin **service** layer exists only
  for `metrics`, `authorization`, `passwordHash`, `activityNormalizers`, `notificationScheduler`.
  Most routes talk to Mongoose directly.
- **No message queue, no Redis, no WebSockets.** Extension→backend is fire-and-forget HTTP.
  Frontend→backend is request/response; NotificationPanel **polls** every 30 s.

---

## 5. The unique-key / account-linking mechanism (CORE — expect deep interview questions)

**Generation.** On first Google login, `config/passport.js` creates the `User`, then calls
`user.generateApiKey()` → `crypto.randomBytes(32).toString('hex')` = **64 hex chars**. Stored
**in plaintext** on `User.apiKey` (`unique: true, sparse: true`).

**Delivery to the user.** Shown on the Onboarding page and the Profile page (fetched from
`GET /api/user/profile`, which returns `apiKey` in the JSON body).

**Delivery to the extension.** User runs `CodeTrackr: Setup API Key`, pastes it into an input
box; it is saved with `vscode.workspace.getConfiguration('codetrackr').update('apiKey', key,
ConfigurationTarget.Global)` → **plaintext in the user's global `settings.json`** (NOT VS Code
SecretStorage).

**Use.** Every flush: `axios.post('/api/extension/track', payload, { headers: { 'x-api-key': key }})`.

**Verification (backend).** `middleware/auth.js → verifyApiKey`: `User.findOne({ apiKey })`
(plaintext equality, backed by the unique index). Attaches `req.user`; ingest writes
`Activity.userId = req.user._id.toString()`.

**Rotation.** `POST /api/user/regenerate-api-key` overwrites `apiKey` with a fresh random value.
Old key stops working immediately; the extension must be re-configured (it surfaces the 401 as
a prompt).

**What the key actually IS:** a **bearer credential** — simultaneously identifier *and*
authenticator for the ingest API, with **no expiry, no scope, stored and compared in
plaintext, transmitted on every request**. It is functionally an unscoped, non-expiring API
token. This is the single biggest design-critique surface. See `docs/interview-preparation/`
for the full "identifier vs credential" discussion and the recommended redesign (hash at rest,
prefix + `keyId` lookup, rotation with grace window, per-device keys, short-lived signed
ingest tokens, or OAuth device flow).

---

## 6. Authentication (web) — actual

1. `GET /auth/google` → `passport.authenticate('google', { scope:['profile','email'], session:false })`.
2. `GET /auth/google/callback` → on success, sign a JWT `{ id, name, email, isFirstLogin }`
   with `process.env.JWT_SECRET` (**required at boot — M‑9 fixed 2026-09-09**),
   `expiresIn: '1d'`. Set cookie `token` (`httpOnly`; `secure`+`sameSite:'none'` in production,
   else `lax`). Redirect to `/onboarding` or `/dashboard` on the frontend.
3. Protected API routes: `isAuthenticated` reads `req.cookies.token`, `jwt.verify`,
   `User.findById(decoded.id)`, sets `req.user`.
4. Frontend `App.tsx` calls `GET /api/user/profile` on mount; 200 → render app, else → `/login`.
5. `POST /auth/logout` clears the cookie. **No refresh token; no server-side session store**
   (`passport.session()` is not used — `serializeUser`/`deserializeUser` are effectively dead).
6. `AUTH_BYPASS=true` (dev only, **refused when `NODE_ENV==='production'`** via
   `services/authorization.js → isBypassAllowed`) disables all auth and attaches the user with
   the most activity.

---

## 7. Database design (MongoDB / Mongoose)

### Collections

| Collection | Key fields | Notes |
|---|---|---|
| **activities** | `userId: String` (hex of User._id, **not** an ObjectId ref), `fileName`, `fileType`, `projectName`, `language`, `duration: Number` **(SECONDS)**, `linesAdded`, `linesRemoved`, `timestamp`, `bucketStart`, `files:[String]`, `flushCount`, `terminalAnalytics{}`, `editorAnalytics{}`, `focusAnalytics{ flowBlocksMs:[Number] }`, `gitAnalytics{}` | **Since 2026‑09‑08:** one doc per **10‑minute `(userId, projectName, language)` window** — the ingest route `$inc`‑upserts the bucket (`services/activityBucket.js`); analytics sub‑docs are **sparse** (no `default:0`; only non‑zero leaves written). `ACTIVITY_BUCKET_MS=0` restores per‑flush inserts. Legacy per‑flush docs coexist. The dead `date` field was **removed**. Highest volume. `{ timestamps:true }`. |
| **dailysummaries** | `userId`, `day` (YYYY‑MM‑DD UTC), `totalSeconds`, `totalLinesAdded/Removed`, `flushCount`, `bucketCount`, `languages:[{language,seconds}]`, `projects:[String]`, `editor/terminal/git` aggregates, `focus{}` | One per (user, UTC day). Written nightly by `scripts/rollup-daily.js` / the `initScheduler` cron from raw `activities`. Exists for the future all‑time‑read cutover (not yet consumed by any read). |
| **users** | `googleId` (unique), `name`, `email` (unique), `profilePictureUrl`, `apiKey` (unique, sparse, **plaintext**), `lastLogin`, `isFirstLogin` | |
| **groups** | `name`, `description`, `visibility: 'public'|'private'`, `password` (`select:false`, scrypt hash `scrypt$salt$hash`, legacy plaintext tolerated), `createdBy: ObjectId→User` | |
| **groupmembers** | `groupId: ObjectId`, `userId: ObjectId`, `joinedAt` | Unique compound index `{groupId:1, userId:1}`. Join table. |
| **goals** | `userId: ObjectId→User`, `title`, `description`, `targetHours` (min 1), `techStack: String`, `deadline`, `status: 'in-progress'|'completed'` (default in‑progress), `reminderSent` | **No route sets `status` to `completed`** — only the seed script / manual edits do. |
| **teams** | `name`, `description`, `createdBy: ObjectId`, `members: [ObjectId]` (embedded) | Backend routes exist; **frontend `Teams.tsx` is not routed in `App.tsx`** — orphaned. |
| **notifications** | `userId: ObjectId`, `goalId: ObjectId`, `type: 'deadline_reminder'|'deadline_missed'|'goal_completed'`, `title`, `message`, `read` | Created by `notificationScheduler`. |

### Indexes (defined in `models/Activity.js`, as of 2026‑09‑08)

`{ userId:1 }` (field-level), `{ userId:1, timestamp:-1 }`, `{ userId:1, projectName:1 }`,
`{ userId:1, language:1 }`, `{ userId:1, projectName:1, language:1, bucketStart:1 }`
(**unique**, `partialFilterExpression: { bucketStart: { $exists: true } }` — race-safe bucket
merge, ignores legacy per‑flush docs), `{ createdAt:1 }` TTL **400 days** (safety net;
tightening it + repointing all‑time reads at `dailysummaries` is the follow-up).
The old `{ userId:1, date:-1 }` index and the `date` field were **removed** —
`scripts/migrate-drop-date.js --apply` does it on the live DB.

### Consistency / concurrency

- No transactions anywhere. Bucket ingest is an atomic `findOneAndUpdate` with `$inc`
  (race-safe); `ACTIVITY_BUCKET_MS=0` falls back to a single `Activity.create`.
- `groupmembers` unique compound index is a hard concurrency guard (double-join → duplicate-key error, surfaced as a 409 as of 2026-09-09). The new partial-unique `activities` bucket index is another.
- `Team.members.push` + `save()` is read-modify-write — lost-update possible under concurrent adds.
- `leaderboard` / group leaderboard recompute from scratch per request — always consistent, never cached.

### Why MongoDB (defensible answer)

Activity documents are **append-only, self-contained, schema-evolving** (three analytics
sub-documents were added additively without a migration — Mongoose ignores unknown fields on
read, defaults missing ones to 0). Access pattern is "all of one user's docs in a time
window, then aggregate". No cross-entity joins on the hot path. A document store fits.
**Where SQL would be better:** the relational parts — `groupmembers`, `teams.members`, goal
ownership — where referential integrity and transactions matter; the leaderboard, which is a
`GROUP BY user_id` that a SQL engine with a covering index does far better than "load
everything into Node".

---

## 8. API surface (actual)

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/extension/track` | `verifyApiKey` | **Main ingest.** `$inc`-upserts a 10‑minute `(user, project, language)` bucket (201 `{bucket:{…}}`); 202 `{merged}` for a signal‑less flush; plain `Activity.create` when `ACTIVITY_BUCKET_MS=0`. |
| POST | `/api/extension/track/batch` | `verifyApiKey` | Loops the same bucketing path per item. **Exists; the extension never calls it.** |
| GET | `/api/extension/verify` | `verifyApiKey` | Key validity check for setup. |
| GET | `/api/analytics/:userId` | `isAuthenticated` + ownership | Today's hourly breakdown; also pulls last 7 days. Aggregates in JS. |
| GET | `/api/analytics/weekly/:userId` | `isAuthenticated` + ownership | 7-day daily breakdown. |
| GET | `/api/analytics/timeslot/:userId` | `isAuthenticated` + ownership | 2-hour drill-down, 10-minute slots. |
| GET | `/api/analytics/summary/:userId` | `isAuthenticated` + ownership | `$group` daily + per-language totals. |
| GET | `/api/leaderboard` | `isAuthenticated` | Global. Aggregates the **entire** activities collection + **all** users, merges/sorts/scores in Node. No window, no pagination, no cache. Returns every user's name + email. |
| GET | `/api/metrics?days=&timezone=` | `isAuthenticated` | Derived Insights metrics. **Session identity only — no `:userId` param** (deliberate, closes the IDOR class). |
| POST | `/api/groups/create` | `isAuthenticated` | Creator auto-added as member; private → scrypt-hash password. |
| GET | `/api/groups/my-groups` \| `/discover` | `isAuthenticated` | Membership-scoped / inverse. |
| GET | `/api/groups/:groupId/details` | `isAuthenticated` + **membership check** | Members list + group leaderboard (all-time, no pagination). |
| POST | `/api/groups/:groupId/join` \| `/leave` | `isAuthenticated` | Password check for private; last member leaving deletes the group. |
| POST | `/api/goals/create` · GET `/api/goals` · GET `/api/goals/:goalId/progress` | `isAuthenticated` (+ owner scope on progress) | Progress = Σ activity seconds where `language === goal.techStack` and `timestamp <= deadline`, ÷ 3600 ÷ targetHours. **No update/complete/delete route.** |
| GET/PATCH/DELETE | `/api/notifications/*` | `isAuthenticated` | All correctly scoped by `req.user._id`. |
| POST | `/api/teams/create` · GET `/api/teams` · GET `/api/teams/:teamId` · POST `/api/teams/:teamId/members` | `isAuthenticated` (+ membership / admin checks) | Backend only; no UI route. |
| GET | `/auth/google` · `/auth/google/callback` · `/auth/current-user` · POST `/auth/logout` | — | OAuth + JWT cookie. |

Legacy unauthenticated `POST /api/user-activity` / `GET /api/user-stats/:id` were **deleted**
(H‑2); they still exist in `server.js.old` for reference only.

---

## 9. VS Code extension — how it works

*Current published-target version: **2.3.0** (packaged; Marketplace publish is manual).*

- **Activation:** `onStartupFinished`. `activate()` creates the five trackers, registers 7
  commands, then calls `start()`.
- **Loop:** `setInterval(flushIntervalSeconds * 1000)` (default **30 s**). Each tick:
  if idle ≥ 2 min → flush remaining active time, then pause (resumes on next edit/nav);
  else `flushIfNeeded(false)` — if buffered minutes ≥ `minFlushMinutes` (**default 2** since
  2.3.0, was 0.5), build the payload and, **only if it carries real signal**
  (`payloadHasSignal` — mirrors the backend), POST. A signal-less flush is held so the
  buffered time carries to the next real flush.
- **Active-time model:** buffers `(now - startedMs)` minutes of *active* time; edits/saves/
  editor-switches/opens call `markActivity()` which refreshes `lastActivityMs`. Idle < 2 min
  no longer contributes a document (2.3.0 skip-empty), which also trims the old L‑7 skew.
- **Payload (merged server-side into a 10-min bucket):** `timestamp` (stamped at the **start** of the interval, not
  upload time — H‑12 fix), `fileName` (basename only), `fileType`, `projectName`
  (`workspace.name`), `language` (`activeTextEditor.document.languageId`), `duration`
  (seconds), `linesAdded/Removed` (from gross editor counters), and
  `terminalAnalytics` / `editorAnalytics` / `focusAnalytics` / `gitAnalytics` sub-objects.
  **Never** transmits file contents, diffs, commit messages, or absolute paths. Command
  strings are sanitised (`token=…` → `token=***`) and truncated.
- **Trackers** each expose `consumeInterval()` = snapshot + reset:
  - `EditorTracker` — chars/lines inserted/deleted, **churn** (lines written then deleted
    within 10 min), undo/redo, saves, file switches, unique files, read-vs-write attention
    split (5 s sampler), large-insert flags.
  - `FocusTracker` — `focusedMs`/`blurredMs` via `onDidChangeWindowState`; **flow blocks**
    (a block closes after 2 min idle; `flowBlocksMs[]` array).
  - `GitStateTracker` — reads the built-in `vscode.git` extension API; increments `commits`
    when `HEAD.commit` changes; tracks uncommitted file count + age.
  - `TerminalTracker` + `analyticsAggregator` + `commandClassifier` — uses
    `onDidStart/EndTerminalShellExecution`; classifies command category, build/test/debug,
    git action; success/failure by exit code; repeated-failure detection.
  - `DebugTracker` — debug session count, folded into `terminalAnalytics.debuggingSessions`.
- **Failure handling:** `axios` timeout 15 s. On error, buffered minutes are **retained in
  memory** and carried to the next flush; **there is no disk queue** — a VS Code restart loses
  un-flushed time (a best-effort final flush runs on `deactivate()`). 401 → one-time
  actionable prompt ("Set API Key" / "Open Dashboard").
- **Config keys:** `codetrackr.apiBase` (default `https://codetrackr-backend-uckp.onrender.com`),
  `codetrackr.apiKey`, `codetrackr.flushIntervalSeconds`, `codetrackr.minFlushMinutes`,
  `codetrackr.debug`.
- **Build/publish:** esbuild bundle → `dist/extension.js`; `vsce package`. Publisher
  `CodeTrackr-ext`. Versioning saga: a `2.1.0` was uploaded in May 2025 *before* `2.0.x`, and
  the Marketplace serves the highest version *number*, so the `2.0.11` fixes never reached
  users. `2.2.0` (2026‑08‑28) supersedes it. `codetrackr-vscode-2.2.0.vsix` is in the repo;
  actual Marketplace publication of 2.2.0 is **not confirmed by anything in the repo** (session
  log notes a publish was blocked on an expired Azure DevOps PAT).

---

## 10. Insights / "ML" — WHAT IT ACTUALLY IS

**It is not machine learning.** No model, no training, no inference, no Python, no LLM, no
external AI API. `GET /api/metrics` → `services/metricsService.buildMetrics()` runs a handful
of MongoDB `$group` aggregations, then `services/metricsDerive.js` (pure, unit-tested,
dependency-free functions) computes:

| Metric | Definition (as coded) |
|---|---|
| `deepWorkRatio` | Σ(flow blocks ≥ 25 min) ÷ total focused ms. 0–1. |
| `flowBlocks` | median / longest / count / deep-block count of `flowBlocksMs`. |
| `consistencyIndex` | `1 − coefficient_of_variation` of daily minutes, clamped to [0,1]. |
| `truePeakWindow` | hour maximising `commits*10 + linesInserted/10 − churnLines/5` (most *productive* hour, not busiest). |
| `estimationCalibration` | mean(actual ÷ estimated hours) across **completed** goals (needs ≥ 2). |
| `churnRatio` | churnLines ÷ linesInserted. |
| `comprehensionLoad` | readMs ÷ (readMs + writeMs). |
| `contextSwitchesPerHour` | fileSwitches ÷ focused hours. |

- **Runs:** synchronously, per request, **no caching**, recomputed every page load.
- **Insufficient data:** focus/flow metrics show "—" until extension ≥ 2.1.0 data exists
  (`flowBlocks.blockCount === 0`); `estimationCalibration` returns `null` below 2 completed goals.
- **Privacy:** these metrics are per-user only and never appear on the leaderboard.
- **An LLM layer was *designed* (Gemini chosen) but never built** — see
  `docs/TRACKING_ROADMAP.md` Part 5. `AI_INSIGHTS_DESIGN.md` is referenced but absent.
- **Honest interview line:** "The Insights page is deterministic descriptive statistics —
  coefficient of variation, weighted scoring, medians — not ML. I scoped it that way
  deliberately so every number is explainable and reproducible; an LLM 'narration' layer on
  top is designed but not implemented."

---

## 11. Leaderboard — how ranking works

`GET /api/leaderboard`:
1. `User.find({})` — **all** users.
2. `Activity.aggregate` over the **entire** collection: `$group` by userId (with
   `$regexMatch`/`$toObjectId` to coerce the String `userId`), summing duration / lines,
   `$addToSet` project names, counting docs.
3. Merge in Node, sort by `totalHours` desc, assign `rank = index + 1` (ties → array order).
4. Scores `speed/quality/engagement/impact/overall/commitScore` are computed **relative to the
   current maximum** — so every user's score shifts whenever the top user codes more.
   `commits` on the leaderboard is actually **`$sum $ifNull($flushCount, 1)`** (flush count,
   not git commits — since 2026‑09‑08; was raw doc count).

**Cost:** O(total activity documents + total users) per request, in application memory, no
time window, no pagination, no cache. Fine for a class project; the first thing that breaks at
scale. Group leaderboard (`/api/groups/:id/details`) is the same pattern scoped to member IDs.

---

## 12. Frontend notes

- **Routing:** `react-router-dom` v7. `App.tsx` gates on `GET /api/user/profile`; unauthenticated
  users only see `/login`. Routes: `/dashboard`, `/insights`, `/leaderboard`, `/goals`,
  `/groups`, `/profile`, `/onboarding`. **No `/teams` route** (Teams.tsx is dead code).
- **State:** local `useState` + prop-drilling (`user` passed to Dashboard/Groups). **No Redux/
  Zustand/Context for data.** `ThemeContext` is the only context. `@tanstack/react-query` is
  installed but unused — every navigation refetches with `cache:'no-cache'`.
- **Auth to API:** every `fetch` uses `credentials:'include'` to send the JWT cookie.
- **Charts:** chart.js + react-chartjs-2 (Line/Pie/Bar) in Dashboard; Insights is plain cards.
- **Known frontend issues:**
  - `Dashboard.tsx` "Repeated Failures" panel — ✅ **wired to the real `terminalSummary.repeatedFailedCommands` (2026-09-09)**; was hardcoded mock arrays.
  - `Goals.tsx` to-do items are **client-state only** — never persisted; no goal
    complete/delete/progress UI; the `/:goalId/progress` endpoint is never called.
  - `npm run build` — ✅ **green as of 2026-09-09** (was 29 `tsc -b` errors, M-13). CI (`.github/workflows/ci.yml`) keeps it green.
    (M‑13; mostly unused imports, 2 real `string not assignable to never`).
  - `NotificationPanel` polling `useEffect` closes over a stale `isOpen` (L‑1).
- **Themes:** 28 palettes in `ThemeContext.tsx`, persisted to `localStorage.selectedTheme`,
  applied as CSS custom properties + inline styles.

---

## 13. Error handling & reliability (actual)

- Every route is a `try/catch` that returns `res.status(500).json({ message, error: error.message })`
  — ✅ **fixed 2026-09-09 (M‑10)**: a central `(err,req,res,next)` handler logs the full error with a correlation id and returns `{error, id}`; routes `next(err)`.
- Mongo connection: `mongoose.connect(...).catch(err => console.error(...))` — the process
  **keeps running without a DB**; requests then fail per-query.
- Ingest validation: only `if (!fileName || !language || !duration)` → 400. `!duration`
  wrongly rejects a legitimate `0`; negatives / `1e12` / `NaN`→coerced are accepted (M‑4).
- Extension offline: retained in memory, no disk queue, lost on restart.
- ML/metrics failure: caught → `500 { success:false }`; the Insights page shows "Could not
  load your insights" + Try again.
- ~40 `console.log` on hot paths including per-request user IDs (L‑3).

---

## 14. Security posture — quick reference

**Fixed (branch `feat/security-and-insights`):** analytics/leaderboard now require auth +
ownership (H‑1); legacy open write/read endpoints deleted (H‑2); group passwords scrypt-hashed
(H‑9); `AUTH_BYPASS` refused in production (H‑10); IDORs on goals/teams closed (H‑11);
`/api/metrics` takes no `:userId` (IDOR-proof by construction).

**Still open / by design:**
- API key: **plaintext at rest and in transit**, no expiry, no scope, full ingest authority.
  Stealing it lets an attacker forge unlimited activity for that user (leaderboard fraud) —
  but not read the victim's dashboard (that needs the JWT).
- `JWT_SECRET` was a hardcoded fallback — now required at boot (M‑9, ✅ fixed 2026-09-09).
- `helmet` + rate limits on `/auth` and `/api/extension` added 2026-09-09 (M‑3 ✅). Group `/join` brute-force still unlimited.
- No request validation / schema enforcement (M‑4); fake activity is trivial to inject with a valid key.
- Error responses echo `error.message` (M‑10).
- Leaderboard exposes **every user's email**.
- Extension stores the key in `settings.json`, not SecretStorage.
- Ingest is still not idempotent, but a re-sent flush now `$inc`s the same bucket rather than
  creating a second document — a same-window replay double-counts within one bucket, not a new row.
- Client can send arbitrary `timestamp` on ingest (used, only sanity-checked for parseability).

---

## 15. Deployment & environment

**Backend env vars** (`backend/.env.example`): `MONGO_URI` (required), `JWT_SECRET` (required —
is now required at boot — fixed 2026-09-09), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL`
(required — `config/passport.js` **throws at import** if missing), `FRONTEND_URL` (CORS +
redirects), `PORT` (default 5050), `NODE_ENV`, `AUTH_BYPASS` (dev only).

**Frontend env:** `VITE_API_URL` (falls back to `http://localhost:5050`). `frontend/vercel.json`
is an SPA rewrite (`/(.*)` → `/index.html`).

**Backend deploy:** the extension's default `apiBase` points at **Render**
(`codetrackr-backend-uckp.onrender.com`); `backend/vercel.json` also exists (serverless via
`api/index.js` + `serverless-http`). If deployed serverless, `node-cron` in
`notificationScheduler` **does not work** (cold starts re-run the immediate sweep; the hourly
cron never fires) — H‑13, unfixed. `app.js` calls `app.listen()` unconditionally.

**DB:** MongoDB Atlas (TLS, `family:4`, 15 s server-selection timeout).

**CI/CD:** none in the repo. No GitHub Actions, no Dockerfile, no Procfile.

---

## 16. Testing (actual)

| Suite | File | Style | Covers |
|---|---|---|---|
| streak | `backend/tests/streak.test.js` | extracts helpers from shipped `analytics.js`, runs vs stubbed `Activity.aggregate` | `computeStreak`, `localDayInfo` (timezone) — 9+ assertions incl. regression cases |
| ingest | `backend/tests/ingest.test.js` | unit | `activityNormalizers` — defaults, coercion, negative rejection, `flowBlocksMs` cap |
| metrics | `backend/tests/metrics.test.js` | unit | all 5 `metricsDerive` pure functions |
| authorization | `backend/tests/authorization.test.js` | unit | `sameUser`, `assertOwnership`, `isBypassAllowed` |
| routeGuards | `backend/tests/routeGuards.test.js` | **static source scan** | fails if a sensitive route loses its auth middleware (H‑1 regression guard) |
| passwordHash | `backend/tests/passwordHash.test.js` | unit | scrypt round-trip, salting, legacy plaintext, null-safety |
| trackers | `extension/tests/trackers.test.js` | unit vs built `dist/extension.js` + `vscodeStub` | EditorTracker / FocusTracker / GitStateTracker behaviour + regressions |
| activation | `extension/tests/activation.test.js` | loads the real bundle vs stub | every contributed command is registered; no network without a key; payload shape; manifest sanity |

Plus, since 2026‑09‑08: `activityBucket` (21 — bucket math, `hasSignal`, update shape,
sparseness, `planActivityWrite`), `activityModel` (10 — schema/index shape), `ingestWiring`
(9 — source scan that `/track` uses the planner + reads tolerate bucketed docs), `rollup`
(7 — `buildDaySummary`). Extension `activation` gained `payloadHasSignal` + manifest checks.

**Total ≈ 104 backend assertions across 10 suites + 37 extension.** No test framework, **no
integration/API/DB/e2e tests, no frontend tests.** Nothing has been run against a real
database — the bucketing/rollup logic is proven at the pure-function level only.

---

## 17. Known limitations (short list — full treatment in interview docs)

1. API key = plaintext, non-expiring, unscoped bearer credential.
2. Leaderboard / group leaderboard: unbounded full-collection scan, no cache, no pagination; exposes emails.
3. Analytics aggregate in JS, not MongoDB; daily endpoint pulls 7 days to show 1 (M‑1).
4. `node-cron` scheduler incompatible with serverless (H‑13) — now also runs the nightly rollup.
5. `helmet` + rate limits on `/auth` + `/api/extension` added 2026-09-09 (M‑3); ingest bounds-checked 2026-09-09 (M‑4). Group `/join` still unlimited.
6. ~~Frontend does not typecheck~~ ✅ fixed 2026-09-09 (M‑13) — `npm run build` green, enforced by CI.
7. Dashboard "Repeated Failures" now shows real data (2026-09-09); Goals to-dos are non-persistent; Teams UI is orphaned.
8. `userId` is String on `activities`, ObjectId elsewhere → coercion gymnastics, blocks `$lookup` (M‑6).
9. Extension has no offline queue; un-flushed time is lost on restart.
10. Ingest not idempotent — a same-window replay double-counts inside one bucket.
11. Insights recomputed every request, no cache.
12. GitHub Actions CI added 2026-09-09 (backend+extension tests, frontend build); still no CD, no observability, no integration tests.
13. **DB write-reduction (2026‑09‑08):** time-of-day precision is now the 10-minute grid;
    all-time reads (`/leaderboard`, `/summary`, `/metrics >90d`) still scan raw `activities`
    — not yet repointed at `dailysummaries`; the 400-day TTL is a safety net only.

*(Fixed 2026‑09‑08: the missing `{userId:1,timestamp:-1}` index; per-flush document
explosion; the dead `date` field/index; idle < 2 min inflating totals.)*

---

## 18. Recommended improvements (NOT built — keep separate from the above)

**Short term:** hash API keys at rest (`keyId` + secret, prefix); add `helmet` +
`express-rate-limit` on `/auth` and `/api/extension`; add `express-validator` bounds on
ingest (`0 < duration ≤ 3600`); central error middleware; wire the real
`repeatedFailedCommands` into the dashboard; move the scheduler to Vercel Cron / an external
trigger. *(Done 2026‑09‑08: `{userId:1,timestamp:-1}` index; 10-min bucketing; drop `date`.)*

**Medium term:** `UserStats` rollup collection updated on ingest → leaderboard reads N docs
for N users; **repoint `/leaderboard`, `/summary`, `/metrics >90d` at `dailysummaries` and
tighten the raw TTL from 400d** (the explicit follow-up to the write-reduction batch); add
`?period=` window + pagination; shared MongoDB aggregation service for analytics + metrics;
adopt React Query for caching/dedup; migrate `activities.userId` to ObjectId with a compat
window; extension offline queue (persist to `globalState`), idempotency key on ingest.

**Long term:** ingest → queue (SQS/Kafka) → workers → time-series store / analytics warehouse;
Redis cache for leaderboard + insights; the designed LLM narration layer with a
numbers-must-be-grounded validator; anti-cheat / anomaly detection on ingest; per-device keys
+ short-lived signed ingest tokens or OAuth device flow; observability (structured logs,
metrics, tracing); CI (typecheck + both test suites) + automated Marketplace publish.

---

## 19. Current implementation status (as of analysis)

- Branch: `feat/security-and-insights`. Security Batch 3 + Insights page **done**.
  Data-accuracy Batch 1 + extension Batch 2 (2.0.11 / 2.2.0) **done**.
- **DB write-reduction batch (2026‑09‑08) done:** 10-minute bucket-on-write (`$inc` upsert),
  skip signal-less flushes (extension 2.3.0), sparse analytics sub-docs, dropped the `date`
  field/index, added `{userId:1,timestamp:-1}`, `DailySummary` + nightly rollup + 400d TTL.
  Spec `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md`, plan
  `docs/superpowers/plans/2026-09-08-db-write-reduction.md`. `ACTIVITY_BUCKET_MS=0` = legacy.
  **Follow-up open:** repoint all-time reads at `dailysummaries` + tighten the TTL (with `UserStats`).
- `H-7`, `H-8` (leaderboard scans), `H-13` (serverless cron), most `MEDIUM`/`LOW` items **open**.
- Extension packaged as `2.3.0`; Marketplace publication is manual / unverified.
- Frontend build is ✅ green (`tsc -b && vite build`) as of 2026-09-09; CI runs it on every push.
- No work has touched a live database. **Migrations to run on deploy:**
  `node backend/scripts/migrate-drop-date.js --apply` then optionally
  `node backend/scripts/rollup-daily.js --apply`.

---

## 20. Pointers

- Full interview prep: `docs/interview-preparation/CodeTrackr_Interview_Preparation.md` (+ `.pdf`)
- Q&A bank: `docs/interview-preparation/CodeTrackr_Interview_QA.md`
- Architecture deep-dive + diagrams: `docs/interview-preparation/CodeTrackr_Architecture.md`
- Quick revision: `docs/interview-preparation/CodeTrackr_Interview_Cheat_Sheet.md`
- DB write-reduction: `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md`,
  spec `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md`,
  plan `docs/superpowers/plans/2026-09-08-db-write-reduction.md`
- Pre-existing engineering docs: `docs/ARCHITECTURE.md`, `docs/IMPROVEMENT_PLAN.md`,
  `docs/SESSION-LOG-2026-08-27.md`, `docs/TRACKING_ROADMAP.md`
