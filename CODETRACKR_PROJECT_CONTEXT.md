# CODETRACKR — PROJECT CONTEXT (Durable Reference)

> **Purpose of this file.** A future AI assistant (or a new engineer) should be able to read
> this file and understand CodeTrackr *without re-deriving everything from the repository*.
> It records the **actual implementation** on `main` (the `feat/security-and-insights` work was
> merged into `main` by force-push on 2026-09-12; first analysed 2026-09-07; live systems last checked
> 2026-09-16; code re-audited 2026-10-03 at `92b899b`), and clearly separates **what exists** from **what is
> recommended but not built**.
>
> When this file and the code disagree, the code wins — update this file.

---

## 0. October 2026 roadmap — read this first

Between 2026-10-03 and now, the 18-item plan in `docs/ROADMAP_2026-10.md` was built and tested
and **deployed on 2026-10-03** (commit `11040c5`; Google login verified live). Still pending: live
data migrations (`docs/RELEASE.md` §3). Extension 2.5.0 is live on the Marketplace since 2026-10-04 (§4). Where a section below still describes the
earlier design, this list wins; the dated detail is in `docs/PROGRESS.md`.

- Integration tests (`npm run test:int`, in-memory MongoDB) — 39 tests; unit 27 suites / 375;
  extension 6 suites / 70; frontend 51 (Vitest).
- **Website redesign (2026-10-04, built and tested, NOT deployed):** "the weekly race". Landing,
  guide, privacy, invite links (`/join/:id`), group board as its own route (standings tower with day
  cells, race chart, contest dates in the URL), dashboard rebuilt from small SVG chart components,
  two themes as CSS variables, every page lazy-loaded (landing first visit 748 → 359 kB). New API:
  `/api/analytics/history/:userId`, group `daily` cells, `/api/groups/:id/preview`. Spec
  `docs/specs/2026-10-04-frontend-redesign.md`; decisions D-31..D-36; found + fixed M-34 (goals
  saved a day early in India); found M-35 and L-14 (open).
- API keys hashed (`ct_<id>_<secret>`, SHA-256), shown once; per-device keys via **device-code
  sign-in**; extension keeps keys in SecretStorage.
- Idempotent ingest (`flushId`), anti-cheat crediting (focus corroboration, 600 s per user per
  10-minute window, per-key quota), persisted extension outbox (extension 2.5.0, live since 2026-10-04).
- Leaderboard and group boards read `userstats` running totals (1M rows: 6.72 s → 62 ms p50);
  contest-week group boards (`?from=&to=`); group admin (rename, remove, ownership hand-off).
- Dashboard daily/weekly views aggregate in MongoDB (`$facet`); `activities.userId` → ObjectId in
  an expand/contract migration; React Query; Teams deleted.
- Login fix for Safari/Firefox (H-19) live: Vercel forwards `/api` + `/auth` to Render; Google's
  callback is `https://code-trackr-frontend.vercel.app/auth/google/callback`; H-20 fixed (rate
  limits per user/session). Open: M-33 (failed sign-in shows raw JSON).
- Fixed: H-7, H-8, H-21, H-22, H-23 (browsers blocked every PATCH), M-1, M-11, M-25–M-32, L-3,
  L-11, L-12. Ops: JSON logs + request ids, optional Sentry, Dockerfile, `docker-compose.yml` (local
  MongoDB + API + website, verified), deploy-on-green workflow.

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
app already collects, and since 2026-09-10 (M-21) the group leaderboard shows it: commits, failed
commands and failed builds per member, with failure rates.

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
│   ├── models/                   Activity, DailySummary, UserInsights, user, Goal, Group, GroupMember, Team, Notification
│   ├── routes/                   analytics, auth, extension, goals, groups, internal, leaderboard, metrics, notifications, team, user
│   ├── services/                 authorization, passwordHash, textQuery, activityNormalizers, activityBucket, ingestValidation, metricsService, metricsDerive, sessionize, insightsBaseline, rulesEngine, dailySummary, dailyRollup, notificationScheduler
│   ├── scripts/                  migrate-drop-date + rollup-daily (deploy-time, --apply); probe-activity-shape + measure-insights (read-only probes); preview-insights, seed-demo-insights, cleanup-terminal-analytics
│   ├── tests/                    18 plain node:assert suites / 296 assertions — streak, ingest, metrics, authorization, routeGuards, passwordHash, activityBucket, activityModel, ingestWiring, rollup, quickWins, ingestValidation, metricsService, sessionize, insightsBaseline, textQuery, leaderboardScore, rulesEngine
│   ├── tools/                    ~15 ad-hoc seed/cleanup scripts (dev only)
│   ├── server.js.old             Legacy monolith (unused, kept for reference — had helmet + rate-limit)
│   └── vercel.json               Serverless build config
├── frontend/         React 19 + Vite 7 + TS + Tailwind 3 SPA
│   └── src/
│       ├── App.tsx               Routes; public pages render at once, app pages wait for /api/user/profile; all lazy-loaded
│       ├── config.ts             API_URL: '' in production (same site, Vercel proxy); VITE_API_URL in dev
│       ├── api.ts, hooks/        apiGet/apiSend + errorText; typed React Query hooks for every read
│       ├── theme.tsx, index.css  design tokens as CSS variables; dark (default) / light / system
│       ├── lib/                  pure, unit-tested: format (local dates), standings, calendar, storage
│       ├── components/ui|charts|layout   UI kit; SVG/HTML charts (StandingsTower, RaceChart, Bars, YearHeatmap, ...); AppShell, PublicLayout
│       └── pages/                public/ (Landing, Guide, Privacy, Login, NotFound), Dashboard (+ dashboard/), Groups, GroupBoard, JoinGroup, Leaderboard, Goals, Insights, Profile, Onboarding, Device
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
│   ├── tests/                    trackers, activation, flushSafety (node:assert against dist bundle) — 3 suites / 52 assertions
│   └── *.vsix                    Gitignored — no package is committed. 2.4.0 is the published Marketplace version (2026-09-10)
└── docs/
    ├── ARCHITECTURE.md           Current architecture + data flow (rewritten 2026-10-03)
    ├── DECISIONS.md              One entry per design decision: what, why, alternatives, trade-offs
    ├── PROGRESS.md               Dated build/test/bug log
    ├── INTERVIEW_PREP.md         Short interview Q&A + index into interview-preparation/
    ├── IMPROVEMENT_PLAN.md       finding register H-1…H-22 / M-1…M-30 / L-1…L-11, each marked ✅ FIXED or open
    ├── AUDIT-2026-09-10.md       production-readiness audit: data-flow trace, raw-value meanings, bugs B1–B12, live-DB checks
    ├── INSIGHTS_METRICS.md       definition of record for every Insights formula (before/after + why)
    ├── RULES_ENGINE.md           threshold-rules layer over the metrics ("What stands out")
    ├── ML_INTEGRATION_PLAN.md    work-type model → personas → group titles (+ .pdf) — redesigned 2026-09-17, NOT built
    ├── ML_INTEGRATION_CHANGES.md file-by-file project changes the ML plan needs (leaderboard, groups, Insights, backend)
    ├── ML_INTEGRATION_GUIDE.md   the ML plan and its changes explained simply, with worked examples (+ .pdf)
    ├── SESSION-LOG-2026-08-27.md Chronological engineering log
    ├── TRACKING_ROADMAP.md       Signals + derived-metrics design spec
    ├── diagrams-src/             figure-1 architecture .. figure-7 ML label loop (HTML; PNGs in docs/images/)
    └── interview-preparation/    ← Interview_Preparation (+pdf), Interview_Guide_Condensed (+pdf), Interview_QA, Architecture, Interview_Cheat_Sheet, Quick_Wins, DB_Write_Reduction, Resume_Entry.tex
