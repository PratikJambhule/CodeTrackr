# CodeTrackr — Architecture & Data Flow

_Reverse-engineered from the codebase (no assumptions from filenames). Last verified: 2026-08-27._

## 1. Components

| Layer | Location | Stack |
|---|---|---|
| VS Code extension | `extension/src/*.ts` → `dist/extension.js` | TypeScript, axios, esbuild. Published as `CodeTrackr-ext.codetrackr-vscode` v2.0.10 |
| Backend API | `backend/` | Express 5, Mongoose 8, Passport (Google OAuth), JWT in httpOnly cookie |
| Database | MongoDB Atlas | 7 collections (below) |
| Web dashboard | `frontend/src/` | React 19 + Vite + TS + Tailwind, React Router |
| Deploy | `backend/vercel.json`, `frontend/vercel.json` | Vercel serverless (`backend/api/index.js` wraps app with `serverless-http`) |

`extension/extension.js` (560 lines, repo root of `extension/`) is **legacy v1** and is not the build entry — `package.json` `main` is `./dist/extension.js`, compiled from `src/`.

## 2. Activity capture (the source of truth)

`extension/src/extension.ts`:

- `activate()` → `start(context)` registers listeners on `onDidChangeTextDocument`, `onDidOpenTextDocument`, `onDidSaveTextDocument`, `onDidChangeActiveTextEditor`. Each calls `markActivity()`, updating `state.lastActivityMs`.
- Line deltas are computed from `doc.lineCount` diffs against a `Map<file, lineCount>` — so `linesAdded`/`linesRemoved` are **net line-count changes, not edit volume**.
- A `setInterval` ticks every 30s. On each tick:
  - idle ≥ 2 min → flush remaining active time, set `isPaused`, stop accumulating.
  - otherwise → `flushIfNeeded()` sends if buffered ≥ `minFlushMinutes`.
- Duration sent = **wall-clock minutes since last flush, converted to seconds** (`minutes * 60`). Idle time under the 2-minute threshold is counted as coding time.
- `TerminalTracker` (`terminalTracker.ts` + `commandClassifier.ts` + `gitTracker.ts`) shell-integration-hooks terminal command executions, classifies them (git/npm/node/python/docker/gcc/java/pip/misc), records exit codes, and `consumeInterval()` attaches a `terminalAnalytics` snapshot to each flush.

**Transport:** `POST {apiBase}/api/extension/track` with header `x-api-key`. One document per flush.

### Two pipelines exist; only one works

`extension.ts` calls **both** `logger.log(event)` (the `EventLogger`/`SyncService` batching pipeline) and the direct `axios.post(/api/extension/track)`. The `SyncService` posts batches to `POST /api/extension/events` — **that route does not exist on the backend**, and `SyncService` sends **no `x-api-key` header**. Every 30s it retries 3× with exponential backoff, then parks the batch in an in-memory `failedBatches[]` that grows unboundedly. `deactivate()` calls `persistFailedBatches()` with a **fake stub context** whose `update()` is a no-op, so nothing is ever persisted. The entire `logger.ts` + `syncService.ts` path is dead weight: wasted network, wasted memory, zero data.

## 3. Storage

`models/Activity.js` — the only high-volume collection.

```
userId       String (indexed)   // hex string of User._id, NOT an ObjectId ref
fileName     String (required)
fileType, projectName, language  String
duration     Number             // SECONDS
linesAdded, linesRemoved  Number
terminalAnalytics { totalCommands, successfulCommands, failedCommands,
                    buildRuns, testRuns, successfulBuilds, failedBuilds,
                    debuggingSessions, commandUsage{9 keys},
                    gitActivity{6 keys}, repeatedFailedCommands[], ... }
timestamp    Date               // real event time — use this
date         Date               // written as a "YYYY-MM-DD" string by /track → UTC midnight
```
Indexes: `{userId:1,date:-1}`, `{userId:1,projectName:1}`, `{userId:1,language:1}`, `{userId:1}`.

