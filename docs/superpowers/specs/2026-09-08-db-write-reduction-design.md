# CodeTrackr — Database Write-Reduction: Design Spec

**Date:** 2026-09-08
**Branch:** `feat/security-and-insights` (work continues here; a dedicated branch is optional)
**Status:** Approved (sectioned design approved in chat 2026-09-08)
**Source doc:** `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md`

---

## 1. Goal

Cut the number and size of documents written to the `activities` collection, without
changing any analytics total. Deliver levers **#3** (bucket-on-write), **#2** (skip empty
flushes), **#4** (sparse sub-documents + drop the dead `date` field), **#6** (daily rollup +
safety TTL), and **#1** (flush-cadence default as a knob).

**Non-goal (explicit follow-up):** repointing the all-time reads (`/api/leaderboard`,
`/api/analytics/summary/:userId`, `/api/metrics` beyond 90 days) at `DailySummary`, and
tightening the TTL. That is bundled with the `UserStats` rollup (Quick Wins #9).

---

## 2. Correctness invariant (the thing that must not break)

`duration` on every document is **real measured active-coding seconds** reported by the
extension. Bucketing does `$inc: { duration: <real seconds> }` — it never writes `600`.
`bucketStart` is a grouping key / timestamp only, never an input to an hours calculation.

Therefore, after this change:

- `totalHours`, `totalLinesAdded`, daily totals, weekly totals, streak days, leaderboard
  hours, and every metric in `metricsService` are **byte-for-byte the same numbers**, because
  they are all `$sum` / `.reduce` over the same `duration` / line values, just held in fewer
  rows.
- The only behavioural change is **time-of-day resolution**: every event in a 10-minute
  bucket is stamped `bucketStart`, so the hourly chart and the 10-minute drill-down attribute
  a bucket's activity to the start of its slot. Maximum smear at a bucket boundary is
  `minFlushMinutes`. **No total is affected.**
- If lever #2 is active, genuinely signal-less intervals stop contributing their `duration`
  at all — this *reduces* total hours slightly toward the honest number (fixes the existing
  "idle < 2 min counts as coding" skew, L-7). This is intended.

---

## 3. Data model — `backend/models/Activity.js`

### 3.1 New fields

| Field | Type | Notes |
|---|---|---|
| `bucketStart` | `Date` | 10-minute-floored timestamp. Present only on bucketed docs. Legacy per-flush docs do not have it. |
| `files` | `[String]` | De-duplicated file basenames merged into this bucket. Keeps `/timeslot` `fileCount` working. |
| `flushCount` | `Number` | How many flush payloads merged into this doc. Defaults to `1` on read for legacy docs (`$ifNull`). |

### 3.2 Sparse sub-documents

Remove the leaf `default: 0` from every field in `terminalAnalytics`, `editorAnalytics`,
`focusAnalytics`, `gitAnalytics`. Mongoose `minimize` (on by default) then drops an empty
sub-object on write. The ingest route only adds a sub-object's `$inc` paths for the **non-zero
leaves present in that flush**, so a bucket that never saw git activity never grows a
`gitAnalytics` key. `repeatedFailedCommands` and the `commandUsage` / `gitActivity` maps keep
their shapes but their leaves lose defaults too.

All read paths already tolerate missing sub-objects (`a.terminalAnalytics || {}`,
`Number(x) || 0`, `$ifNull`). No read change needed for sparseness.

### 3.3 Drop `date`

- Remove the `date` field from the schema.
- Remove `activitySchema.index({ userId: 1, date: -1 })`.
- Verified: no production read queries `date`. The `date:` tokens in `analytics.js` /
  `metricsService.js` are the `$dateToString` / `$subtract` **operator parameter**, which
  references `$timestamp`. Only dev/seed scripts (`add-dummy-data.js`, `cleanup-data.js`,
  `seed-demo-insights.js`, `tools/*`) touch a `date` field — those are out of scope; fix
  `seed-demo-insights.js` to stop writing it, leave the rest.

### 3.4 Indexes — final state on `activities`

| Index | Purpose | Change |
|---|---|---|
| `{ userId: 1 }` | field-level | keep |
| `{ userId: 1, timestamp: -1 }` | the range queries every read actually does | **ADD** |
| `{ userId: 1, projectName: 1, language: 1, bucketStart: 1 }` unique, `partialFilterExpression: { bucketStart: { $exists: true } }` | race-safe bucket merge | **ADD** |
| `{ userId: 1, projectName: 1 }` | goal progress, group leaderboard | keep |
| `{ userId: 1, language: 1 }` | goal progress (`Activity.find({userId, language})`) | keep |
| `{ userId: 1, date: -1 }` | (nothing) | **DROP** |
| `{ createdAt: 1 }`, `expireAfterSeconds: 60*60*24*400` | safety TTL (400 days) | **ADD** |

### 3.5 Migration — `backend/scripts/migrate-drop-date.js`

Dry-run by default; `--apply`. Steps:
1. `collection.dropIndex('userId_1_date_-1')` (ignore "index not found").
2. `Activity.updateMany({ date: { $exists: true } }, { $unset: { date: '' } })` in batches.
3. Print before/after counts.

Mongoose auto-creates the new indexes on model load (`autoIndex` default true). The partial
unique index builds cleanly because zero existing docs have `bucketStart`.

---

## 4. New pure service — `backend/services/activityBucket.js`

Dependency-free (no mongoose, no express). Unit-tested like `activityNormalizers.js`.

```
BUCKET_MS = 600000                              // 10 minutes, module constant

bucketStartFor(when: Date|number, bucketMs = BUCKET_MS): Date
  // new Date(Math.floor(t / bucketMs) * bucketMs)

hasSignal(normalized): boolean
  // true if any of:
  //   editor.charsInserted|charsDeleted|saveCount > 0
  //   terminal.totalCommands > 0
  //   git.commits > 0
  //   focus.flowBlocksMs.length > 0
  //   editor.linesInserted|linesDeleted > 0   (belt-and-suspenders)

buildBucketUpdate(normalized, fileName): object
  // returns the update doc for findOneAndUpdate:
  //   $setOnInsert: { userId, projectName, language, bucketStart,
  //                   timestamp: bucketStart, fileType }
  //   $inc: { duration, linesAdded, linesRemoved, flushCount: 1,
  //           ...only the non-zero analytics leaves from this flush,
  //              as dotted paths e.g. 'editorAnalytics.churnLines': 12,
  //              'terminalAnalytics.commandUsage.git': 2,
  //              'gitAnalytics.commits': 1, 'focusAnalytics.focusedMs': 84000 }
  //   $max: { 'focusAnalytics.longestBlockMs': <n> }   (omit if 0)
  //   $push: { 'focusAnalytics.flowBlocksMs': { $each: [...], $slice: -200 } }  (omit if empty)
  //   $addToSet: { files: fileName }   (omit if fileName falsy/'unknown')
  //   $set: { 'terminalAnalytics.lastCommand': ..., 'terminalAnalytics.lastCommandTimestamp': ...,
  //           'terminalAnalytics.repeatedFailedCommands': [...] }   (last-writer-wins; only if present)

bucketFilter(userId, projectName, language, bucketStart): object
  // { userId, projectName, language, bucketStart }
```

Rate fields (`successRate`, `buildSuccessRate`) are **not** stored per bucket — the read side
(`buildTerminalSummary` in `analytics.js`) already recomputes them from summed
successful/total. Leave them out of the update.

---

## 5. Ingest route — `backend/routes/extension.js`

### 5.1 Config

```
const BUCKET_MS = Number(process.env.ACTIVITY_BUCKET_MS ?? 600000);
// BUCKET_MS === 0  -> legacy path: Activity.create(...) exactly as today (rollback lever)
```

### 5.2 `POST /track`

```
normalize terminal/editor/focus/git as today
when       = parsed timestamp || now  (existing NaN guard)
if BUCKET_MS === 0:  Activity.create({...today...}); return 201
bucketStart = bucketStartFor(when, BUCKET_MS)
filter      = bucketFilter(userId, projectName, language, bucketStart)

if hasSignal(payload):
  update = buildBucketUpdate(payload, fileName)
  try:
    doc = await Activity.findOneAndUpdate(filter, update, { upsert: true, new: true })
  catch e if e.code === 11000:            // upsert insert race
    doc = await Activity.findOneAndUpdate(filter, stripSetOnInsert(update), { new: true })
  return 201 { success: true, bucket: { id: doc._id, bucketStart, duration: doc.duration, flushCount: doc.flushCount } }
else:
  r = await Activity.updateOne(filter, { $inc: { duration: Number(duration), flushCount: 1 } }, { upsert: false })
  return 202 { success: true, merged: r.matchedCount > 0 }
```

Validation stays as today (`fileName && language && duration`). `projectName` / `language`
fall back to `'Unknown Project'` / the payload value exactly as today, so the bucket key is
always defined.

### 5.3 `POST /track/batch`

Group `activities` by `(bucketStartFor(ts), projectName, language)` in JS, fold each group
into one `buildBucketUpdate` (summing leaves), issue one `findOneAndUpdate` per group. Still
`verifyApiKey`. Unused by the shipped extension; keep it simple and correct.

### 5.4 `GET /verify`

Unchanged.

### 5.5 Exports

Export `buildBucketUpdate`, `hasSignal`, `bucketStartFor` re-exports for the route test (mirror
the existing `module.exports.normalizeEditorAnalytics = ...` pattern).

---

## 6. Extension — `extension/`

### 6.1 `src/extension.ts`

- Add `payloadHasSignal(payload)` — mirrors backend `hasSignal` over the built payload shape.
- Refactor: `buildPayload(durationSeconds, fileOpened)` is called **inside `flushIfNeeded`**
  (currently it's inside `sendActivity`). `sendActivity` becomes `sendActivity(payload)`.
- In `flushIfNeeded(force)`: after building the payload, `if (!force && !payloadHasSignal(payload)) return;`
  **without** resetting `state.startedMs` / `state.bufferedMinutes` — the accrued time carries
  to the next flush.
- The idle-pause branch in the `setInterval` that calls `sendActivity(activeDurationMin, ...)`
  directly: build its payload and apply the same guard (a real active stretch has signal, so
  this rarely triggers).
- `deactivate()` final flush uses `force = true` → always sends the tail.

### 6.2 `getCfg()` + manifest

- `minFlushMinutes` fallback: `0.5` → `2`. Keep `Math.max(0.1, minFlushMinutes)`.
- `extension/package.json` → `contributes.configuration.properties['codetrackr.minFlushMinutes'].default`: `0.5` → `2`, description updated ("Minimum minutes of active coding before a record is sent. Higher = fewer, coarser records.").

### 6.3 Version + packaging

- `extension/package.json` `"version"`: `2.2.0` → `2.3.0`.
- `extension/CHANGELOG.md`: `## [2.3.0]` entry — skip-empty-flush, `minFlushMinutes` default 2,
  note that the backend now merges flushes into 10-minute records.
- `npm run build` in `extension/` regenerates `dist/extension.js` (typecheck + esbuild).
- Regenerate the committed `.vsix` at 2.3.0 (`npm run package`), replacing
  `codetrackr-vscode-2.2.0.vsix`. **Do not run `vsce publish`** — the user publishes when ready.

### 6.4 Tests — `extension/tests/`

- `activation.test.js`: assert `payloadHasSignal` is exported and returns `false` for a
  zero payload / `true` after a simulated edit; assert
  `MANIFEST.contributes.configuration.properties['codetrackr.minFlushMinutes'].default === 2`.
- `trackers.test.js`: unchanged.
- `pretest` runs `npm run build`, so tests exercise the real bundle.

---

## 7. Daily rollup + safety TTL — `#6`

### 7.1 `backend/models/DailySummary.js`

```
{
  userId: String (indexed),
  day: String,                       // 'YYYY-MM-DD', UTC
  totalSeconds: Number,
  totalLinesAdded: Number,
  totalLinesRemoved: Number,
  flushCount: Number,
  bucketCount: Number,               // raw docs rolled up
  languages: [{ language: String, seconds: Number }],
  projects: [String],
  editor:   { charsInserted, charsDeleted, linesInserted, linesDeleted, churnLines,
              undoCount, redoCount, saveCount, fileSwitches, readMs, writeMs },
  terminal: { totalCommands, successfulCommands, failedCommands, buildRuns, testRuns,
              successfulBuilds, failedBuilds, debuggingSessions },
  git:      { commits, filesChanged },
  focus:    { focusedMs, blurredMs, longestBlockMs, deepBlockCount, blockCount },
  rolledAt: Date
}
unique index { userId: 1, day: 1 }
```

### 7.2 `backend/services/dailySummary.js` (pure)

`buildDaySummary(userId, day, rawDocs)` → a `DailySummary`-shaped object. Pure, unit-tested:
fed a list of fake activity docs (bucketed and/or legacy), returns correct totals, language
breakdown (sum seconds per language), project set, no double-count. This is the logic the
script and its test share.

### 7.3 `backend/scripts/rollup-daily.js`

- Args: `--apply` (default dry-run), `--before <days>` (default `2` — only roll UTC days that
  ended ≥ N days ago), `--force` (re-roll already-summarised days).
- For each distinct `(userId, UTC day)` in `activities` older than the cutoff and not already
  in `DailySummary` (unless `--force`):
  - `Activity.aggregate` `$group` → feed into `buildDaySummary` → `DailySummary.updateOne({ userId, day }, { $set: summary }, { upsert: true })`.
- Idempotent (`$set`, re-runnable). **Does not delete raw activity.**
- Dry-run prints: days found, users affected, sample summary.

### 7.4 Scheduling

Add to `backend/services/notificationScheduler.js` `initScheduler()`:
`cron.schedule('30 3 * * *', () => runRollup())` where `runRollup` calls the same code path
as the script's `--apply --before 2`. Inherits the existing serverless caveat (H-13) —
documented, not fixed here.

### 7.5 TTL

Section 3.4 adds `{ createdAt: 1 }` TTL at **400 days**. Purely a safety net so the collection
can't grow forever unbounded; it does not gate any current read (max read window is
`metrics ?days=365`, and even that is < 400). Tightening it is the documented follow-up.

---

## 8. Read-path touch-ups

| File | Change |
|---|---|
| `backend/routes/analytics.js` `/timeslot/:userId` | `fileCount = new Set(activities.flatMap(a => (a.files && a.files.length) ? a.files : (a.fileName ? [a.fileName] : []))).size` |
| `backend/routes/leaderboard.js` | `$group` field `activityCount: { $sum: 1 }` → `{ $sum: { $ifNull: ['$flushCount', 1] } }` so the count stays flush-based across legacy + bucketed docs |
| everything else (`analytics` daily/weekly, `metricsService`, `computeStreak`, `/summary`, group leaderboard, goal progress) | **no change** — all `$sum` / `.reduce` / `$ifNull`, correct over merged docs |

---

## 9. Tests

### New

- `backend/tests/activityBucket.test.js`
  - `bucketStartFor`: floors to boundary; `bucketStartFor(t)` is a multiple of `BUCKET_MS`;
    two times 3 min apart in the same window map to the same bucket; a time on the boundary
    maps to itself.
  - `hasSignal`: all-zero → `false`; one `charsInserted` → `true`; one `totalCommands` →
    `true`; one flow block → `true`.
  - `buildBucketUpdate`: `$inc` has `duration`, `flushCount: 1`, and only the non-zero leaves;
    **no `gitAnalytics.*` paths when git is empty**; `$max` present iff `longestBlockMs > 0`;
    `$push` has `$slice: -200`; `$addToSet.files` present iff a real filename; two calls
    summed give the same `$inc` values as one call with the summed input.
- `backend/tests/rollup.test.js`
  - `buildDaySummary` over a fixed list of fake docs (some bucketed, some legacy-shaped):
    correct `totalSeconds`, per-language seconds, project set, `bucketCount`, no double-count;
    empty input → zeroed summary.

### Extend

- `backend/tests/ingest.test.js`: a normalized empty payload → `hasSignal` returns `false`;
  a normalized payload with one edit → `true`.
- `backend/package.json` `test` script: append `&& node tests/activityBucket.test.js && node tests/rollup.test.js`.
- `extension/tests/activation.test.js`: as section 6.4.

### Must stay green

`streak`, `metrics`, `authorization`, `routeGuards`, `passwordHash` (backend);
`trackers` (extension). `routeGuards` still passes — the routes keep `verifyApiKey`.

### Not done

No DB integration test (`supertest` + `mongodb-memory-server`). Consistent with the repo; the
logic is in pure helpers. Recorded as a gap.

---

## 10. Docs to update

| File | Update |
|---|---|
| `CODETRACKR_PROJECT_CONTEXT.md` | §7 (bucketed writes, sparse sub-docs, dropped `date`, new indexes, `DailySummary`, TTL), §8 (`/track` now upserts), §9 (extension 2.3.0, skip-empty, `minFlushMinutes` 2), §17 (revise "one doc per flush", soften idempotency line, add "all-time reads not yet repointed"), §19 (status) |
| `docs/IMPROVEMENT_PLAN.md` | Mark write-volume items; add the follow-up (tighten TTL + repoint all-time reads at `DailySummary`, bundled with UserStats) |
| `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md` | "Implemented 2026-09-08" banner: what shipped (#3/#2/#4/#6/#1), what's follow-up |
| `docs/interview-preparation/CodeTrackr_Interview_Preparation.md` | §D1, §5, §21, §24 — replace "one Activity doc per flush" with the bucketed model |
| `docs/interview-preparation/CodeTrackr_Interview_Cheat_Sheet.md` | "Data flow" + "Database" sections — bucketed writes |
| `docs/interview-preparation/CODETRACKR... Architecture.md` | ingest data-flow diagram note |
| `docs/SESSION-LOG-2026-08-27.md` | append a `## 9. DB write-reduction` section |
| memory: `codetrackr-overview.md` | one line |

---

## 11. Known limitations to record (not fix)

1. Time-of-day precision is now the 10-minute grid; ≤ `minFlushMinutes` smear at bucket
   boundaries. **No total affected.**
2. Buckets align to 10-minute marks from the Unix epoch (= UTC midnight). Timezones whose
   offset is a multiple of 10 min (most, incl. IST +5:30) align to local midnight; the
   +5:45 / +8:45 offsets can attribute a boundary sliver to the adjacent local day in the
   daily view. Bounded by `minFlushMinutes`; totals unaffected.
3. `repeatedFailedCommands` per bucket is last-writer-wins (the dashboard panel that shows it
   is hard-coded mock data anyway — Quick Win #8).
4. All-time reads (`/leaderboard`, `/summary`, `/metrics >90d`) still scan raw `activities`.
   Not repointed at `DailySummary`. The 400-day TTL is a safety net only.
5. The daily rollup runs via in-process `node-cron` → same serverless caveat as the
   notification job (H-13).
6. Legacy per-flush documents remain un-bucketed and coexist; reads aggregate both. No
   backfill.
7. No DB integration test.
8. `leaderboard` "activityCount"/"commits" now counts flushes via `flushCount` (was raw doc
   count). Still not real git commits — unchanged limitation, slightly more accurate.

---

## 12. Verification checklist

- [ ] `cd backend && npm test` — 8 suites green (6 existing + `activityBucket` + `rollup`)
- [ ] `cd extension && npm run build && npm test` — green
- [ ] `node --check` on every changed backend file
- [ ] `node backend/scripts/rollup-daily.js` (dry-run) prints a sane plan
- [ ] `node backend/scripts/migrate-drop-date.js` (dry-run) prints a sane plan
- [ ] Hand-trace: feed `buildBucketUpdate` three fake flushes in one window → summed
      `duration` equals the sum of the three real durations (not 1800), `bucketStart` is the
      window start, `flushCount` is 3
- [ ] Grep confirms no remaining production read of `Activity.date`
- [ ] `ACTIVITY_BUCKET_MS=0` path still does a plain `Activity.create`
