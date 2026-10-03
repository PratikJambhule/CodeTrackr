# CodeTrackr — Project Changes for the ML Integration

**Status: proposed, nothing built.** Written 2026-09-17. This is the file-by-file list of changes that
`docs/ML_INTEGRATION_PLAN.md` needs: what changes in the leaderboard, the groups, the Insights page, the
backend, the extension and the tests. File names and current behaviour were checked against the code
on 2026-09-17. `docs/ML_INTEGRATION_GUIDE.md` explains the same material in simple language.

Each change has an ID (`C-01`…), the phase it belongs to, and a rough effort. Phases:

| Phase | Name | Uses ML? |
|---|---|---|
| 0 | Fix first | No |
| 1 | Work types, rules only | No |
| 2 | Personas and group titles | No |
| 3 | Train and serve the model | **Yes** |
| 4 | Discovery with k-means (optional) | Yes |


## At a glance

| Area | What changes | Phase |
|---|---|---|
| **Ingest** | A 10-minute record can no longer hold more than 10 minutes; batch size capped | 0 |
| **Groups** | Member emails stop being shown; weekly titles; boards per work type; group mix; persona chips | 0, 2 |
| **Leaderboard** | Boards per work type; persona chips; a time window; honest score name | 2 |
| **Insights page** | Work type per session with ✓ / Change; blind questions; persona card; renamed labels | 1, 2 |
| **Dashboard / Profile** | Persona chip and titles held; privacy and labelling toggles | 2 |
| **Notifications** | "You won / lost a title" | 2 |
| **Backend data** | New `Session` and `GroupTitle` collections; persona stored in `UserInsights` | 1, 2 |
| **Backend logic** | 18 session attributes; work-type rules replace the old archetypes; persona and title services | 1, 2 |
| **Scheduled jobs** | Nightly session snapshot; weekly titles | 1, 2 |
| **ML pipeline** | Export script, training notebook, JSON model, JavaScript inference | 3 |
| **Extension** | Optional: report every file touched in an upload, not just the active one | 1 (optional) |


## Phase 0 — Fix first

### C-01. Cap hours per 10-minute record (IMPROVEMENT_PLAN H-21)
- **Today:** `POST /api/extension/track` accepts up to 3600 s per upload, the limiter allows 120 uploads
  a minute, the batch route has no item limit, and `$inc: { duration }` in `services/activityBucket.js`
  never caps a 10-minute record. Anyone with their own API key and a script can add hundreds of hours.
- **Change:** before the upsert, sum the duration the user already has stored for that `bucketStart`
  (across all their projects and languages) and add only what still fits under 600 s. Cap the batch route
  at, for example, 50 items.
- **Trap:** a legitimate offline upload can cover an hour. The extension merges queued flushes and
  stamps the merged payload with its start time, so the whole hour lands in one 10-minute record. That time
  must be **spread across the 10-minute records it covers**, not cut to 10 minutes.
- **Why it matters for ML:** fake hours would corrupt training data, personas and group titles.
- **Files:** `backend/services/activityBucket.js`, `backend/routes/extension.js`,
  `backend/tests/activityBucket.test.js`, `backend/tests/ingest.test.js`. **~2 h.**

### C-02. Stop showing member emails in groups (IMPROVEMENT_PLAN M-28)
- **Today:** `GET /api/groups/:groupId/details` returns `email` for every member and every leaderboard
  row, and `Groups.tsx` renders it (lines 576 and 630). Anyone can join a public group and read everyone's
  address. This is the same leak M-23 fixed on the global leaderboard.
- **Change:** drop `email` from the populate projections and both response arrays; stop rendering it.
- **Why now:** Phase 2 adds more member information to this page.
- **Files:** `backend/routes/groups.js`, `frontend/src/pages/Groups.tsx`, a test in
  `backend/tests/quickWins.test.js`. **~1 h.**

### C-03. Launch blockers and users
Already recorded and out of scope here, but required before any data exists: H-19 (login on
Safari / iOS / Firefox), H-20 (campus rate limits), M-25 to M-27, and the landing page. Target: 10+
people coding with extension 2.4.0.