Other models: `User` (googleId, email, `apiKey` — 32 random bytes hex, sparse unique), `Group` (name, description, visibility, **plaintext password**, createdBy), `GroupMember` (groupId+userId, unique compound), `Goal` (targetHours, techStack, deadline, status), `Team` (embedded `members[]`), `Notification`.

**`duration` is in seconds.** `analytics.js`, `leaderboard.js`, and `groups.js` all divide by 3600. `goals.js` does not (see IMPROVEMENT_PLAN.md H-3).

## 4. Identity & auth

- Browser: Google OAuth → `routes/auth.js` signs a JWT → httpOnly cookie `token` → `middleware/auth.js:isAuthenticated` verifies and loads `req.user`.
- Extension: `x-api-key` header → `verifyApiKey` looks up `User.findOne({apiKey})`.
- `AUTH_BYPASS=true` makes **both** middlewares skip all checks and attach "the user with the most activity" as `req.user`.

## 5. API surface

| Route | Auth | Notes |
|---|---|---|
| `POST /api/extension/track` | apiKey | main ingest |
| `POST /api/extension/track/batch` | apiKey | exists, unused by extension |
| `GET /api/extension/verify` | apiKey | |
| `GET /api/analytics/:userId` | **none** | today's hourly breakdown + 7d fetch |
| `GET /api/analytics/weekly/:userId` | **none** | 7-day daily breakdown |
| `GET /api/analytics/timeslot/:userId` | **none** | 2-hour drilldown, 10-min slots |
| `GET /api/analytics/summary/:userId` | isAuthenticated | no ownership check |
| `GET /api/leaderboard` | **none** | global, full-collection scan |
| `/api/groups/*` | isAuthenticated | `:groupId/details` checks membership |
| `/api/goals/*` | isAuthenticated | `:goalId/progress` has no ownership check |
| `/api/teams/*` | isAuthenticated | `GET /:teamId` has no membership check |
| `/api/notifications/*` | isAuthenticated | correctly scoped by `req.user._id` |
| `POST /api/user-activity`, `GET /api/user-stats/:id` | **none** | legacy, in `app.js` |

## 6. Analytics computation

All analytics **load raw documents into Node and aggregate in JavaScript** (`Activity.find(...)` then `.reduce`/`.forEach`), except `/summary/:userId`, which uses a real `$group` pipeline. The daily endpoint fetches 7 days of documents and then filters to today in memory.

Timezone: the client sends `new Date().getTimezoneOffset()` (minutes, negative east of UTC) as `?timezone=`. The daily and timeslot endpoints use it to compute user-local midnight. **The weekly endpoint ignores it entirely** and buckets by UTC day.

Leaderboard: aggregates the **entire Activity collection** with no time window, `$addToSet`s every project name, joins against **every user**, then sorts and scores in Node on each request. Scores (`speed`/`quality`/`engagement`/`impact`) are relative to the current max, so every user's score shifts whenever the top user codes.

Group leaderboard: same pattern, scoped to member IDs, all-time, no pagination.

## 7. Dashboard flow

`Dashboard.tsx` mounts → `useEffect([])` calls `fetchAnalytics()` + `fetchWeeklyAnalytics()`; a second `useEffect([viewMode])` also fires on mount and calls `fetchAnalytics()` again → **3 requests on every mount, one redundant**. Analytics fetches omit `credentials:'include'` (they work only because those endpoints are unauthenticated). `NotificationPanel` polls `/unread-count` every 30s; its interval closure captures `isOpen` from a `[]`-dep effect, so the `if (isOpen)` branch inside is permanently stale.

## 8. Extension → insight path (what AI can build on)

```
VS Code events → 30s flush → POST /api/extension/track → Activity doc (1 per flush)
                                                              ↓
                                          JS-side aggregation in routes/analytics.js
                                                              ↓
                                                   Dashboard.tsx charts
```

The `Activity` collection already carries everything an insights engine needs: `timestamp` (hour-of-day, day-of-week), `duration`, `language`, `projectName`, line deltas, and rich `terminalAnalytics` (build/test success rates, git actions, repeated failures). No schema change is required to compute the metrics in the AI plan — only a proper aggregation layer.