```

There are **three** `package.json` files plus a **root** `package.json` that is just a
dependency dump (no name/scripts — flagged M‑7). Frontend and backend are **not** an npm
workspace; each is installed and deployed independently.

---

## 3. Tech stack (actual, from package.json)

| Layer | Stack |
|---|---|
| Extension | TypeScript 5, esbuild (CJS bundle, `--external:vscode`), `@vscode/vsce`, axios; `@types/vscode ^1.85` |
| Backend | Node 18, Express **5**, Mongoose **8**, jsonwebtoken, passport + passport-google-oauth20, cookie-parser, cors, dotenv, node-cron, serverless-http. **`helmet` + `express-rate-limit` wired 2026-09-09** on `/auth` + `/api/extension` (M‑3), extended 2026-09-12 to `/api/analytics` and group `/join` (M-24). Ingest is bounds-checked by a pure `services/ingestValidation.js` (M‑4, 2026-09-09); `express-validator` remains installed-but-unused. `three`/`postprocessing` in backend deps are spurious. |
| Database | MongoDB Atlas (connection via `MONGO_URI`) |
| Frontend | React **19**, Vite **7**, TypeScript ~5.9, Tailwind **3** (CSS-variable tokens), react-router-dom **7**, **@tanstack/react-query 5** (every read), lucide-react; charts are hand-made SVG/HTML components. Tests: Vitest + Testing Library + jsdom. *(Before 2026-10-04: chart.js + plugins, gsap, three/ogl/postprocessing, 28 themes.)* |
| Auth | Google OAuth 2.0 → JWT in httpOnly cookie (web); random API key in `x-api-key` header (extension) |
| ML/Insights | **None built.** Pure deterministic JavaScript statistics (`metricsDerive.js`) plus a 13-rule threshold engine. No Python, no trained model, no LLM. A work-type classifier (logistic regression over 18 session attributes, learned from one-tap user labels) feeding rule-based personas and group titles is designed in `docs/ML_INTEGRATION_PLAN.md` (redesigned 2026-09-17) and blocked on data. |
| Deploy | Backend: Render (`codetrackr-backend-uckp.onrender.com`, per extension default) — also has a Vercel serverless config. Frontend: Vercel (`code-trackr-frontend.vercel.app`). DB: MongoDB Atlas. |
| Testing | Plain `node:assert` scripts: **27 backend suites (375 assertions)**, 6 extension suites (70). **39 integration tests** (`supertest` + `mongodb-memory-server`, real HTTP and real queries, incl. CORS preflight). **51 frontend tests** (Vitest, jsdom, `TZ=Asia/Kolkata`). CI runs all of it, the frontend build and a Docker health check on every push. |

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
 │  routes/extension.js → validate → normalisers →            routes/analytics|leaderboard|metrics|... │
 │    planActivityWrite → 10-min bucket $inc upsert           → Activity.find/.aggregate → JS reduce   │
 │  central (err,req,res,next) handler → { error, id }                                                 │
 │  services/notificationScheduler.js  (node-cron, hourly + nightly rollup) — only when                │
 │    require.main === module; serverless drives it via POST /api/internal/run-*                       │
 └───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                 ▼
                                        MongoDB Atlas
                              (activities, dailysummaries, users, groups,
                               groupmembers, goals, teams, notifications)
```

- **Style:** client–server, RESTish, **modular monolith** (one Express process, feature routers).
  Partial **MVC**: models (Mongoose) + routes-as-controllers; a thin **service** layer covers ingest
  (`activityBucket`, `activityNormalizers`, `ingestValidation`), insights (`metricsService`, `metricsDerive`,
  `sessionize`, `insightsBaseline`, `rulesEngine`), rollup (`dailySummary`, `dailyRollup`) and helpers
  (`authorization`, `passwordHash`, `textQuery`, `notificationScheduler`). The social and analytics
  routes still talk to Mongoose directly.
- **No message queue, no Redis, no WebSockets.** Extension→backend is fire-and-forget HTTP.
  Frontend→backend is request/response; NotificationPanel **polls** every 30 s.

---

## 5. The unique-key / account-linking mechanism (CORE — expect deep interview questions)

**Since 2026-10-03 (roadmap item 3) keys are stored hashed.** The section below describes the
current design; the old one is summarised at the end.

**Format.** `ct_<id>_<secret>`: `id` = 16 hex chars (a lookup handle, stored in clear, unique
index); `secret` = 32 random bytes in base64url. Only `SHA-256(secret)` is stored
(`users.apiKeyHash`, `select:false`), plus `apiKeyLast4` and `apiKeyCreatedAt` for display.
`services/apiKeys.js` (pure, unit-tested) generates, parses and verifies keys.

**Generation and delivery.** A new Google user gets **no key** at sign-up. The Onboarding page
calls `POST /api/user/regenerate-api-key`, which runs `user.issueApiKey()` and returns the full
key **once**. `GET /api/user/profile` never returns the key — only `hasApiKey`, `apiKeyHint`
(`ct_<id>_…last4`) and `legacyApiKey`. Profile → Regenerate shows a new key once and revokes
every older key.

**Delivery to the extension.** `CodeTrackr: Setup API Key` stores it in **VS Code
SecretStorage** (OS keychain) from extension 2.5.0 (live since 2026-10-04); a key left in `settings.json`
by an older version is moved there on activation and the setting is cleared.