## Phase 1 — Work types, rules only

### C-04. Save sessions: new `Session` collection
- **Why:** sessions are rebuilt from raw records on every page load and then thrown away. A label
  needs something to attach to, training needs saved attributes, and group titles cannot re-derive every
  member's sessions on each page view (the H-8 scan problem).
- **Schema** (`backend/models/Session.js`):

  ```js
  {
    userId: String,            // String, matching Activity.userId
    startAt: Date, endAt: Date,
    activeMinutes: Number,
    projects: [String], languages: [String],
    featureVersion: Number,    // 1 for the 18 attributes below
    features: Object,          // the 18 numbers
    workType: { value: String, probability: Number, by: String }, // by: 'rules-v1' | 'model-v1'
    userLabel: { value: String, blind: Boolean, labelledAt: Date } // absent until confirmed
  }
  // index: { userId: 1, startAt: -1 }, unique
  ```
- **When sessions are saved:** only sessions that ended **more than 24 hours ago**, because an offline
  upload can be backdated up to 24 h (`MAX_BACKDATE_MS`) and extend a session. Newer sessions stay
  computed live. The snapshot runs in the existing nightly job (`POST /api/internal/run-rollup`, 03:30
  UTC), so no new cron entry is needed.
- **Files:** `backend/models/Session.js` (new), `backend/services/sessionSnapshot.js` (new),
  `backend/routes/internal.js`, `backend/tests/sessionSnapshot.test.js` (new). **~6 h.**

### C-05. The 18 attributes
- **Today:** `collapseByBucket()` in `services/sessionize.js` sums only part of each record, and
  `featureVector()` returns 12 values.
- **Change:** also collect `editorAnalytics.charsInserted`, `editorAnalytics.largeInsertChars`,
  `terminalAnalytics.commandUsage.*`, `terminalAnalytics.testRuns` (already summed) and the bucket's
  `files[]` list, and add them to `SESSION_PROJECTION` in `services/metricsService.js`. Then compute
  `featureVector` version 2 with the 18 attributes of ML plan section 8.
- **File-name hints** live in a new pure module with their own tests: `problemFileShare` (patterns like
  `two_sum.cpp`, `q3.py`, `A.cpp`, `1234.java`), `configFileShare` (`package.json`, `Dockerfile`,
  `*.yml`, `.env`, `requirements.txt`, `tsconfig.json`…), `practiceFolder` (project name contains
  `leetcode`, `codeforces`, `codechef`, `gfg`, `hackerrank`, `atcoder`, `dsa`, `cp`). Raw names never
  leave this module.
- **Files:** `backend/services/sessionize.js`, `backend/services/metricsService.js`,
  `backend/services/fileNameHints.js` (new), `backend/tests/sessionize.test.js`,
  `backend/tests/fileNameHints.test.js` (new). **~5 h.**

### C-06. Work-type rules v1 replace the old archetypes
- **Today:** `classify()` returns `debug-grind`, `admin-config`, `exploration`, `deep-build`, `mixed`
  or `unclassified`, with no DSA category, and `g++` failures count as debugging.
