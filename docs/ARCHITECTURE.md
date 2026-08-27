# CodeTrackr — Architecture & Data Flow

_Reverse-engineered from the codebase (no assumptions from filenames). Last verified: 2026-08-28 (extension 2.1.0)._

## 1. Components

| Layer | Location | Stack |
|---|---|---|
| VS Code extension | `extension/src/*.ts` → `dist/extension.js` | TypeScript, axios, esbuild. Published as `CodeTrackr-ext.codetrackr-vscode`; source at v2.1.0 |
| Backend API | `backend/` | Express 5, Mongoose 8, Passport (Google OAuth), JWT in httpOnly cookie |
| Database | MongoDB Atlas | 7 collections (below) |
| Web dashboard | `frontend/src/` | React 19 + Vite + TS + Tailwind, React Router |
| Deploy | `backend/vercel.json`, `frontend/vercel.json` | Vercel serverless (`backend/api/index.js` wraps app with `serverless-http`) |

`extension/extension.js` (560 lines, repo root of `extension/`) is **legacy v1** and is not the build entry — `package.json` `main` is `./dist/extension.js`, compiled from `src/`.

## 2. Activity capture (the source of truth)

`extension/src/extension.ts`:

- `activate()` → `start(context)` registers listeners on `onDidChangeTextDocument`, `onDidOpenTextDocument`, `onDidSaveTextDocument`, `onDidChangeActiveTextEditor`. Each calls `markActivity()`, updating `state.lastActivityMs`.
- Edit volume is accumulated by `EditorTracker` from `event.contentChanges`: gross characters and lines inserted/deleted, churn, undo/redo, saves, file switches and a read-vs-write attention split. (Before 2.1.0 this was a net `doc.lineCount` delta that recorded zero for replace-in-place edits.)
- `FocusTracker` records real window focus/blur time and completed flow blocks; `GitStateTracker` reads commits from the `vscode.git` extension API.
- A `setInterval` ticks every 30s. On each tick:
  - idle ≥ 2 min → flush remaining active time, set `isPaused`, stop accumulating.
  - otherwise → `flushIfNeeded()` sends if buffered ≥ `minFlushMinutes`.
- Duration sent = **wall-clock minutes since last flush, converted to seconds** (`minutes * 60`). Idle time under the 2-minute threshold is counted as coding time.
- `TerminalTracker` (`terminalTracker.ts` + `commandClassifier.ts` + `gitTracker.ts`) shell-integration-hooks terminal command executions, classifies them (git/npm/node/python/docker/gcc/java/pip/misc), records exit codes, and `consumeInterval()` attaches a `terminalAnalytics` snapshot to each flush.

**Transport:** `POST {apiBase}/api/extension/track` with header `x-api-key`. One document per flush.

Since 2.1.0 the flush also carries `editorAnalytics`, `focusAnalytics` and `gitAnalytics`.
Commits come from the built-in Git extension API (`vscode.git`), not terminal parsing, so
commits made through the Source Control panel are counted. Edit volume is gross insert/delete
from `contentChanges`; the net `doc.lineCount` delta has been removed. Derived metrics are
served by `GET /api/metrics` (session identity only).

### Removed in 2.0.11

An `EventLogger`/`SyncService` pipeline used to post batches to `POST /api/extension/events` —
a route that does not exist — with no API key, retaining every failed batch in memory. It never
delivered any data and has been deleted. Debug session counts, which only fed that pipeline,
now ride along in `terminalAnalytics.debuggingSessions`.

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
**Added in extension 2.1.0** (additive; older documents lack these and read as zero):
```
editorAnalytics { charsInserted, charsDeleted, linesInserted, linesDeleted, churnLines,
                  undoCount, redoCount, saveCount, fileSwitches, uniqueFiles,
                  readMs, writeMs, largeInsertCount, largeInsertChars }
focusAnalytics  { focusedMs, blurredMs, blurEvents, flowBlocksMs[], longestBlockMs }
gitAnalytics    { commits, filesChanged, uncommittedFiles, uncommittedAgeMs }
```

Indexes: `{userId:1,date:-1}`, `{userId:1,projectName:1}`, `{userId:1,language:1}`, `{userId:1}`.

Other models: `User` (googleId, email, `apiKey` — 32 random bytes hex, sparse unique), `Group` (name, description, visibility, **plaintext password**, createdBy), `GroupMember` (groupId+userId, unique compound), `Goal` (targetHours, techStack, deadline, status), `Team` (embedded `members[]`), `Notification`.

**`duration` is in seconds.** `analytics.js`, `leaderboard.js`, and `groups.js` all divide by 3600. `goals.js` does not (see IMPROVEMENT_PLAN.md H-3).

## 4. Identity & auth

- Browser: Google OAuth → `routes/auth.js` signs a JWT → httpOnly cookie `token` → `middleware/auth.js:isAuthenticated` verifies and loads `req.user`.
- Extension: `x-api-key` header → `verifyApiKey` looks up `User.findOne({apiKey})`.
- `AUTH_BYPASS=true` makes both middlewares skip all checks in non-production only; it is refused outright when `NODE_ENV=production`.

## 5. API surface

| Route | Auth | Notes |
|---|---|---|
| `POST /api/extension/track` | apiKey | main ingest |
| `POST /api/extension/track/batch` | apiKey | exists, unused by extension |
| `GET /api/extension/verify` | apiKey | |
| `GET /api/analytics/:userId` | isAuthenticated + ownership | today's hourly breakdown + 7d fetch |
| `GET /api/analytics/weekly/:userId` | isAuthenticated + ownership | 7-day daily breakdown |
| `GET /api/analytics/timeslot/:userId` | isAuthenticated + ownership | 2-hour drilldown, 10-min slots |
| `GET /api/analytics/summary/:userId` | isAuthenticated + ownership | |
| `GET /api/leaderboard` | isAuthenticated | global, full-collection scan (H-7 unfixed) |
| `/api/groups/*` | isAuthenticated | `:groupId/details` checks membership |
| `/api/goals/*` | isAuthenticated | `:goalId/progress` scoped to owner |
| `/api/teams/*` | isAuthenticated | `GET /:teamId` checks membership |
| `/api/notifications/*` | isAuthenticated | correctly scoped by `req.user._id` |

| `GET /api/metrics` | isAuthenticated | derived metrics, session identity only (no `:userId`) |

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