**Verification.** `middleware/auth.js → findUserByApiKey`: a `ct_` key is looked up by `id`, then
`SHA-256(secret)` is compared with `crypto.timingSafeEqual`. A legacy 64-hex key is looked up by
its SHA-256 (`legacyApiKeyHash`); a row that still holds the old key in plaintext is accepted once
and converted on the spot. `scripts/migrate-hash-api-keys.js` (dry run by default; `--apply` is an
operator action) converts every remaining plaintext key at once.

**Why SHA-256, not scrypt/bcrypt:** a slow hash protects guessable secrets (passwords). A 256-bit
random secret cannot be guessed, so a fast hash is enough and keeps every ingest request cheap —
the same choice GitHub and Stripe make for API tokens.

**What the key still IS:** a bearer credential with full upload rights for one user and no
expiry or scope. Stealing it lets someone upload fake activity for that user, not read their
dashboard. A database leak no longer reveals usable keys. Still open: expiry, scopes, per-device
keys (the device-code login, roadmap item 13, addresses these).

*Before 2026-10-03:* 64 hex chars generated at first login, stored and compared in plaintext
(`User.findOne({ apiKey })`), returned by `/api/user/profile` on every page load, and kept by the
extension in plaintext `settings.json`.

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
| **userinsights** | one document per user holding the cached 90-day baseline | Refreshed at most once a day, on read, by `services/insightsBaseline.js` — no cron. |
| **users** | `googleId` (unique), `name`, `email` (unique), `profilePictureUrl`, `apiKey` (unique, sparse, **plaintext**), `lastLogin`, `isFirstLogin` | |
| **groups** | `name`, `description`, `visibility: 'public'|'private'`, `password` (`select:false`, scrypt hash `scrypt$salt$hash`, legacy plaintext tolerated), `createdBy: ObjectId→User` | |
| **groupmembers** | `groupId: ObjectId`, `userId: ObjectId`, `joinedAt` | Unique compound index `{groupId:1, userId:1}`. Join table. |
| **goals** | `userId: ObjectId→User`, `title`, `description`, `targetHours` (min 1), `techStack: String`, `deadline`, `status: 'in-progress'|'completed'` (default in‑progress), `completedAt`, `reminderSent` | `PATCH /api/goals/:goalId/complete` + `/reopen` (owner-scoped, added 2026‑09‑10). **Before that no route ever set `completed`**, so `estimationCalibration` was permanently unreachable. |
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
| GET | `/api/leaderboard?days=` | `isAuthenticated` | Global. Aggregates the **entire** activities collection (optional `?days=` window, capped at 400) + **all** users, merges/sorts/scores in Node. No pagination, no cache (H-7 open). `commits` = real git commits (H-17). Returns name only — no email since 2026‑09‑12 (M-23). |
| GET | `/api/metrics?days=&timezone=` | `isAuthenticated` | Derived Insights metrics, plus `insights` (rules-engine findings), session/archetype mix and 90-day baseline deltas. **Session identity only — no `:userId` param** (deliberate, closes the IDOR class). |
| POST | `/api/groups/create` | `isAuthenticated` | Creator auto-added as member; private → scrypt-hash password. |
| GET | `/api/groups/my-groups` \| `/discover` | `isAuthenticated` | Membership-scoped / inverse. `/discover?search=` is regex-escaped and capped at 100 results (H-16). Both populate `createdBy` with `name email` (M-29, open). |
| GET | `/api/groups/:groupId/details` | `isAuthenticated` + **membership check** | Members list + group leaderboard (all-time, no pagination): hours, lines, commits, failed commands and builds with rates (M-21). |
| POST | `/api/groups/:groupId/join` \| `/leave` | `isAuthenticated` | Password check for private; last member leaving deletes the group. |
| POST | `/api/goals/create` · GET `/api/goals` · GET `/api/goals/:goalId/progress` · PATCH `/:goalId/complete` \| `/reopen` | `isAuthenticated` (+ owner scope on progress, complete, reopen) | Progress = Σ activity seconds whose `language` **or** `projectName` matches `techStack` (case-insensitive, exact), from `createdAt` to `completedAt` (else `deadline`, else now), ÷ 3600 ÷ targetHours. Complete/reopen added 2026-09-10 (M-17). No edit/delete route. |
| GET/PATCH/DELETE | `/api/notifications/*` | `isAuthenticated` | All correctly scoped by `req.user._id`. |
| — | ~~`/api/teams/*`~~ | — | **Deleted 2026-10-03** with its model and the unrouted page (roadmap item 11). |
| GET | `/auth/google` · `/auth/google/callback` · `/auth/current-user` · POST `/auth/logout` | — | OAuth + JWT cookie. |
| POST | `/api/internal/run-notifications` \| `/run-rollup` | header `x-internal-secret` = `INTERNAL_CRON_SECRET` | External-cron trigger for the scheduler; **404** when the secret is unset or wrong (H-13). |
| GET | `/health` · `/` | — | `/health` = readiness, 503 unless Mongo is connected (L-8); `/` = liveness. |

Legacy unauthenticated `POST /api/user-activity` / `GET /api/user-stats/:id` were **deleted**
(H‑2); they still exist in `server.js.old` for reference only.

---

## 9. VS Code extension — how it works

*Source version: **2.4.0** (2026-09-10 — flush carry-forward + idle pause), **published** on the Marketplace. `.vsix` files are gitignored, so the repo holds none; Marketplace publish is manual.*

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
- **Failure handling (2.5.0, built 2026-10-03, live since 2026-10-04):** every interval with signal gets a
  `flushId` (UUID) and is saved to a persisted outbox (`src/outbox.ts`, `globalState`) *before*
  the upload; the outbox is drained oldest first on every flush, on activation and after a key is
  set. `sendActivity` returns `ok` / `drop` (400, or a duration outside 1–3600 s) / `retry`
  (offline, 5xx, 429, no key). Items older than 23.5 h are pruned (the server refuses > 24 h); the
  queue is capped at 500. Signal-less intervals are carried in memory and merged into the next
  interval (earliest timestamp). The API key lives in SecretStorage. 401 → one-time prompt.
  *2.4.0 (published) instead merged every unsent payload into the next one in memory (M-30).*
- **Config keys:** `codetrackr.apiBase` (default `https://codetrackr-backend-uckp.onrender.com`),
  `codetrackr.apiKey`, `codetrackr.flushIntervalSeconds`, `codetrackr.minFlushMinutes`,
  `codetrackr.debug`.
- **Build/publish:** esbuild bundle → `dist/extension.js`; `vsce package`. Publisher
  `CodeTrackr-ext`. Versioning saga: a `2.1.0` was uploaded in May 2025 *before* `2.0.x`, and
  the Marketplace serves the highest version *number*, so the `2.0.11` fixes never reached
  users. `2.2.0` (2026‑08‑28) superseded it; 2.3.0 and 2.4.0 followed. 2.4.0 is the live Marketplace
  version (confirmed on the Marketplace listing, 2026-09-12).