- **Change:** a new `services/workType.js` with rules checked in this order:

  | Order | Work type | Rule sketch |
  |---|---|---|
  | 1 | *Not enough activity* | under 5 active minutes, or no edits and no commands (today's guard) |
  | 2 | DSA practice | `practiceFolder`, **or** `problemFileShare ≥ 0.5` with `filesTouched ≤ 3`, no commits, `packageShare < 0.2` |
  | 3 | Setup & config | `packageShare ≥ 0.5` or `configFileShare ≥ 0.5`, with under 10 lines edited |
  | 4 | Debugging | debug sessions, or `buildFailRatio ≥ 0.5`, with under 4 lines per minute |
  | 5 | Learning & exploring | `readRatio ≥ 0.7`, under 2 lines per minute, `switchesPerMin ≥ 0.3` |
  | 6 | Project building | at least 1 line per minute and (`commitsPerHour > 0` or `filesTouched ≥ 3`) |
  | 7 | *Not sure* | nothing matched |

  DSA is checked **before** debugging, so a compile-error loop on a practice problem stays DSA.
  Old names map across: `deep-build` → Project building, `debug-grind` → Debugging, `exploration` →
  Learning, `admin-config` → Setup, `mixed` → Not sure, `unclassified` → Not enough activity.
  Each result keeps a plain reason ("2 files named like practice problems, no commits").
- **Files:** `backend/services/workType.js` (new), `backend/services/sessionize.js` (`classify` and
  `archetypeMix` delegate), `backend/tests/workType.test.js` (new), `docs/RULES_ENGINE.md`,
  `docs/INSIGHTS_METRICS.md`. **~5 h.**

### C-07. Labels API
- `GET /api/sessions?days=30` — the signed-in user's sessions with work type, probability, reason and
  label.
- `PUT /api/sessions/label` with body `{ startAt, workType, blind }` — rebuilds that user's session
  containing `startAt`, takes a snapshot of its attributes, and upserts the `Session` with `userLabel`.
- The user comes from the session cookie only; there is no `:userId` parameter, the same pattern as
  `routes/metrics.js`, so nobody can label or read another person's sessions. Validate `workType` against
  the five names; rate limit like `/api/analytics`.
- **Files:** `backend/routes/sessions.js` (new), `backend/app.js` (mount), `backend/tests/routeGuards.test.js`,
  `backend/tests/sessionsRoute.test.js` (new). **~4 h.**

### C-08. Insights page
- Each row of "How you worked" shows the work type, the reason on hover, and **✓ / Change**.
- On a random 20% of prompts, and always for *Not sure*, the row asks "What was this session?" with
  **no guess shown** and saves `blind: true`.
- Rename *Too short to classify* → **Not enough activity** and *Mixed* → **Not sure**.
- The chips above the list show the work-type mix ("DSA practice: 9 sessions, 4 h").
- **Files:** `frontend/src/pages/Insights.tsx` (the session list is already there; its label map is at
  lines 38–39). **~5 h.**

### C-09. Extension: every file touched (optional, extension 2.5.0)
- **Today:** each upload sends only `path.basename` of the file active at upload time, so
  `filesTouched` undercounts.
- **Change:** `editorTracker` already collects the paths behind its `uniqueFiles` count. Send their
  basenames, capped at 20 per upload, and store them with `$addToSet` like `files` today. Basenames only, the same privacy level as
  now.
- **Files:** `extension/src/editorTracker.ts`, `extension/src/extension.ts`,
  `backend/services/activityBucket.js`, `backend/services/ingestValidation.js`, tests on both sides.
  **~3 h.** Publishing stays a manual step.


## Phase 2 — Personas and group titles

### C-10. Persona service
- A pure `services/persona.js` implementing the table in ML plan section 12. It is computed weekly and
  stored on the existing `UserInsights` document (new fields `persona`, `personaMix`, `personaComputedAt`),
  which already caches per-user insights.
- Returned from `GET /api/metrics` as `persona: { name, mix, sessions, minutes }`.
- **Files:** `backend/services/persona.js` (new), `backend/models/UserInsights.js`,
  `backend/services/metricsService.js`, `backend/tests/persona.test.js` (new). **~4 h.**

### C-11. Weekly group titles
- **New collection** `GroupTitle`: `{ groupId, weekStart, workType, userId, minutes, sessions }`, unique
  on `{ groupId, weekStart, workType }`. Stored rather than recomputed, so there is a history and a
  notification is never sent twice.
- **Rule:** for each work type, the member with the most minutes in the previous week wins; at least 60
  minutes of that type and at least 3 active members in the group; ties go to more sessions. Weeks run
  Monday to Sunday in IST, one fixed timezone for all groups.
- **Job:** `POST /api/internal/run-weekly-titles` (same `INTERNAL_CRON_SECRET` guard), plus a new
  schedule `30 18 * * 0` in `.github/workflows/cron.yml` (Sunday 18:30 UTC = Monday 00:00 IST).
- **Files:** `backend/models/GroupTitle.js` (new), `backend/services/groupTitles.js` (new),
  `backend/routes/internal.js`, `.github/workflows/cron.yml`, `backend/tests/groupTitles.test.js` (new).
  **~5 h.**

### C-12. Groups page
- **Today:** a single all-time board sorted by hours, with lines, commits, failed commands and failed
  builds per member (`GET /api/groups/:groupId/details`).
- **Changes:**
  1. A **"This week's titles"** strip at the top ("DSA Warrior of CSE-Gang: Riya, 5 h").
  2. **Board tabs:** Hours · DSA · Projects · Debugging · Learning · Setup, each ranking by minutes of
     that type.
  3. A **window selector** (This week · 30 days · All time); today the board is all-time only.
  4. A **persona chip** on each member row, unless that member hid it.
  5. A **group mix bar** ("this group: 45% DSA · 30% projects · …").
  6. Type boards read from the `Session` collection (updated nightly, labelled as such) instead of
     scanning every raw record, which also eases H-8.
- **API:** `GET /api/groups/:groupId/details?days=7&type=dsa`, and the response gains `titles` and
  `mix`.
- **Files:** `backend/routes/groups.js`, `frontend/src/pages/Groups.tsx`. **~5 h.**

### C-13. Global leaderboard
- **Today:** every user ranked by all-time hours, with relative 0–5 scores: `speed` (commits),
  `quality` (lines added + removed), `engagement` (hours), `impact` (net lines) and `overall`.
- **Changes:**
  1. The same **work-type tabs** as groups, ranking by minutes of that type in the window.
  2. **Persona chip** per row, honouring the privacy toggle.
  3. A **default window** of 30 days for the type tabs; the route already accepts `?days=`.
  4. Rename the API field `quality` to `volume` (with a one-release alias): it counts lines changed,
     which is volume, not quality. The page already labels it "Line Changes", so nothing visible changes.
  5. Only capped time (C-01) counts.
- **API:** `GET /api/leaderboard?days=30&type=project`.
- **Files:** `backend/routes/leaderboard.js`, `frontend/src/pages/Leaderboard.tsx`,
  `backend/tests/leaderboardScore.test.js`. **~4 h.**

### C-14. Dashboard, Profile and privacy
- **Dashboard:** a persona chip and "titles you hold this week".
- **Profile:** two toggles stored on `User`:
  - `showPersona` (default on): show my persona and titles to others. When off, the person still
    appears on boards but without a chip, and cannot win titles.
  - `labelPrompts` (default on): ask me to confirm sessions.
- **Files:** `backend/models/user.js`, `backend/routes/user.js`, `frontend/src/pages/Dashboard.tsx`,
  `frontend/src/pages/Profile.tsx`. **~3 h.**

### C-15. Notifications
- **Today:** `Notification.goalId` is required and `type` allows only `deadline_reminder`,
  `deadline_missed` and `goal_completed`.
- **Change:** make `goalId` optional, add an optional `groupId`, and add the types `title_won` and
  `title_lost`, sent by the weekly job ("You're this week's DSA Warrior of CSE-Gang").
  `checkOverdueGoals()` looks up by `{ goalId, type }` and is unaffected.
- **Files:** `backend/models/Notification.js`, `backend/services/groupTitles.js`,
  `frontend/src/components/NotificationPanel.tsx` (icons for the new types). **~2 h.**


## Phase 3 — Train and serve the model

### C-16. Export script
- `ml/export_sessions.js` reads `Session` documents that have a `userLabel` and writes a CSV: the 18
  attributes, the label, `blind`, the current rule prediction, and a **random per-export person id**. It
  never includes names, emails, file names or project names.
- **~3 h.**

### C-17. Training notebook
- `ml/train_work_type.ipynb` with `ml/requirements.txt` (scikit-learn, pandas):
  1. Logistic regression and a depth-4 decision tree, classes weighted.
  2. `GroupKFold` by person, 5 folds.
  3. Per-type precision, recall and F1; macro-F1; a confusion table.
  4. The rules scored on the same **blind** labels.
  5. Per-person and per-language breakdowns.
  6. The ship gate from ML plan section 11.
- Writes `backend/ml/workTypeModel.json`: `{ version, trainedAt, labelCount, people, features[],
  means[], stds[], classes[], weights[][], bias[], scores }`.
- `ml/README.md` records every training run's scores, including runs that failed the gate.
- **~8 h.**

### C-18. JavaScript inference
- `backend/services/workTypeModel.js`: standardise → weights × attributes + bias → softmax → best type;
  under 50% → *Not sure*. It also returns the two attributes that contributed most, for the "why" text.
- `services/workType.js` uses the model when the JSON exists and passed the gate, and falls back to
  rules v1 otherwise. `Session.workType.by` records which one labelled each session.
- **Parity test:** 20 fixture sessions whose Python probabilities are stored in the repo; JavaScript must
  match them within 1e-6. This catches a wrong attribute order, which would otherwise fail silently.
- **Files:** `backend/services/workTypeModel.js` (new), `backend/ml/workTypeModel.json` (new),
  `backend/tests/workTypeModel.test.js` (new), `backend/tests/fixtures/workTypeParity.json` (new).
  **~6 h.**

### C-19. Ask where the model is least sure
- The blind "What was this?" prompts go first to sessions whose best probability is lowest, which are
  the answers that teach the model the most. Keep a random share too, so the test set stays unbiased.
- **Files:** `backend/routes/sessions.js`, `frontend/src/pages/Insights.tsx`. **~3 h.**


## Phase 4 — Discovery (optional)

### C-20. k-means over uncertain sessions
- `ml/discover_clusters.ipynb` clusters the 8 style attributes of *Not sure* sessions, after filtering
  empty ones; picks k with elbow and silhouette; a person reviews each cluster for a missing work type.
  Nothing is served from this step.
- **~6–8 h.**


## Tests to add

| Test file | Covers |
|---|---|
| `activityBucket.test.js`, `ingest.test.js` | 10-minute cap; batch limit (C-01) |
| `quickWins.test.js` | no email in group details (C-02) |
| `sessionSnapshot.test.js` | only sessions older than 24 h saved; re-runs are idempotent (C-04) |
| `fileNameHints.test.js` | practice, config and folder patterns; no raw names in output (C-05) |
| `sessionize.test.js`, `workType.test.js` | 18 attributes; rule order; DSA compile loop stays DSA (C-05, C-06) |
| `sessionsRoute.test.js`, `routeGuards.test.js` | labels only for your own sessions; invalid work type rejected (C-07) |
| `persona.test.js` | every persona row, *Warming up*, *All-rounder* (C-10) |
| `groupTitles.test.js` | 60-minute and 3-member minimums; ties; no duplicate notifications (C-11, C-15) |
| `leaderboardScore.test.js` | type tabs; `volume` alias (C-13) |
| `workTypeModel.test.js` | JavaScript matches Python within 1e-6; *Not sure* below 50%; rules fallback (C-18) |


## Docs to update when this is built

`docs/RULES_ENGINE.md` and `docs/INSIGHTS_METRICS.md` (work types replace archetypes),
`docs/ARCHITECTURE.md` (Session and GroupTitle collections, weekly job, ML pipeline),
`CODETRACKR_PROJECT_CONTEXT.md`, the interview preparation set, and the status line at the top of
`docs/ML_INTEGRATION_PLAN.md`.


## Effort summary

| Phase | Changes | Time |
|---|---|---|
| 0. Fix first | C-01, C-02 (C-03 tracked elsewhere) | ~3 h |
| 1. Work types, rules only | C-04 to C-08, optional C-09 | ~25 h (+3 h optional) |
| 2. Personas and group titles | C-10 to C-15 | ~23 h |
| 3. Train and serve | C-16 to C-19 | ~20 h |
| 4. Discovery | C-20 | ~6–8 h |
| **Total** | | **~77–82 h**, plus the data-collection period |

These are estimates, not measurements.