---

> **Deployed and verified end to end on 2026-09-12.** Both tiers run `main`, and real ingest now
> arrives bucketed with analytics sub-documents.
>
> **A correction to `docs/AUDIT-2026-09-10.md`:** the 140 analytics-bearing documents it found were
> **demo data** from `scripts/seed-demo-insights.js`, not extension output. Rich analytics first
> reached production on 2026-09-12.
>
> **Data is still scarce.** On 2026-09-16 there were 4 bucketed documents from 1 user, none since
> 2026-09-12, and 0 completed goals. Confidence gating shows that as "—" rather than a fabricated
> number. Formula definitions live in `docs/INSIGHTS_METRICS.md`.

## 10. Insights / "ML" — WHAT IT ACTUALLY IS

**It is not machine learning.** No model, no training, no inference, no Python, no LLM, no
external AI API. `GET /api/metrics` → `services/metricsService.buildMetrics()` runs a handful
of MongoDB `$group` aggregations, then `services/metricsDerive.js` (pure, unit-tested,
dependency-free functions) computes:

| Metric | Definition (as coded) |
|---|---|
| `deepWorkRatio` | Σ(flow blocks ≥ 25 min) ÷ Σ(all flow blocks) — same clock, bounded 0–1. *(Was ÷ total focused ms: two different clocks, could exceed 1. Fixed 2026-09-10.)* |
| `flowBlocks` | median / longest / count / deep-block count / total of `flowBlocksMs`. |
| `volumeStability` | `1 − MAD/median` of daily minutes, clamped [0,1] — robust. *(Was `1 − CV` over only active days, so it measured volume evenness, never cadence. Fixed 2026‑09‑10; `consistencyIndex` kept as an alias.)* |
| `activeDaysRatio` | activeDays ÷ windowDays — the real cadence metric. |
| `qualityStreak` | consecutive days containing a ≥25 min flow block. |
| `truePeakWindow` | **2-hour** window maximising `Σ minutes × (1 − churnRatio)`, eligible at ≥3 distinct days (most *productive*, not busiest). *(Was a 1-hour argmax with unvalidated weights and no sample floor. Fixed 2026‑09‑10.)* |
| `estimationCalibration` | median(actual ÷ estimated) + range across **completed** goals, usable from 1. *(Was a mean needing ≥2 — and no route completed a goal, so it never returned anything. Fixed 2026‑09‑10.)* |
| `interruptionsPerHour` | blurEvents ÷ focused hours. |
| **confidence** | every metric carries `meta[name].{confidence, sampleSize, unit}`; `insufficient` renders as "—". |
| `churnRatio` | churnLines ÷ linesInserted. |
| `comprehensionLoad` | readMs ÷ (readMs + writeMs). |
| `contextSwitchesPerHour` | fileSwitches ÷ focused hours. |

- **Runs:** synchronously, per request. Only the 90-day **baseline** is cached (`UserInsights`, refreshed
  at most daily on read); the rest is recomputed every page load (`buildMetrics` measured 239 ms cold,
  44 ms warm).
- **Insufficient data:** every metric is confidence-gated (`docs/INSIGHTS_METRICS.md` §1) and renders
  "—" below its minimum sample. `estimationCalibration` needs **one** completed goal whose stack
  matches real activity (was two).
- **Privacy:** these metrics are per-user only and never appear on the leaderboard.
- **An LLM layer was *designed* (Gemini chosen) but never built** — see
  `docs/TRACKING_ROADMAP.md` Part 5. `AI_INSIGHTS_DESIGN.md` is referenced but absent.
- **Rules engine (2026-09-10):** `services/rulesEngine.js` — 13 declarative threshold rules over these
  metrics, gated on the same confidence sidecar, each finding carrying the numbers that fired it;
  returned as `insights` and rendered as "What stands out". Sessions and rule-based archetypes come
  from `services/sessionize.js`. See `docs/RULES_ENGINE.md`.
- **Honest interview line:** "The Insights page is deterministic descriptive statistics — medians
  and MAD, confidence-gated, with a small rules layer that says what stands out — not ML. I scoped
  it that way deliberately so every number is explainable and reproducible; an LLM 'narration'
  layer on top is designed but not implemented."

---

## 11. Leaderboard — how ranking works

`GET /api/leaderboard`:
1. `User.find({})` — **all** users.
2. `Activity.aggregate` over the **entire** collection (or `?days=`, capped at 400), excluding
   `duration < 0`: `$group` by the String `userId`, summing duration, lines and **real commits**
   (`gitAnalytics.commits`, falling back per document to `terminalAnalytics.gitActivity.commits` —
   never both), `$addToSet` project names, and counting `flushes` (`$ifNull($flushCount, 1)`).
3. Merge in Node, sort by `totalHours` desc, assign `rank = index + 1` (ties → array order).
4. Scores `speed/quality/engagement/impact/overall/commitScore` are computed **relative to the
   current maximum** — so every user's score shifts whenever the top user codes more. Each score is
   clamped to [0, 5] by `score()`, and the maxima come from a fold (`maxOf`), not a spread.
   *(Until 2026-09-10: `commits` was flush count (H-17), `impact` could go negative (M-18), and
   `Math.max(...spread)` threw `RangeError` past ~100k users (H-18).)*

**Cost:** O(total activity documents + total users) per request, in application memory, no
time window by default, no pagination, no cache. Fine for a class project; the first thing that breaks at
scale (H-7, open — the fix is a `UserStats` running-total rollup). Group leaderboard
(`/api/groups/:id/details`) is the same pattern scoped to member IDs (H-8, open).

---

## 12. Frontend notes

> **2026-10-04: the website was redesigned; the notes below describe the OLD frontend.** Current
> structure: `docs/ARCHITECTURE.md` §8 and `docs/specs/2026-10-04-frontend-redesign.md`.

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
  - `Goals.tsx` has a **Mark complete / Reopen** button (2026-09-10, M-17). To-dos are not persisted
    (Quick-Wins #14, open); there is no edit or delete UI. The `/:goalId/progress` endpoint is never called.
  - `npm run build` — ✅ **green as of 2026-09-09** (was 29 `tsc -b` errors, M-13). CI (`.github/workflows/ci.yml`) keeps it green.
  - ~~`NotificationPanel` polling `useEffect` closes over a stale `isOpen` (L-1)~~ — fixed 2026-09-12.
  - **`Onboarding.tsx:157` links to a placeholder Marketplace URL** (`YOUR_PUBLISHER.codetrackr`) that
    404s for every new user. The real identifier is `CodeTrackr-ext.codetrackr-vscode` (M-25, open).
- **Themes:** 28 palettes in `ThemeContext.tsx`, persisted to `localStorage.selectedTheme`,
  applied as CSS custom properties + inline styles.

---

## 13. Error handling & reliability (actual)

- ✅ **Central error handler (M-10, 2026-09-09):** routes call `next(err)`; one `(err,req,res,next)`
  handler logs the full error with a correlation id and returns `{error, id}` — no `error.message`
  leaks. Since 2026-09-10 it maps Mongoose `CastError`/`ValidationError` to **400** (M-19), and
  `routes/notifications.js` uses it too (M-20).
- Mongo connection: `mongoose.connect(...).catch(err => console.error(...))` — the process
  **keeps running without a DB**; requests then fail per-query.
- Ingest validation (2026-09-09, M‑4): `services/ingestValidation.js` `validateIngestPayload`
  bounds `duration ∈ (0, 3600]`, `fileName ≤ 255`, `language ≤ 64`, `projectName ≤ 128`,
  `timestamp ∈ [now-24h, now+60s]` → `400 { message, details }`. `timestamp` is still
  client-supplied (bounded, not server-set); no per-key ingest quota.
- Extension offline: retained in memory, no disk queue, lost on restart.
- ML/metrics failure: caught → `500 { success:false }`; the Insights page shows "Could not
  load your insights" + Try again. A `rulesEngine` failure on its own degrades to an empty
  `insights` panel rather than failing the request.
- ~40 `console.log` on hot paths including per-request user IDs (L‑3).

---

## 14. Security posture — quick reference

**Fixed (branch `feat/security-and-insights`):** analytics/leaderboard now require auth +
ownership (H‑1); legacy open write/read endpoints deleted (H‑2); group passwords scrypt-hashed
(H‑9); `AUTH_BYPASS` refused in production (H‑10); IDORs on goals/teams closed (H‑11);
`/api/metrics` takes no `:userId` (IDOR-proof by construction).

**Still open / by design:**
- API key: **hashed at rest since 2026-10-03** (SHA-256 of a `ct_<id>_<secret>` secret; legacy keys converted on use or by `migrate-hash-api-keys.js`); still no expiry or scope, full ingest authority.
  Stealing it lets an attacker forge unlimited activity for that user (leaderboard fraud) —
  but not read the victim's dashboard (that needs the JWT).
- `JWT_SECRET` was a hardcoded fallback — now required at boot (M‑9, ✅ fixed 2026-09-09).
- `helmet` + rate limits on `/auth` and `/api/extension` added 2026-09-09 (M‑3 ✅); extended 2026‑09‑12 (M-24) to `POST /api/groups/:groupId/join` (10 per IP per 15 min) and `/api/analytics` (120/min).
- Ingest is bounds-checked (M-4, partial) but has no per-key quota, so plausible fake activity is
  still easy to inject with a valid key.
- ~~Error responses echo `error.message`~~ — fixed (M-10).
- ~~Leaderboard exposes every user's email~~ — ✅ fixed 2026‑09‑12 (M-23 / Quick-Wins #16).
- Extension stores the key in SecretStorage from 2.5.0 (live since 2026-10-04); 2.4.0 and older kept it in `settings.json`, and 2.5.0 moves an old key across on first start.
- Ingest is still not idempotent, but a re-sent flush now `$inc`s the same bucket rather than
  creating a second document — a same-window replay double-counts within one bucket, not a new row.
- Client supplies `timestamp` on ingest — bounded to `[now-24h, now+60s]` (M-4) but not server-set.
- ✅ Fixed 2026-09-10: regex injection / ReDoS in `GET /api/groups/discover?search=` (H-16).

---

## 15. Deployment & environment

**Backend env vars** (`backend/.env.example`): `MONGO_URI` (required), `JWT_SECRET` (required —
is now required at boot — fixed 2026-09-09), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL`
(required — `config/passport.js` **throws at import** if missing), `FRONTEND_URL` (CORS +
redirects), `PORT` (default 5050), `NODE_ENV`, `INTERNAL_CRON_SECRET` (enables `/api/internal/*`),
`ACTIVITY_BUCKET_MS` (`0` = legacy per-flush inserts), `AUTH_BYPASS` (dev only).

**Frontend env:** `VITE_API_URL` in development only (falls back to `http://localhost:5050`); the
production build uses its own address. `frontend/vercel.json` forwards `/api/*` and `/auth/*` to
Render (caching off), then the SPA rewrite (`/(.*)` → `/index.html`).

**Backend deploy:** the extension's default `apiBase` points at **Render**
(`codetrackr-backend-uckp.onrender.com`); `backend/vercel.json` also exists (serverless via
`api/index.js` + `serverless-http`). H‑13 **fixed 2026-09-09:** `initScheduler()` + `app.listen()` are inside
`if (require.main === module)`, so `require('../app')` (the serverless entry) starts nothing.
The schedule is driven externally via `POST /api/internal/run-{notifications,rollup}` behind
`INTERNAL_CRON_SECRET` (404 when unset/wrong). Operator wires the external scheduler.

**DB:** MongoDB Atlas (TLS, `family:4`, 15 s server-selection timeout).

**CI:** `.github/workflows/ci.yml` (2026-09-09) — backend `npm test` plus an `app.js` import smoke
(needs `GOOGLE_*` placeholders), frontend `npm run build`, extension `npm test`, on every push and PR.
**CD:** none in the repo — no Dockerfile or Procfile; Vercel and Render build from their own Git
integrations.

### Live deployment state (verified 2026-09-16)

| Tier | Serving | Evidence |
|---|---|---|
| Frontend — Vercel (`code-trackr-frontend.vercel.app`) | `main` (`92b899b`) | bundle contains `/insights`, "What stands out", "Cmd fails" |
| Backend — Render (`codetrackr-backend-uckp.onrender.com`) | `main` (`92b899b`) | `GET /health` → 200 `{status:"ok", db:true}` |
| Scheduler — GitHub Actions (`.github/workflows/cron.yml`) | hourly notifications, daily rollup | manual run green; the rollup writes `dailysummaries` on schedule |

- **How `main` got here (2026-09-12).** `main` shared no history with `feat/security-and-insights`
  (a trial merge gave 35 add/add conflicts), so `main` was replaced by the branch with a force-push.
  The old `main` is preserved as tag `backup-main-4c1ae25`; the feature branch on the remote is now
  stale. `main`'s only unique files were the dead sync pipeline deleted as H-12.
- **The Vercel rollback trap.** Production had been pinned by an Instant Rollback: new pushes built
  successfully but never took the domain. The fix was Deployments → newest build → **Promote**, not a
  rebuild. The rollback dialog only lists the immediately previous deployment, so it looks as though
  no new build exists when one does.
- **Render's free tier sleeps.** After ~15 idle minutes the first request takes ~22 s (measured
  2026-09-16). A new visitor sees a frozen page (L-10).
- **A Vercel preview cannot exercise the app.** CORS allows only `FRONTEND_URL` plus
  `localhost:5173/5174`, and the OAuth callback redirects to `FRONTEND_URL`.
- **The scheduler secret** `INTERNAL_CRON_SECRET` must be identical in GitHub repository secrets and
  in Render's environment; a mismatch returns 404 by design.
- **Check the deploy:** Render `GET /health` returns JSON, and the production nav shows **Insights**.
  Render's health-check path should point at `/health`, not `/`.

---

## 16. Testing (actual)

| Suite | File | Style | Covers |
|---|---|---|---|
| streak | `backend/tests/streak.test.js` | extracts helpers from shipped `analytics.js`, runs vs stubbed `Activity.aggregate` | `computeStreak`, `localDayInfo` (timezone) — 9+ assertions incl. regression cases |
| ingest | `backend/tests/ingest.test.js` | unit | `activityNormalizers` — defaults, coercion, negative rejection, `flowBlocksMs` cap |
| metrics | `backend/tests/metrics.test.js` | unit | every `metricsDerive` function |
| authorization | `backend/tests/authorization.test.js` | unit | `sameUser`, `assertOwnership`, `isBypassAllowed` |
| routeGuards | `backend/tests/routeGuards.test.js` | **static source scan** | fails if a sensitive route loses its auth middleware (H‑1 regression guard) |
| passwordHash | `backend/tests/passwordHash.test.js` | unit | scrypt round-trip, salting, legacy plaintext, null-safety |
| trackers | `extension/tests/trackers.test.js` | unit vs built `dist/extension.js` + `vscodeStub` | EditorTracker / FocusTracker / GitStateTracker behaviour + regressions |
| activation | `extension/tests/activation.test.js` | loads the real bundle vs stub | every contributed command is registered; no network without a key; payload shape; manifest sanity |

Plus, since 2026‑09‑08: `activityBucket` (21 — bucket math, `hasSignal`, update shape,
sparseness, `planActivityWrite`), `activityModel` (10 — schema/index shape), `ingestWiring`
(9 — source scan that `/track` uses the planner + reads tolerate bucketed docs), `rollup`
(7 — `buildDaySummary`). Extension `activation` gained `payloadHasSignal` + manifest checks.

Plus, since 2026‑09‑09 (quick-wins batch): `quickWins` (14 — source scans for the `JWT_SECRET`
boot-guard, no `'your_jwt_secret'` fallback, `11000`→409 on group join, `GET /health`,
`helmet` + rate-limit wiring, central error handler + zero response-body `.message` leaks, the
`require.main` bootstrap guard, `/api/internal` + its secret, the `{goalId:1,type:1}` index)
and `ingestValidation` (23 pure — `validateIngestPayload` bounds).

Plus, since 2026-09-10: `metrics` rewritten (37), `metricsService` (35), `sessionize` (26),
`insightsBaseline` (19), `textQuery` (13), `leaderboardScore` (11), `rulesEngine` (22); extension
`flushSafety` (15).

Plus, since 2026-09-12: four more assertions in `metricsService` and `quickWins` (the cadence
regression, the email projection, and the two new rate limiters).

**Total (2026-10-04): 375 backend unit assertions across 27 suites, 39 backend integration tests, 70 extension assertions across 6, 51 frontend tests (Vitest).** *(The paragraph below describes the state before the integration suite existed.)* No test framework, **no
integration/API/DB/e2e tests, no frontend tests.** Nothing has been run against a real
database — the bucketing/rollup/wiring logic is proven at the pure-function / source-scan
level only (a `supertest` + `mongodb-memory-server` integration test is the tracked next step,
Quick-Wins #24).

---

## 17. Known limitations (short list — full treatment in interview docs)

1. API key = non-expiring, unscoped bearer credential (hashed at rest since 2026-10-03).
2. ~~Leaderboard / group leaderboard full scan (H-7/H-8)~~ — all-time boards read `userstats` since 2026-10-03; windowed boards still scan their window.
3. ~~Analytics aggregate in JS (M-1)~~ — daily/weekly use a `$facet` pipeline since 2026-10-03; `/timeslot` (2-hour window) still sums in JS.
4. `node-cron` on serverless — **fixed 2026-09-09 (H‑13)**: `require.main` guard + `POST /api/internal/run-{notifications,rollup}` behind `INTERNAL_CRON_SECRET`. Operator wires the external scheduler.
5. Rate limits are per **IP** on `/auth`, `/api/analytics` and group `/join` — a whole campus on one NAT shares them (H-20, open). Ingest now has a per-key quota and the 600 s window cap (H-21 mitigated); `timestamp` is still client-supplied.
6. ~~Frontend does not typecheck~~ ✅ fixed 2026-09-09 (M‑13) — `npm run build` green, enforced by CI.
7. Dashboard "Repeated Failures" shows real data (2026-09-09); the half-built Goals to-dos were removed; Teams was deleted (2026-10-03).
8. `activities.userId` String → ObjectId is mid-migration (M-6): reads accept both; the live `--apply` and the contract step remain.
9. ~~Extension has no offline queue~~ — extension 2.5.0 (built 2026-10-03, live since 2026-10-04) persists every upload in a `globalState` outbox with its own `flushId` (M-30 fixed). Anyone still on 2.4.0 or older loses unsent time on restart until VS Code updates the extension.
17. The Dashboard's "today" window is the previous day from 00:00 to 05:30 IST (H-22).
18. Group listings (`/discover`, `/my-groups`, `/details`) return emails — creators' to any signed-in user, members' to members (M-28, M-29).
10. ~~Ingest not idempotent~~ — uploads with a `flushId` (extension 2.5.0) are applied once (2026-10-03); older extensions send none.
11. Insights recomputed every request; only the 90-day baseline is cached.
12. GitHub Actions CI added 2026-09-09 (backend+extension tests, frontend build); still no CD, no observability, no integration tests.
13. **DB write-reduction (2026‑09‑08):** time-of-day precision is now the 10-minute grid;
    all-time reads (`/leaderboard`, `/summary`, `/metrics >90d`) still scan raw `activities`
    — not yet repointed at `dailysummaries`; the 400-day TTL is a safety net only.
14. **Data is scarce.** 4 bucketed documents from 1 user as of 2026-09-16, none since 2026-09-12. No
    insight, and no model, can be trusted until more people use the extension.
15. Render's free tier cold-starts in ~22 s (L-10).
16. The onboarding Marketplace link is a placeholder that 404s (M-25).

*(Fixed 2026‑09‑08: the missing `{userId:1,timestamp:-1}` index; per-flush document
explosion; the dead `date` field/index; idle < 2 min inflating totals.)*

---

## 18. Recommended improvements (NOT built — keep separate from the above)

**Short term:** hash API keys at rest (`keyId` + secret, prefix); bounds-check the ingest
payload (`0 < duration ≤ 3600`, length caps, timestamp window); per-key rate limit +
idempotency key on ingest; a rate limiter on group `/join`.
*(Done 2026‑09‑08: `{userId:1,timestamp:-1}` index; 10-min bucketing; drop `date`.
Done 2026‑09‑09 — quick-wins batch: `helmet` + `express-rate-limit` on `/auth` + `/api/extension`;
central error middleware; wire the real `repeatedFailedCommands`; `JWT_SECRET` fail-fast;
409 on duplicate join; `GET /health`; fix the frontend build; GitHub Actions CI.)*

**Medium term:** `UserStats` rollup collection updated on ingest → leaderboard reads N docs
for N users; **repoint `/leaderboard`, `/summary`, `/metrics >90d` at `dailysummaries` and
tighten the raw TTL from 400d** (the explicit follow-up to the write-reduction batch); add
`?period=` window + pagination; shared MongoDB aggregation service for analytics + metrics;
adopt React Query for caching/dedup; migrate `activities.userId` to ObjectId with a compat
window; extension offline queue (persist to `globalState`), idempotency key on ingest.

**Long term:** ingest → queue (SQS/Kafka) → workers → time-series store / analytics warehouse;
Redis cache for leaderboard + insights; a work-type classifier with personas and group titles (designed in
`docs/ML_INTEGRATION_PLAN.md`, blocked on data); the designed LLM narration layer with a
numbers-must-be-grounded validator; anti-cheat / anomaly detection on ingest; per-device keys
+ short-lived signed ingest tokens or OAuth device flow; observability (structured logs,
metrics, tracing); automated Marketplace publish (CI itself exists since 2026-09-09).

---

## 19. Current implementation status (as of analysis)

- Branch: `main` (the `feat/security-and-insights` branch is stale since the 2026-09-12 force-push). Security Batch 3 + Insights page **done**.
  Data-accuracy Batch 1 + extension Batch 2 (2.0.11 / 2.2.0) **done**.
- **DB write-reduction batch (2026‑09‑08) done:** 10-minute bucket-on-write (`$inc` upsert),
  skip signal-less flushes (extension 2.3.0), sparse analytics sub-docs, dropped the `date`
  field/index, added `{userId:1,timestamp:-1}`, `DailySummary` + nightly rollup + 400d TTL.
  Spec `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md`, plan
  `docs/superpowers/plans/2026-09-08-db-write-reduction.md`. `ACTIVITY_BUCKET_MS=0` = legacy.
  **Follow-up open:** repoint all-time reads at `dailysummaries` + tighten the TTL (with `UserStats`).
- **Quick-wins batch (Tier 1 + security), 2026-09-09 — DONE:**
  `#5` (index, folded from the DB batch), `#7` `JWT_SECRET` fail-fast (M‑9), `#6` 409 on
  duplicate group join (M‑14), `#11` `GET /health` (L‑8), `#8` real Repeated-Failures data
  (M-15), `#3` `helmet` + rate-limit (M-3), `#1` frontend build green (M-13), `#2` GitHub
  Actions CI (L-9), `#4` central error handler (M-10), `#12` ingest validation (M-4), `#15`
  serverless-safe bootstrap + external cron (H-13). Deferred: `#9` `UserStats` leaderboard rollup
  (decided: live running-total), `#10` idempotency key, `#13` React Query, `#14` to-dos (goal
  completion itself shipped 2026-09-10), all of Tier 3. Spec/plan under
  `docs/superpowers/{specs,plans}/2026-09-09-quick-wins-tier1-security.md`.
- **Production-readiness batch (2026‑09‑10) done** — full audit in `docs/AUDIT-2026-09-10.md`,
  metric definitions in `docs/INSIGHTS_METRICS.md`.
  - **Extension 2.4.0 — data loss fixed.** `buildPayload()` resets every tracker, and four paths
    bailed out after that point (signal-less flush, missing API key, out-of-range duration,
    failed upload), destroying the interval each time. `sendActivity` also swallowed its errors
    and never rethrew, so the documented "buffer and retry" was dead code. Added
    `mergeAnalytics()` carry-forward; `sendActivity` now returns success.
  - **Extension 2.4.0 — idle no longer inflates metrics.** `FocusTracker`/`EditorTracker` ran
    their own samplers through idle-pauses, so `focusedMs`/`readMs` banked entire idle gaps.
    Both now gate on `setPaused()`. This was the root cause of `deepWorkRatio` reading ≈0.
  - **Every metric formula corrected** (`metricsDerive.js`): `deepWorkRatio` now divides by
    total block time (same clock, bounded [0,1]); `consistencyIndex` split into
    `volumeStability` (robust MAD) + `activeDaysRatio` (real cadence); `truePeakWindow` is a
    2-hour window scored on surviving minutes with a distinct-day floor; `estimationCalibration`
    reports a median with range. New: `qualityStreak`, `interruptionsPerHour`.
  - **Confidence gating** — every metric ships `meta[name].{confidence,sampleSize,unit}`;
    `insufficient` renders as "—". Flat scalars unchanged, so the API stays backward-compatible.
  - **Dead flow revived** — `PATCH /api/goals/:goalId/{complete,reopen}` + `Goal.completedAt` +
    a Goals-page button. Nothing had ever set `status: 'completed'`.
  - **New:** `services/sessionize.js` (gap-split sessions + rule-based archetypes),
    `services/insightsBaseline.js` + `UserInsights` (90-day baseline, lazily cached, no cron).
- **Social-surface sweep + rules engine (2026‑09‑10) done** — the leaderboard, groups and
  notifications routes had only been audited shallowly. Design notes in `docs/RULES_ENGINE.md`.
  - **`H-16` regex injection / ReDoS.** `GET /api/groups/discover?search=` passed raw input to
    `{ $regex }`, so any signed-in user could list every group with `.*` or stall the event loop
    with `(a+)+$`. New `services/textQuery.js` (`escapeRegex`/`containsRegex`/`exactRegex`,
    length-capped); the two hand-rolled escapes in `goals.js` and `metricsService.js` now share it.
  - **`H-17` the leaderboard's `commits` was fabricated** — it summed `flushCount` (uploads every
    ~2 min of coding) and labelled it commits, while real counts sat unused in
    `gitAnalytics.commits`. Now reads the real field, falling back per-document to
    `terminalAnalytics.gitActivity.commits` for pre-`gitStateTracker` documents; never summed.
  - **`H-18` `Math.max(...)` spread** over one argument per user throws `RangeError` past ~100k —
    it fails exactly when the product succeeds. Replaced with a fold.
  - **`M-18`–`M-21`:** negative `impact` scores clamped; `CastError`/`ValidationError` mapped to
    **400** centrally (a malformed `:id` used to be a 500); `routes/notifications.js` now uses the
    central error handler and 404s on a delete that matched nothing; the group leaderboard
    surfaces commits + command/build failure counts and rates — the "who's hitting the most
    errors" comparison the project was built around, from data the extension always collected.
  - **New:** `services/rulesEngine.js` — declarative threshold rules over the derived metrics,
    gated on the same confidence sidecar, each finding carrying its own evidence. Wired into
    `GET /api/metrics` as `insights`, rendered as a "What stands out" panel. Deliberately not a
    model and not an LLM. `validateRules()` throws at module load if a rule requires a metric
    that has no confidence gate — the vacuous-guard bug that once shipped in `insightsBaseline`.
  - Backend **18 suites / 292 assertions**, extension **3 suites / 52**, frontend build green.
  - Verified read-only against the most active real account: 30-day window → **0 findings, 10
    checks skipped** (correct: 6 sparse active days); 365-day → 2 findings with real evidence.
- `H-7`, `H-8` (leaderboard scans) **still open** — this batch fixed the leaderboard's
  correctness, not its complexity; the fix is the deferred `UserStats` rollup. `H-13`
  (serverless cron) addressed by `#15`; most other `MEDIUM`/`LOW` items **open**.
- **Small-fix batch (2026-09-12) done** — `92b899b`. M-22 `activeDaysRatio` could only ever return 1;
  M-23 the leaderboard returned every user's email; M-24 rate limits on group `/join` and
  `/api/analytics`; L-1 the NotificationPanel stale closure; the demo seeder now backdates goals so
  `estimationCalibration` can be demonstrated. Backend **18 suites / 296 assertions**.
- **Deployed and verified (2026-09-12).** Both tiers serve `main`; real ingest arrives bucketed with
  analytics; the scheduler runs through GitHub Actions. See §15.
- **Extension 2.4.0 is published** on the Marketplace (`CodeTrackr-ext.codetrackr-vscode`). The repo
  holds only the 2.3.0 `.vsix`, which is misleading — do not infer the published version from it.
- **Machine learning: designed, not built** (2026-09-16, redesigned 2026-09-17). `docs/ML_INTEGRATION_PLAN.md` —
  ML answers one question per session: *what kind of coding was this* (DSA practice, project, debugging, learning,
  setup). Logistic regression over 18 attributes, trained on one-tap user labels (20% asked blind), tested on
  people it never saw, served as JSON in JavaScript, shipped only if it beats the rules. Personas ("DSA Warrior")
  and weekly group titles are plain rules on top. Skill levels were rejected as unmeasurable. Phases 1-2 ship
  without ML and collect the labels. File-by-file changes: `docs/ML_INTEGRATION_CHANGES.md`; simple explainer:
  `docs/ML_INTEGRATION_GUIDE.md`. Blocked on data.
- **Found 2026-09-17, open:** H-21 leaderboard hours can be inflated with a script (no 600 s cap per 10-minute
  record); M-28 group details show every member's email.
- **Found 2026-10-03 (full re-audit), open:** H-22 the Dashboard's "today" is the previous day from 00:00 to 05:30 IST;
  M-29 `/api/groups/discover` returns group creators' emails to any signed-in user; M-30 held extension payloads
  are dropped past 3600 s and filed under the newest project and time; L-11 no OAuth `state` check (login CSRF).
  All tests re-run green the same day (backend 18/296, extension 3/52, frontend build).
- **Open and user-facing:** M-25 (onboarding Marketplace link 404s) and L-10 (cold start). A public
  landing page for sharing the site was designed 2026-09-12 and is not built.
- ✅ **Update 2026-10-03:** H-19 (Vercel proxy, live), H-20 (per-user/session limits) and M-26 are
  fixed; consent-screen status still to confirm; M-33 (failed sign-in shows JSON) is new.
  *Original 2026-09-16 note:* ⚠️ **Not ready to share publicly.** H-19: login likely loops for Safari, iOS, Firefox,
  Brave and incognito users, because the auth cookie is third-party across `vercel.app` / `onrender.com`. H-20: the
  IP-keyed rate limits let only ~25 sign-ins and 10 group joins per 15 minutes for a whole campus on shared Wi-Fi.
  M-26: cancelling Google sign-in shows an API 404. M-27: onboarding fails silently. Also unverified: whether the Google
  OAuth consent screen is **In production** rather than **Testing**. Fix these before sharing the link.
- Frontend build is ✅ green (`tsc -b && vite build`); CI runs it on every push.
- **Writes to the live database so far:** `migrate-drop-date.js --apply` (2026-09-12 — the `date`
  field and its index are gone from every activity document), and demo data seeded for verification
  and then removed. Everything else has been read-only.

---

## 20. Pointers

- **Read before touching insights:** `docs/AUDIT-2026-09-10.md`, `docs/INSIGHTS_METRICS.md`,
  `docs/RULES_ENGINE.md`
- **Machine-learning plan (designed, not built):** `docs/ML_INTEGRATION_PLAN.md` (+ `.pdf`), the changes it needs
  in `docs/ML_INTEGRATION_CHANGES.md`, and the plain-language guide `docs/ML_INTEGRATION_GUIDE.md` (+ `.pdf`)
- Backlog with status: `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/CodeTrackr_Quick_Wins.md`
- Full interview prep: `docs/interview-preparation/CodeTrackr_Interview_Preparation.md` (+ `.pdf`),
  condensed: `CodeTrackr_Interview_Guide_Condensed.md` (+ `.pdf`)
- Q&A bank: `docs/interview-preparation/CodeTrackr_Interview_QA.md`
- Architecture deep-dive + diagrams: `docs/interview-preparation/CodeTrackr_Architecture.md`
- Quick revision: `docs/interview-preparation/CodeTrackr_Interview_Cheat_Sheet.md`
- DB write-reduction: `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md`,
  spec `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md`,
  plan `docs/superpowers/plans/2026-09-08-db-write-reduction.md`
- Standard project docs (kept current): `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
  `docs/PROGRESS.md`, `docs/INTERVIEW_PREP.md`
- Other engineering docs: `docs/IMPROVEMENT_PLAN.md`,
  `docs/SESSION-LOG-2026-08-27.md`, `docs/TRACKING_ROADMAP.md`
