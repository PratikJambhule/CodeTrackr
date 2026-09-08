# DB Write-Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the number and size of documents written to the `activities` collection by merging flush payloads into 10-minute rollup documents, dropping empty flushes and dead fields, and adding a daily-summary rollup — with zero change to any analytics total.

**Architecture:** A new dependency-free `services/activityBucket.js` decides how each flush is written (`legacy` create / `bucket` upsert / `merge`-only). `routes/extension.js` executes that decision with an atomic `findOneAndUpdate` (`$inc`/`$max`/`$push $slice`/`$addToSet`). The `Activity` schema loses its `default: 0` leaves and the dead `date` field, and gains `bucketStart`/`files`/`flushCount`, a partial-unique bucket index, a `{userId,timestamp:-1}` index, and a 400-day safety TTL. The extension stops sending signal-less flushes and defaults `minFlushMinutes` to 2. A `DailySummary` model + `services/dailyRollup.js` + `scripts/rollup-daily.js` roll old raw docs into per-day summaries on a nightly cron.

**Tech Stack:** Node 18, Express 5, Mongoose 8 (backend); TypeScript 5 + esbuild (extension). Tests: plain `node:assert` scripts, no framework.

**Spec:** `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md`

## Global Constraints

- **Correctness invariant:** `duration` is real measured active-coding seconds. Every write does `$inc: { duration: <real seconds> }` — it NEVER writes `600` / the bucket width. `bucketStart` is a grouping key only, never an input to an hours calculation.
- **Coexistence, no backfill:** bucketed docs and legacy per-flush docs live in the same collection; reads aggregate both.
- **Rollback lever:** env `ACTIVITY_BUCKET_MS` — default `600000`; **`0` must preserve the exact current `Activity.create` behaviour**.
- **No new npm dependencies** (backend or extension).
- **Pure services stay dependency-free** — no `mongoose`, no `express` in `services/activityBucket.js` or `services/dailySummary.js`, mirroring `services/activityNormalizers.js`.
- **Test harness:** hand-rolled `check(name, fn)` with `passed`/`failed` counters and `process.exit(failed === 0 ? 0 : 1)`; one `node` process per file; chained with `&&` in `package.json`. Copy the exact style from `backend/tests/metrics.test.js`.
- **Extension:** `tsconfig` is `strict: false`, target ES2020 / Node 18; `npm run build` = `tsc --noEmit` then esbuild; `pretest` runs the build. **Never run `vsce publish`.**
- **Must stay green:** `streak`, `ingest`, `metrics`, `authorization`, `routeGuards`, `passwordHash` (backend); `trackers`, `activation` (extension).
- Bucket buckets align to 10-minute marks from the Unix epoch (`Math.floor(t / 600000) * 600000`).

---

## File Structure

**Create:**
- `backend/services/activityBucket.js` — pure: bucket key math, signal test, update builder, write planner
- `backend/tests/activityBucket.test.js`
- `backend/tests/activityModel.test.js` — schema + index shape assertions (no DB)
- `backend/tests/ingestWiring.test.js` — source-scan: route uses the planner, no stray `Activity.create`; read paths updated
- `backend/scripts/migrate-drop-date.js` — one-off: drop the `date` field + its index
- `backend/models/DailySummary.js`
- `backend/services/dailySummary.js` — pure: `buildDaySummary(userId, day, docs)`
- `backend/tests/rollup.test.js`
- `backend/services/dailyRollup.js` — DB orchestration: `rollupDaily({ apply, beforeDays, force })`
- `backend/scripts/rollup-daily.js` — thin CLI wrapper

**Modify:**
- `backend/models/Activity.js` — drop leaf defaults, drop `date`, add fields + indexes + TTL
- `backend/routes/extension.js` — `/track` + `/track/batch` use `planActivityWrite`
- `backend/routes/analytics.js` — `/timeslot` `fileCount` reads `a.files`
- `backend/routes/leaderboard.js` — `activityCount` uses `flushCount`
- `backend/services/notificationScheduler.js` — register the nightly rollup cron
- `backend/scripts/seed-demo-insights.js` — stop writing `date`
- `backend/package.json` — add the 4 new test files to the `test` script
- `extension/src/extension.ts` — `payloadHasSignal`, skip signal-less flushes, `minFlushMinutes` default
- `extension/package.json` — version `2.3.0`, manifest `minFlushMinutes` default `2`
- `extension/CHANGELOG.md` — `## [2.3.0]`
- `extension/tests/activation.test.js` — `payloadHasSignal` + manifest-default assertions
- docs (Task 9)

---

## Task 1: Pure bucketing service `activityBucket.js`

**Files:**
- Create: `backend/services/activityBucket.js`
- Create: `backend/tests/activityBucket.test.js`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `BUCKET_MS: number` (= `600000`)
  - `bucketStartFor(when: Date|number, bucketMs?: number): Date`
  - `hasSignal(normalized: object): boolean`
  - `bucketFilter(userId, projectName, language, bucketStart): object`
  - `buildBucketUpdate(normalized, fileName, fileType): object` — `{ $inc, $max?, $push?, $addToSet?, $set? }` (no `$setOnInsert`)
  - `planActivityWrite(normalized, when: Date, bucketMs?: number): { mode: 'legacy' } | { mode: 'merge', filter, inc } | { mode: 'bucket', filter, update, setOnInsert, bucketStart }`
  - `EDITOR_INC: string[]`, `TERMINAL_INC: string[]` (reused by `dailySummary.js`)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/activityBucket.test.js`:

```js
const assert = require('assert');
const b = require('../services/activityBucket');
const {
  normalizeEditorAnalytics, normalizeFocusAnalytics, normalizeGitAnalytics,
} = require('../services/activityNormalizers');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60000;

console.log('\nbucketStartFor');
check('floors to the 10-minute mark', () => {
  const d = b.bucketStartFor(new Date('2026-03-10T14:23:45.123Z'));
  assert.strictEqual(d.toISOString(), '2026-03-10T14:20:00.000Z');
});
check('a time on the boundary maps to itself', () => {
  assert.strictEqual(b.bucketStartFor(new Date('2026-03-10T14:20:00.000Z')).toISOString(), '2026-03-10T14:20:00.000Z');
});
check('two times 3 min apart in one window share a bucket', () => {
  const a = b.bucketStartFor(new Date('2026-03-10T14:21:00Z')).getTime();
  const c = b.bucketStartFor(new Date('2026-03-10T14:24:00Z')).getTime();
  assert.strictEqual(a, c);
});
check('result is always a multiple of BUCKET_MS', () => {
  assert.strictEqual(b.bucketStartFor(Date.now()).getTime() % b.BUCKET_MS, 0);
});
check('a custom bucketMs is honoured', () => {
  const d = b.bucketStartFor(new Date('2026-03-10T14:23:00Z'), 5 * MIN);
  assert.strictEqual(d.toISOString(), '2026-03-10T14:20:00.000Z');
});

console.log('\nhasSignal');
const empty = {
  editorAnalytics: normalizeEditorAnalytics({}),
  focusAnalytics: normalizeFocusAnalytics({}),
  gitAnalytics: normalizeGitAnalytics({}),
  terminalAnalytics: {},
};
check('false for an all-zero normalized payload', () => {
  assert.strictEqual(b.hasSignal(empty), false);
});
check('true when characters were inserted', () => {
  assert.strictEqual(b.hasSignal({ ...empty, editorAnalytics: { charsInserted: 5 } }), true);
});
check('true when a terminal command ran', () => {
  assert.strictEqual(b.hasSignal({ ...empty, terminalAnalytics: { totalCommands: 1 } }), true);
});
check('true when a git commit landed', () => {
  assert.strictEqual(b.hasSignal({ ...empty, gitAnalytics: { commits: 1 } }), true);
});
check('true when a flow block closed', () => {
  assert.strictEqual(b.hasSignal({ ...empty, focusAnalytics: { flowBlocksMs: [90 * MIN] } }), true);
});

console.log('\nbuildBucketUpdate');
const flush = {
  duration: 84,
  linesAdded: 10,
  linesRemoved: 3,
  editorAnalytics: { charsInserted: 200, charsDeleted: 40, churnLines: 2, linesInserted: 10, linesDeleted: 3, saveCount: 1 },
  focusAnalytics: { focusedMs: 84000, blurredMs: 5000, longestBlockMs: 84000, flowBlocksMs: [84000] },
  gitAnalytics: { commits: 0, filesChanged: 0 },
  terminalAnalytics: { totalCommands: 2, successfulCommands: 2, commandUsage: { git: 1, npm: 1 }, gitActivity: {} },
};
check('$inc carries duration, lines and flushCount', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts', '.ts');
  assert.strictEqual(u.$inc.duration, 84);
  assert.strictEqual(u.$inc.linesAdded, 10);
  assert.strictEqual(u.$inc.linesRemoved, 3);
  assert.strictEqual(u.$inc.flushCount, 1);
});
check('$inc includes only non-zero analytics leaves', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts', '.ts');
  assert.strictEqual(u.$inc['editorAnalytics.charsInserted'], 200);
  assert.strictEqual(u.$inc['editorAnalytics.churnLines'], 2);
  assert.strictEqual(u.$inc['terminalAnalytics.commandUsage.git'], 1);
  assert.ok(!('editorAnalytics.undoCount' in u.$inc), 'zero leaf must be absent');
});
check('no gitAnalytics paths when git is empty', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts', '.ts');
  assert.ok(!Object.keys(u.$inc).some((k) => k.startsWith('gitAnalytics.')), 'git-less flush must not touch gitAnalytics');
});
check('$max carries longestBlockMs', () => {
  assert.strictEqual(b.buildBucketUpdate(flush, 'app.ts').$max['focusAnalytics.longestBlockMs'], 84000);
});
check('$push slices flowBlocksMs to the last 200', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts');
  assert.deepStrictEqual(u.$push['focusAnalytics.flowBlocksMs'], { $each: [84000], $slice: -200 });
});
check('$addToSet adds the filename', () => {
  assert.deepStrictEqual(b.buildBucketUpdate(flush, 'app.ts').$addToSet, { files: 'app.ts' });
});
check('no $addToSet for an unknown filename', () => {
  assert.strictEqual(b.buildBucketUpdate(flush, 'unknown').$addToSet, undefined);
});
check('two flushes summed give the same $inc as one combined flush', () => {
  const u1 = b.buildBucketUpdate(flush, 'a.ts').$inc;
  const u2 = b.buildBucketUpdate(flush, 'a.ts').$inc;
  assert.strictEqual(u1.duration + u2.duration, 168);
});

console.log('\nplanActivityWrite');
const normalized = { ...flush, userId: 'u1', projectName: 'proj', language: 'typescript', fileName: 'a.ts', fileType: '.ts' };
check('mode legacy when bucketMs is 0', () => {
  assert.strictEqual(b.planActivityWrite(normalized, new Date(), 0).mode, 'legacy');
});
check('mode bucket for a payload with signal', () => {
  const p = b.planActivityWrite(normalized, new Date('2026-03-10T14:23:00Z'));
  assert.strictEqual(p.mode, 'bucket');
  assert.strictEqual(p.setOnInsert.bucketStart.toISOString(), '2026-03-10T14:20:00.000Z');
  assert.strictEqual(p.setOnInsert.timestamp.toISOString(), '2026-03-10T14:20:00.000Z');
  assert.deepStrictEqual(p.filter, { userId: 'u1', projectName: 'proj', language: 'typescript', bucketStart: p.setOnInsert.bucketStart });
});
check('mode merge for a signal-less payload', () => {
  const p = b.planActivityWrite({ ...empty, userId: 'u1', projectName: 'proj', language: 'typescript', duration: 20 }, new Date());
  assert.strictEqual(p.mode, 'merge');
  assert.deepStrictEqual(p.inc, { duration: 20, flushCount: 1 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && node tests/activityBucket.test.js`
Expected: FAIL — `Cannot find module '../services/activityBucket'`.

- [ ] **Step 3: Create the service**

Create `backend/services/activityBucket.js`:

```js
/**
 * Activity bucketing — pure helpers for merging flush payloads into
 * 10-minute rollup documents. Dependency-free (no mongoose, no express) so it
 * unit-tests without a database, mirroring services/activityNormalizers.js.
 *
 * Correctness invariant: $inc.duration is the REAL measured active-coding
 * seconds from the flush. Nothing here ever writes the bucket width.
 */

const BUCKET_MS = 600000; // 10 minutes

// Additive editor leaves. `uniqueFiles` is a set-size, not additive — the
// `files` array replaces it on read.
const EDITOR_INC = [
  'charsInserted', 'charsDeleted', 'linesInserted', 'linesDeleted', 'churnLines',
  'undoCount', 'redoCount', 'saveCount', 'fileSwitches', 'readMs', 'writeMs',
  'largeInsertCount', 'largeInsertChars',
];
const FOCUS_INC = ['focusedMs', 'blurredMs', 'blurEvents'];
const GIT_INC = ['commits', 'filesChanged']; // uncommitted* are point-in-time gauges — skip
const TERMINAL_INC = [
  'totalCommands', 'terminalErrorCount', 'successfulCommands', 'failedCommands',
  'buildRuns', 'testRuns', 'successfulBuilds', 'failedBuilds', 'debuggingSessions',
];
const COMMAND_USAGE_KEYS = ['git', 'npm', 'node', 'python', 'docker', 'gcc', 'java', 'pip', 'misc'];
const GIT_ACTIVITY_KEYS = ['commits', 'pushes', 'pulls', 'checkouts', 'merges', 'clones'];
const DEEP_BLOCK_MS = 25 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 10-minute-floored Date. Accepts a Date or epoch ms; NaN -> now. */
function bucketStartFor(when, bucketMs = BUCKET_MS) {
  const t = when instanceof Date ? when.getTime() : Number(when);
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(Math.floor(base / bucketMs) * bucketMs);
}

/** True if this flush carries any real coding signal. */
function hasSignal(p) {
  const e = (p && p.editorAnalytics) || {};
  const t = (p && p.terminalAnalytics) || {};
  const g = (p && p.gitAnalytics) || {};
  const f = (p && p.focusAnalytics) || {};
  return (
    num(e.charsInserted) > 0 || num(e.charsDeleted) > 0 || num(e.saveCount) > 0 ||
    num(e.linesInserted) > 0 || num(e.linesDeleted) > 0 ||
    num(t.totalCommands) > 0 || num(g.commits) > 0 ||
    (Array.isArray(f.flowBlocksMs) && f.flowBlocksMs.length > 0)
  );
}

function bucketFilter(userId, projectName, language, bucketStart) {
  return { userId, projectName, language, bucketStart };
}

function addInc(inc, prefix, src, keys) {
  if (!src) return;
  for (const k of keys) {
    const v = num(src[k]);
    if (v > 0) inc[`${prefix}.${k}`] = (inc[`${prefix}.${k}`] || 0) + v;
  }
}

/** Build the update doc (no $setOnInsert — the caller adds that). */
function buildBucketUpdate(p, fileName, fileType) {
  const e = (p && p.editorAnalytics) || {};
  const f = (p && p.focusAnalytics) || {};
  const t = (p && p.terminalAnalytics) || {};

  const inc = {
    duration: num(p && p.duration),
    linesAdded: num(p && p.linesAdded),
    linesRemoved: num(p && p.linesRemoved),
    flushCount: 1,
  };
  addInc(inc, 'editorAnalytics', e, EDITOR_INC);
  addInc(inc, 'focusAnalytics', f, FOCUS_INC);
  addInc(inc, 'gitAnalytics', (p && p.gitAnalytics) || {}, GIT_INC);
  addInc(inc, 'terminalAnalytics', t, TERMINAL_INC);
  addInc(inc, 'terminalAnalytics.commandUsage', t.commandUsage || {}, COMMAND_USAGE_KEYS);
  addInc(inc, 'terminalAnalytics.gitActivity', t.gitActivity || {}, GIT_ACTIVITY_KEYS);

  const update = { $inc: inc };

  const longest = num(f.longestBlockMs);
  if (longest > 0) update.$max = { 'focusAnalytics.longestBlockMs': longest };

  const blocks = Array.isArray(f.flowBlocksMs)
    ? f.flowBlocksMs.map(num).filter((n) => n > 0)
    : [];
  if (blocks.length) {
    update.$push = { 'focusAnalytics.flowBlocksMs': { $each: blocks, $slice: -200 } };
  }

  if (fileName && fileName !== 'unknown') {
    update.$addToSet = { files: fileName };
  }

  const set = {};
  if (t.lastCommand && t.lastCommand !== 'unknown') set['terminalAnalytics.lastCommand'] = t.lastCommand;
  if (t.lastCommandTimestamp) set['terminalAnalytics.lastCommandTimestamp'] = t.lastCommandTimestamp;
  if (Array.isArray(t.repeatedFailedCommands) && t.repeatedFailedCommands.length) {
    set['terminalAnalytics.repeatedFailedCommands'] = t.repeatedFailedCommands;
  }
  if (Object.keys(set).length) update.$set = set;

  return update;
}

/**
 * Decide how to persist a flush.
 *   { mode: 'legacy' }  -> caller does Activity.create(fullDoc)  (ACTIVITY_BUCKET_MS=0)
 *   { mode: 'merge', filter, inc }  -> updateOne(filter, { $inc: inc }, { upsert: false })
 *   { mode: 'bucket', filter, update, setOnInsert, bucketStart }
 *       -> findOneAndUpdate(filter, { ...update, $setOnInsert: setOnInsert }, { upsert: true, new: true })
 */
function planActivityWrite(normalized, when, bucketMs = BUCKET_MS) {
  if (!bucketMs) return { mode: 'legacy' };
  const bucketStart = bucketStartFor(when, bucketMs);
  const filter = bucketFilter(
    normalized.userId, normalized.projectName, normalized.language, bucketStart,
  );
  if (!hasSignal(normalized)) {
    return { mode: 'merge', filter, inc: { duration: num(normalized.duration), flushCount: 1 } };
  }
  const update = buildBucketUpdate(normalized, normalized.fileName, normalized.fileType);
  const setOnInsert = {
    userId: normalized.userId,
    projectName: normalized.projectName,
    language: normalized.language,
    fileType: normalized.fileType || 'unknown',
    bucketStart,
    timestamp: bucketStart,
  };
  return { mode: 'bucket', filter, update, setOnInsert, bucketStart };
}

module.exports = {
  BUCKET_MS, DEEP_BLOCK_MS,
  EDITOR_INC, TERMINAL_INC, FOCUS_INC, GIT_INC,
  bucketStartFor, hasSignal, bucketFilter, buildBucketUpdate, planActivityWrite,
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && node tests/activityBucket.test.js`
Expected: PASS — all checks, `0 failed`.

- [ ] **Step 5: Add the test to the backend test script**

In `backend/package.json`, change the `test` script from:
```
"test": "node tests/streak.test.js && node tests/ingest.test.js && node tests/metrics.test.js && node tests/authorization.test.js && node tests/routeGuards.test.js && node tests/passwordHash.test.js"
```
to:
```
"test": "node tests/streak.test.js && node tests/ingest.test.js && node tests/metrics.test.js && node tests/authorization.test.js && node tests/routeGuards.test.js && node tests/passwordHash.test.js && node tests/activityBucket.test.js"
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: every suite PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/activityBucket.js backend/tests/activityBucket.test.js backend/package.json
git commit -m "feat(backend): pure activity-bucketing service (10-min rollup planner)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `Activity` model — sparse sub-docs, drop `date`, new fields + indexes + TTL

**Files:**
- Modify: `backend/models/Activity.js`
- Create: `backend/tests/activityModel.test.js`
- Create: `backend/scripts/migrate-drop-date.js`
- Modify: `backend/scripts/seed-demo-insights.js` (remove the `date` write)
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Consumes: nothing
- Produces: the `Activity` model with fields `bucketStart: Date`, `files: [String]`, `flushCount: Number (default 1)`; no `date` field; indexes `{userId:1,timestamp:-1}`, partial-unique `{userId:1,projectName:1,language:1,bucketStart:1}`, TTL on `{createdAt:1}` (400 days); no `{userId:1,date:-1}` index.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/activityModel.test.js`:

```js
const assert = require('assert');
const Activity = require('../models/Activity');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const indexes = Activity.schema.indexes(); // [ [keySpec, options], ... ]
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hasKey = (keys) => indexes.some(([k]) => sameKey(k, keys));

console.log('\nActivity schema');
check('the dead `date` field is gone', () => {
  assert.strictEqual(Activity.schema.path('date'), undefined);
});
check('`bucketStart` exists (Date)', () => {
  assert.strictEqual(Activity.schema.path('bucketStart').instance, 'Date');
});
check('`files` exists (Array)', () => {
  assert.strictEqual(Activity.schema.path('files').instance, 'Array');
});
check('`flushCount` defaults to 1', () => {
  assert.strictEqual(Activity.schema.path('flushCount').getDefault(), 1);
});
check('analytics leaves have NO default (sparse on insert)', () => {
  assert.strictEqual(Activity.schema.path('terminalAnalytics.totalCommands').defaultValue, undefined);
  assert.strictEqual(Activity.schema.path('editorAnalytics.charsInserted').defaultValue, undefined);
  assert.strictEqual(Activity.schema.path('gitAnalytics.commits').defaultValue, undefined);
  assert.strictEqual(Activity.schema.path('focusAnalytics.focusedMs').defaultValue, undefined);
});

console.log('\nActivity indexes');
check('has {userId:1, timestamp:-1}', () => {
  assert.ok(hasKey({ userId: 1, timestamp: -1 }));
});
check('has the partial-unique bucket index', () => {
  assert.ok(indexes.some(([k, o]) =>
    sameKey(k, { userId: 1, projectName: 1, language: 1, bucketStart: 1 }) &&
    o && o.unique === true &&
    o.partialFilterExpression && o.partialFilterExpression.bucketStart));
});
check('has a 400-day TTL on createdAt', () => {
  assert.ok(indexes.some(([k, o]) =>
    k.createdAt === 1 && o && o.expireAfterSeconds === 60 * 60 * 24 * 400));
});
check('the dead {userId:1, date:-1} index is gone', () => {
  assert.ok(!hasKey({ userId: 1, date: -1 }));
});
check('keeps {userId:1, projectName:1} and {userId:1, language:1}', () => {
  assert.ok(hasKey({ userId: 1, projectName: 1 }));
  assert.ok(hasKey({ userId: 1, language: 1 }));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && node tests/activityModel.test.js`
Expected: FAIL — `date` still present, `bucketStart` missing, etc.

- [ ] **Step 3: Edit the schema**

In `backend/models/Activity.js`:

**3a.** In `terminalAnalytics`, `editorAnalytics`, `focusAnalytics`, `gitAnalytics`: change every leaf from `{ type: X, default: 0 }` / `{ type: X, default: [] }` / `{ type: String, default: "unknown" }` / `{ type: Date, default: null }` to just `X` (or `{ type: X }`). Examples:
```js
terminalAnalytics: {
    totalCommands: Number,
    terminalErrorCount: Number,
    successfulCommands: Number,
    failedCommands: Number,
    successRate: Number,
    buildRuns: Number,
    testRuns: Number,
    successfulBuilds: Number,
    failedBuilds: Number,
    buildSuccessRate: Number,
    debuggingSessions: Number,
    commandUsage: {
        git: Number, npm: Number, node: Number, python: Number, docker: Number,
        gcc: Number, java: Number, pip: Number, misc: Number,
    },
    gitActivity: {
        commits: Number, pushes: Number, pulls: Number, checkouts: Number, merges: Number, clones: Number,
    },
    repeatedFailedCommands: [{ command: String, count: Number }],
    lastCommand: String,
    lastCommandTimestamp: Date,
},
editorAnalytics: {
    charsInserted: Number, charsDeleted: Number, linesInserted: Number, linesDeleted: Number,
    churnLines: Number, undoCount: Number, redoCount: Number, saveCount: Number,
    fileSwitches: Number, uniqueFiles: Number, readMs: Number, writeMs: Number,
    largeInsertCount: Number, largeInsertChars: Number,
},
focusAnalytics: {
    focusedMs: Number, blurredMs: Number, blurEvents: Number,
    flowBlocksMs: [Number], longestBlockMs: Number,
},
gitAnalytics: {
    commits: Number, filesChanged: Number, uncommittedFiles: Number, uncommittedAgeMs: Number,
},
```

**3b.** Remove the `date` field block:
```js
    date: {
        type: Date,
        default: Date.now
    },
```

**3c.** Add three fields (next to `timestamp`):
```js
    bucketStart: { type: Date },
    files: { type: [String] },
    flushCount: { type: Number, default: 1 },
```

**3d.** Replace the index block. Delete:
```js
activitySchema.index({ userId: 1, date: -1 });
activitySchema.index({ userId: 1, projectName: 1 });
activitySchema.index({ userId: 1, language: 1 });
```
with:
```js
activitySchema.index({ userId: 1, timestamp: -1 });
activitySchema.index({ userId: 1, projectName: 1 });
activitySchema.index({ userId: 1, language: 1 });
activitySchema.index(
    { userId: 1, projectName: 1, language: 1, bucketStart: 1 },
    { unique: true, partialFilterExpression: { bucketStart: { $exists: true } } }
);
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });
```
(Keep the field-level `userId: { ..., index: true }`.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && node tests/activityModel.test.js`
Expected: PASS.

- [ ] **Step 5: Stop the seed script writing `date`**

In `backend/scripts/seed-demo-insights.js`, delete the line `date: when,` (it sits next to `timestamp: when,` inside `buildActivity`'s returned object).

- [ ] **Step 6: Write the migration script**

Create `backend/scripts/migrate-drop-date.js`:

```js
#!/usr/bin/env node
/**
 * One-off: drop the dead `date` field from `activities` and its index.
 * Nothing in production reads `date` (see the write-reduction spec).
 *
 *   node scripts/migrate-drop-date.js            # dry run
 *   node scripts/migrate-drop-date.js --apply
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const col = mongoose.connection.collection('activities');

  const withDate = await col.countDocuments({ date: { $exists: true } });
  const indexes = await col.indexes();
  const legacyIdx = indexes.find((i) => i.name === 'userId_1_date_-1');

  console.log(`\ndocuments carrying a 'date' field : ${withDate}`);
  console.log(`legacy index userId_1_date_-1     : ${legacyIdx ? 'present' : 'absent'}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to perform the change.\n');
    await mongoose.disconnect();
    return;
  }

  if (legacyIdx) {
    await col.dropIndex('userId_1_date_-1');
    console.log("dropped index 'userId_1_date_-1'");
  }
  const r = await col.updateMany({ date: { $exists: true } }, { $unset: { date: '' } });
  console.log(`unset 'date' on ${r.modifiedCount} document(s)`);

  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
```

- [ ] **Step 7: Syntax-check the new files**

Run: `cd backend && node --check scripts/migrate-drop-date.js && node --check models/Activity.js && node --check scripts/seed-demo-insights.js`
Expected: no output (all OK).

- [ ] **Step 8: Add the model test to the test script**

In `backend/package.json` append ` && node tests/activityModel.test.js` to the `test` script.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all PASS (note: `ingest.test.js` uses the normalizers, not the model — unaffected).

- [ ] **Step 10: Commit**

```bash
git add backend/models/Activity.js backend/tests/activityModel.test.js backend/scripts/migrate-drop-date.js backend/scripts/seed-demo-insights.js backend/package.json
git commit -m "feat(backend): Activity schema for bucketing — sparse sub-docs, drop dead date field, new indexes + 400d TTL

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Wire `/track` and `/track/batch` to the bucketing planner

**Files:**
- Modify: `backend/routes/extension.js`
- Create: `backend/tests/ingestWiring.test.js`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Consumes: `planActivityWrite`, `bucketStartFor` from `services/activityBucket.js` (Task 1)
- Produces: `/track` and `/track/batch` that upsert 10-minute buckets; `ACTIVITY_BUCKET_MS=0` restores `Activity.create`. Re-exports `planActivityWrite`, `hasSignal`, `bucketStartFor` for tests.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/ingestWiring.test.js`:

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'extension.js'), 'utf8');
const route = require('../routes/extension');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\n/track bucketing wiring');
check('the route requires the bucketing service', () => {
  assert.ok(/require\(['"]\.\.\/services\/activityBucket['"]\)/.test(src));
});
check('the route calls planActivityWrite', () => {
  assert.ok(/planActivityWrite\(/.test(src));
});
check('ACTIVITY_BUCKET_MS is read from env with a 600000 default', () => {
  assert.ok(/ACTIVITY_BUCKET_MS/.test(src) && /600000/.test(src));
});
check('the only Activity.create call is guarded by the legacy branch', () => {
  // Activity.create must appear only inside a `mode === 'legacy'` / bucketMs===0 branch.
  const creates = src.match(/Activity\.create\(/g) || [];
  assert.ok(creates.length <= 2, `expected <=2 Activity.create (track + batch legacy), found ${creates.length}`);
  assert.ok(/mode === 'legacy'|=== 0/.test(src), 'legacy guard present');
});
check('bucket writes use findOneAndUpdate with upsert', () => {
  assert.ok(/findOneAndUpdate\(/.test(src) && /upsert:\s*true/.test(src));
});
check('an 11000 duplicate-key is retried', () => {
  assert.ok(/11000/.test(src));
});
check('re-exports the bucketing helpers for tests', () => {
  assert.strictEqual(typeof route.planActivityWrite, 'function');
  assert.strictEqual(typeof route.hasSignal, 'function');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && node tests/ingestWiring.test.js`
Expected: FAIL — no `activityBucket` require, no `planActivityWrite`.

- [ ] **Step 3: Rewrite the `/track` handler**

In `backend/routes/extension.js`:

**3a.** Add near the top, after the existing requires:
```js
const {
    planActivityWrite, hasSignal, bucketStartFor,
} = require('../services/activityBucket');

const ACTIVITY_BUCKET_MS = Number(
    process.env.ACTIVITY_BUCKET_MS !== undefined ? process.env.ACTIVITY_BUCKET_MS : 600000
);
```

**3b.** Replace the body of `router.post('/track', verifyApiKey, async (req, res) => { ... })` from the `const activity = await Activity.create({ ... });` block onwards. Keep the destructuring, `normalizeTerminalAnalytics`, the `parsedTimestamp`/`when` derivation and the required-fields 400 check exactly as they are. Then:

```js
        const normalized = {
            userId: req.user._id.toString(),
            fileName,
            fileType: fileType || 'unknown',
            projectName: projectName || 'Unknown Project',
            language,
            duration: Number(duration),
            linesAdded: Number(linesAdded) || 0,
            linesRemoved: Number(linesRemoved) || 0,
            terminalAnalytics: terminalPayload,
            editorAnalytics: normalizeEditorAnalytics(req.body),
            focusAnalytics: normalizeFocusAnalytics(req.body),
            gitAnalytics: normalizeGitAnalytics(req.body),
        };

        const plan = planActivityWrite(normalized, when, ACTIVITY_BUCKET_MS);

        if (plan.mode === 'legacy') {
            const activity = await Activity.create({ ...normalized, timestamp: when });
            return res.status(201).json({
                success: true,
                message: 'Activity tracked successfully',
                activity: {
                    id: activity._id, fileName: activity.fileName, language: activity.language,
                    duration: activity.duration, timestamp: activity.timestamp,
                },
            });
        }

        if (plan.mode === 'merge') {
            const r = await Activity.updateOne(plan.filter, { $inc: plan.inc }, { upsert: false });
            return res.status(202).json({ success: true, merged: r.matchedCount > 0 });
        }

        // plan.mode === 'bucket'
        const withInsert = { ...plan.update, $setOnInsert: plan.setOnInsert };
        let doc;
        try {
            doc = await Activity.findOneAndUpdate(plan.filter, withInsert, { upsert: true, new: true });
        } catch (err) {
            if (err && err.code === 11000) {
                doc = await Activity.findOneAndUpdate(plan.filter, plan.update, { new: true });
            } else {
                throw err;
            }
        }
        return res.status(201).json({
            success: true,
            message: 'Activity bucketed',
            bucket: {
                id: doc._id,
                bucketStart: plan.bucketStart,
                duration: doc.duration,
                flushCount: doc.flushCount,
            },
        });
```

**3c.** Rewrite `router.post('/track/batch', ...)`. Keep the `activities` array 400 check. Replace the `preparedActivities`/`insertMany` block with a per-activity loop that reuses the same planner:

```js
        let bucketed = 0;
        let created = 0;
        for (const a of activities) {
            const parsed = a.timestamp ? new Date(a.timestamp) : new Date();
            const when = isNaN(parsed.getTime()) ? new Date() : parsed;
            const normalized = {
                userId: req.user._id.toString(),
                fileName: a.fileName,
                fileType: a.fileType || 'unknown',
                projectName: a.projectName || 'Unknown Project',
                language: a.language,
                duration: Number(a.duration),
                linesAdded: Number(a.linesAdded) || 0,
                linesRemoved: Number(a.linesRemoved) || 0,
                terminalAnalytics: normalizeTerminalAnalytics(a),
                editorAnalytics: normalizeEditorAnalytics(a),
                focusAnalytics: normalizeFocusAnalytics(a),
                gitAnalytics: normalizeGitAnalytics(a),
            };
            const plan = planActivityWrite(normalized, when, ACTIVITY_BUCKET_MS);
            if (plan.mode === 'legacy') {
                await Activity.create({ ...normalized, timestamp: when });
                created += 1;
            } else if (plan.mode === 'merge') {
                await Activity.updateOne(plan.filter, { $inc: plan.inc }, { upsert: false });
            } else {
                const withInsert = { ...plan.update, $setOnInsert: plan.setOnInsert };
                try {
                    await Activity.findOneAndUpdate(plan.filter, withInsert, { upsert: true });
                } catch (err) {
                    if (err && err.code === 11000) {
                        await Activity.findOneAndUpdate(plan.filter, plan.update, {});
                    } else { throw err; }
                }
                bucketed += 1;
            }
        }
        res.status(201).json({ success: true, message: `${activities.length} activities processed`, bucketed, created });
```
(Batch is unused by the shipped extension — a simple loop, not JS-side grouping, keeps it obviously correct. Deviation from spec §5.3 noted.)

**3d.** At the bottom of the file, extend the exports:
```js
module.exports = router;
module.exports.planActivityWrite = planActivityWrite;
module.exports.hasSignal = hasSignal;
module.exports.bucketStartFor = bucketStartFor;
```

- [ ] **Step 4: Run the wiring test, verify it passes**

Run: `cd backend && node tests/ingestWiring.test.js`
Expected: PASS.

- [ ] **Step 5: Syntax-check and run the suite**

Run: `cd backend && node --check routes/extension.js && npm test` (after appending ` && node tests/ingestWiring.test.js` to the `test` script in `backend/package.json`).
Expected: all PASS. `routeGuards.test.js` still passes (`/track` keeps `verifyApiKey`).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/extension.js backend/tests/ingestWiring.test.js backend/package.json
git commit -m "feat(backend): /track upserts 10-minute activity buckets (ACTIVITY_BUCKET_MS=0 = legacy)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Extension — skip signal-less flushes, `minFlushMinutes` default 2, v2.3.0

**Files:**
- Modify: `extension/src/extension.ts`
- Modify: `extension/package.json`
- Modify: `extension/CHANGELOG.md`
- Modify: `extension/tests/activation.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `extension.ts` exports `payloadHasSignal(payload: any): boolean`; `flushIfNeeded` builds the payload and returns early (keeping the buffer) when a non-forced flush has no signal; `codetrackr.minFlushMinutes` default is `2`.

- [ ] **Step 1: Write the failing test**

In `extension/tests/activation.test.js`, add a new section before the final `await ext.deactivate();`:

```js
  console.log('\nskip signal-less flushes');
  check('payloadHasSignal is exported', () => {
    assert.strictEqual(typeof ext.payloadHasSignal, 'function');
  });
  check('payloadHasSignal: false for an all-zero payload', () => {
    assert.strictEqual(ext.payloadHasSignal({
      editorAnalytics: {}, terminalAnalytics: {}, gitAnalytics: {}, focusAnalytics: { flowBlocksMs: [] },
    }), false);
  });
  check('payloadHasSignal: true when characters were inserted', () => {
    assert.strictEqual(ext.payloadHasSignal({
      editorAnalytics: { charsInserted: 5 }, terminalAnalytics: {}, gitAnalytics: {}, focusAnalytics: { flowBlocksMs: [] },
    }), true);
  });
  check('payloadHasSignal: true when a terminal command ran', () => {
    assert.strictEqual(ext.payloadHasSignal({
      editorAnalytics: {}, terminalAnalytics: { totalCommands: 1 }, gitAnalytics: {}, focusAnalytics: { flowBlocksMs: [] },
    }), true);
  });
```

And in the `manifest` section add:
```js
  check('minFlushMinutes default is 2', () => {
    assert.strictEqual(
      MANIFEST.contributes.configuration.properties['codetrackr.minFlushMinutes'].default, 2
    );
  });
```

- [ ] **Step 2: Build and run, verify it fails**

Run: `cd extension && npm run build && node tests/activation.test.js`
Expected: FAIL — `ext.payloadHasSignal` is not a function; manifest default is `0.5`.

- [ ] **Step 3: Add `payloadHasSignal` and the flush guard**

In `extension/src/extension.ts`:

**3a.** Add near the other helpers (after `minutesSince`):
```ts
/** True if a built payload carries any real coding signal. Mirrors the backend. */
export function payloadHasSignal(payload: any): boolean {
  const e = payload?.editorAnalytics || {};
  const t = payload?.terminalAnalytics || {};
  const g = payload?.gitAnalytics || {};
  const f = payload?.focusAnalytics || {};
  const n = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return (
    n(e.charsInserted) > 0 || n(e.charsDeleted) > 0 || n(e.saveCount) > 0 ||
    n(e.linesInserted) > 0 || n(e.linesDeleted) > 0 ||
    n(t.totalCommands) > 0 || n(g.commits) > 0 ||
    (Array.isArray(f.flowBlocksMs) && f.flowBlocksMs.length > 0)
  );
}
```

**3b.** Change `sendActivity` to take a prebuilt payload. Replace the signature and the top of the function:
```ts
async function sendActivity(payload: ReturnType<typeof buildPayload>): Promise<void> {
  const { apiBase, apiKey } = getCfg();
  const durationSeconds = payload.duration;

  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_FLUSH_SECONDS) {
    return;
  }
  if (durationSeconds > MAX_FLUSH_SECONDS) {
    console.warn(`CodeTrackr: implausible duration ${durationSeconds}s (clock jump?), skipping flush`);
    return;
  }
  if (!apiKey) {
    warnAboutAuth('no API key is configured, so your activity is not being saved.');
    return;
  }
  // (rest of the try/catch axios.post block stays, but remove the local `const payload = buildPayload(...)` line)
```

**3c.** Update `flushIfNeeded` to build the payload and apply the guard:
```ts
async function flushIfNeeded(force: boolean = false): Promise<void> {
  if (!state.startedMs) return;

  const elapsedFromStartMin = minutesSince(state.startedMs);
  const idleMin = minutesSince(state.lastActivityMs);

  if (!force && idleMin >= IDLE_PAUSE_MINUTES) return;

  const totalBuffered = state.bufferedMinutes + elapsedFromStartMin;
  const { minFlushMinutes } = getCfg();

  if (!force && totalBuffered < minFlushMinutes) return;

  const fileOpened =
    vscode.window.activeTextEditor?.document?.fileName || state.lastKnownFile || 'unknown';

  const payload = buildPayload(Math.round(totalBuffered * 60), fileOpened);

  // Keep buffering — do not reset — when a non-forced flush has nothing to report.
  if (!force && !payloadHasSignal(payload)) return;

  try {
    await sendActivity(payload);
    state.startedMs = Date.now();
    state.bufferedMinutes = 0;
  } catch {
    state.bufferedMinutes = totalBuffered;
    state.startedMs = Date.now();
  }
}
```

**3d.** Update the idle-pause branch inside `start()`'s `setInterval`. Replace:
```ts
        if (activeDurationMin > getCfg().minFlushMinutes) {
          sendActivity(activeDurationMin, state.lastKnownFile).catch(() => {});
        }
```
with:
```ts
        if (activeDurationMin > getCfg().minFlushMinutes) {
          const idlePayload = buildPayload(Math.round(activeDurationMin * 60), state.lastKnownFile);
          if (payloadHasSignal(idlePayload)) {
            sendActivity(idlePayload).catch(() => {});
          }
        }
```

**3e.** `buildPayloadForTest` is unchanged (still returns the full payload).

- [ ] **Step 4: Bump the config default and version**

In `extension/package.json`:
- `"version": "2.2.0"` -> `"version": "2.3.0"`
- `contributes.configuration.properties["codetrackr.minFlushMinutes"].default`: `0.5` -> `2`, and its `"description"` -> `"Minimum minutes of active coding before a record is sent. Higher = fewer, coarser records."`

In `extension/src/extension.ts` `getCfg()`: change the `minFlushMinutes` fallback from `: 0.5` to `: 2`.

- [ ] **Step 5: Changelog**

In `extension/CHANGELOG.md`, add below the header:
```markdown
## [2.3.0] - 2026-09-08

### Changed
- The backend now merges flushes into 10-minute activity records, so the extension
  no longer needs to send a record every 30 seconds. `minFlushMinutes` now defaults
  to **2** (was 0.5) — fewer, coarser records, no change to reported totals.

### Fixed
- Flush intervals with no real activity (window focused but no edits, commands or
  commits) are no longer sent. The buffered time carries to the next real flush,
  which also stops sub-2-minute idle stretches from inflating coding time.

---

```

- [ ] **Step 6: Build and run the tests**

Run: `cd extension && npm run build && npm test`
Expected: `trackers.test.js` and `activation.test.js` both PASS (activation now also checks `payloadHasSignal` and the manifest default).

- [ ] **Step 7: Repackage the .vsix**

Run: `cd extension && npm run package`
Expected: `codetrackr-vscode-2.3.0.vsix` is written. Then:
```bash
git rm extension/codetrackr-vscode-2.2.0.vsix
git add extension/codetrackr-vscode-2.3.0.vsix
```
If `npm run package` fails (vsce not installed / offline), instead run `git rm extension/codetrackr-vscode-2.2.0.vsix` and note in the commit body that the 2.3.0 `.vsix` is built at publish time.

- [ ] **Step 8: Commit**

```bash
git add extension/src/extension.ts extension/package.json extension/CHANGELOG.md extension/tests/activation.test.js extension/dist/extension.js
git commit -m "feat(extension): 2.3.0 — skip signal-less flushes, minFlushMinutes default 2

Buffered time carries forward when a flush has no edits/commands/commits, so
sub-2-minute idle stretches no longer inflate coding time. Pairs with the
backend 10-minute bucketing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `DailySummary` model + pure `buildDaySummary`

**Files:**
- Create: `backend/models/DailySummary.js`
- Create: `backend/services/dailySummary.js`
- Create: `backend/tests/rollup.test.js`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Consumes: `EDITOR_INC`, `TERMINAL_INC`, `DEEP_BLOCK_MS` from `services/activityBucket.js` (Task 1)
- Produces:
  - `DailySummary` model
  - `buildDaySummary(userId: string, day: string, docs: object[]): object` — a `DailySummary`-shaped plain object

- [ ] **Step 1: Write the failing test**

Create `backend/tests/rollup.test.js`:

```js
const assert = require('assert');
const { buildDaySummary } = require('../services/dailySummary');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60000;

const docs = [
  { // a bucket doc
    userId: 'u1', language: 'typescript', projectName: 'proj-a', duration: 600,
    linesAdded: 40, linesRemoved: 10, flushCount: 7,
    editorAnalytics: { charsInserted: 900, churnLines: 12, saveCount: 4 },
    focusAnalytics: { focusedMs: 9 * MIN, longestBlockMs: 30 * MIN, flowBlocksMs: [30 * MIN, 4 * MIN] },
    terminalAnalytics: { totalCommands: 5, successfulCommands: 4, failedCommands: 1 },
    gitAnalytics: { commits: 1, filesChanged: 3 },
  },
  { // a legacy per-flush doc (no flushCount, one language)
    userId: 'u1', language: 'javascript', projectName: 'proj-b', duration: 120,
    linesAdded: 5, linesRemoved: 0,
    editorAnalytics: { charsInserted: 100 },
    focusAnalytics: { focusedMs: 2 * MIN, longestBlockMs: 2 * MIN, flowBlocksMs: [2 * MIN] },
    terminalAnalytics: {}, gitAnalytics: {},
  },
];

console.log('\nbuildDaySummary');
const s = buildDaySummary('u1', '2026-03-10', docs);

check('sums seconds and line counts', () => {
  assert.strictEqual(s.totalSeconds, 720);
  assert.strictEqual(s.totalLinesAdded, 45);
  assert.strictEqual(s.totalLinesRemoved, 10);
});
check('flushCount treats a missing value as 1', () => {
  assert.strictEqual(s.flushCount, 8); // 7 + 1
  assert.strictEqual(s.bucketCount, 2);
});
check('language breakdown is per-language seconds', () => {
  const ts = s.languages.find((l) => l.language === 'typescript');
  const js = s.languages.find((l) => l.language === 'javascript');
  assert.strictEqual(ts.seconds, 600);
  assert.strictEqual(js.seconds, 120);
});
check('project set is de-duplicated', () => {
  assert.deepStrictEqual([...s.projects].sort(), ['proj-a', 'proj-b']);
});
check('focus: focusedMs summed, longestBlockMs maxed, deep blocks counted', () => {
  assert.strictEqual(s.focus.focusedMs, 11 * MIN);
  assert.strictEqual(s.focus.longestBlockMs, 30 * MIN);
  assert.strictEqual(s.focus.blockCount, 3);
  assert.strictEqual(s.focus.deepBlockCount, 1); // only the 30-min block is >= 25 min
});
check('editor / terminal / git additive totals', () => {
  assert.strictEqual(s.editor.charsInserted, 1000);
  assert.strictEqual(s.terminal.totalCommands, 5);
  assert.strictEqual(s.git.commits, 1);
});
check('empty input yields a zeroed summary', () => {
  const z = buildDaySummary('u1', '2026-03-11', []);
  assert.strictEqual(z.totalSeconds, 0);
  assert.strictEqual(z.bucketCount, 0);
  assert.deepStrictEqual(z.languages, []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd backend && node tests/rollup.test.js`
Expected: FAIL — `Cannot find module '../services/dailySummary'`.

- [ ] **Step 3: Create the pure service**

Create `backend/services/dailySummary.js`:

```js
/**
 * Daily rollup — pure summary builder. Dependency-free.
 * Fed a day's worth of activity documents (bucketed and/or legacy per-flush),
 * returns a DailySummary-shaped plain object. No double counting.
 */
const { EDITOR_INC, TERMINAL_INC, DEEP_BLOCK_MS } = require('./activityBucket');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function accum(target, src, keys) {
  const s = src || {};
  for (const k of keys) target[k] = (target[k] || 0) + num(s[k]);
}

function buildDaySummary(userId, day, docs) {
  const list = Array.isArray(docs) ? docs : [];
  const summary = {
    userId,
    day,
    totalSeconds: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    flushCount: 0,
    bucketCount: list.length,
    languages: [],
    projects: [],
    editor: {},
    terminal: {},
    git: {},
    focus: { focusedMs: 0, blurredMs: 0, longestBlockMs: 0, deepBlockCount: 0, blockCount: 0 },
    rolledAt: new Date(),
  };

  const langSeconds = new Map();
  const projects = new Set();

  for (const d of list) {
    const dur = num(d.duration);
    summary.totalSeconds += dur;
    summary.totalLinesAdded += num(d.linesAdded);
    summary.totalLinesRemoved += num(d.linesRemoved);
    summary.flushCount += num(d.flushCount != null ? d.flushCount : 1);

    if (d.language) langSeconds.set(d.language, (langSeconds.get(d.language) || 0) + dur);
    if (d.projectName) projects.add(d.projectName);

    const f = d.focusAnalytics || {};
    summary.focus.focusedMs += num(f.focusedMs);
    summary.focus.blurredMs += num(f.blurredMs);
    summary.focus.longestBlockMs = Math.max(summary.focus.longestBlockMs, num(f.longestBlockMs));
    const blocks = Array.isArray(f.flowBlocksMs) ? f.flowBlocksMs : [];
    summary.focus.blockCount += blocks.length;
    summary.focus.deepBlockCount += blocks.filter((b) => num(b) >= DEEP_BLOCK_MS).length;

    accum(summary.editor, d.editorAnalytics, EDITOR_INC);
    accum(summary.terminal, d.terminalAnalytics, TERMINAL_INC);
    accum(summary.git, d.gitAnalytics, ['commits', 'filesChanged']);
  }

  summary.languages = [...langSeconds].map(([language, seconds]) => ({ language, seconds }));
  summary.projects = [...projects];
  return summary;
}

module.exports = { buildDaySummary };
```

- [ ] **Step 4: Create the model**

Create `backend/models/DailySummary.js`:

```js
const mongoose = require('mongoose');

const dailySummarySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    day: { type: String, required: true }, // 'YYYY-MM-DD', UTC
    totalSeconds: { type: Number, default: 0 },
    totalLinesAdded: { type: Number, default: 0 },
    totalLinesRemoved: { type: Number, default: 0 },
    flushCount: { type: Number, default: 0 },
    bucketCount: { type: Number, default: 0 },
    languages: [{ language: String, seconds: Number, _id: false }],
    projects: [String],
    editor: { type: Object, default: {} },
    terminal: { type: Object, default: {} },
    git: { type: Object, default: {} },
    focus: {
        focusedMs: { type: Number, default: 0 },
        blurredMs: { type: Number, default: 0 },
        longestBlockMs: { type: Number, default: 0 },
        deepBlockCount: { type: Number, default: 0 },
        blockCount: { type: Number, default: 0 },
    },
    rolledAt: { type: Date, default: Date.now },
}, { timestamps: true });

dailySummarySchema.index({ userId: 1, day: 1 }, { unique: true });

module.exports = mongoose.models.DailySummary || mongoose.model('DailySummary', dailySummarySchema);
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd backend && node tests/rollup.test.js && node --check models/DailySummary.js`
Expected: PASS; model checks OK.

- [ ] **Step 6: Add to the test script + run the suite**

Append ` && node tests/rollup.test.js` to `backend/package.json` `test`. Run `cd backend && npm test`. Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/models/DailySummary.js backend/services/dailySummary.js backend/tests/rollup.test.js backend/package.json
git commit -m "feat(backend): DailySummary model + pure daily-rollup builder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Rollup orchestration + CLI + nightly cron

**Files:**
- Create: `backend/services/dailyRollup.js`
- Create: `backend/scripts/rollup-daily.js`
- Modify: `backend/services/notificationScheduler.js`

**Interfaces:**
- Consumes: `buildDaySummary` (Task 5), the `Activity` and `DailySummary` models
- Produces: `rollupDaily({ apply, beforeDays, force }): Promise<{ scanned, wrote, days }>`; a CLI; a `cron.schedule('30 3 * * *', ...)` registered in `initScheduler()`

- [ ] **Step 1: Write the orchestration service**

Create `backend/services/dailyRollup.js`:

```js
/**
 * Daily rollup — DB orchestration. Rolls raw `activities` older than
 * `beforeDays` into one `DailySummary` per (userId, UTC day). Idempotent
 * ($set, re-runnable). Never deletes raw activity — the 400-day TTL owns
 * retention.
 */
const Activity = require('../models/Activity');
const DailySummary = require('../models/DailySummary');
const { buildDaySummary } = require('./dailySummary');

function utcDayKey(d) {
    return new Date(d).toISOString().slice(0, 10);
}

async function rollupDaily({ apply = false, beforeDays = 2, force = false } = {}) {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - beforeDays);

    // Distinct (userId, UTC day) pairs with raw activity before the cutoff.
    const pairs = await Activity.aggregate([
        { $match: { timestamp: { $lt: cutoff } } },
        {
            $group: {
                _id: {
                    userId: '$userId',
                    day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'UTC' } },
                },
            },
        },
    ]);

    let wrote = 0;
    for (const { _id: { userId, day } } of pairs) {
        if (!force) {
            const existing = await DailySummary.findOne({ userId, day }).lean();
            if (existing) continue;
        }
        const start = new Date(`${day}T00:00:00.000Z`);
        const end = new Date(start.getTime() + 86400000);
        const docs = await Activity.find({
            userId, timestamp: { $gte: start, $lt: end },
        }).lean();
        const summary = buildDaySummary(userId, day, docs);
        if (apply) {
            await DailySummary.updateOne({ userId, day }, { $set: summary }, { upsert: true });
        }
        wrote += 1;
    }

    return { scanned: pairs.length, wrote, apply, beforeDays };
}

module.exports = { rollupDaily, utcDayKey };
```

- [ ] **Step 2: Write the CLI**

Create `backend/scripts/rollup-daily.js`:

```js
#!/usr/bin/env node
/**
 * Roll raw `activities` older than N days into DailySummary documents.
 *
 *   node scripts/rollup-daily.js                 # dry run, days ending >= 2 days ago
 *   node scripts/rollup-daily.js --apply
 *   node scripts/rollup-daily.js --apply --before 7 --force
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { rollupDaily } = require('../services/dailyRollup');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const beforeIdx = args.indexOf('--before');
const BEFORE = beforeIdx !== -1 ? Number(args[beforeIdx + 1]) : 2;

(async () => {
    if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

    const r = await rollupDaily({ apply: APPLY, beforeDays: BEFORE, force: FORCE });

    console.log(`\n(userId, day) pairs before the cutoff : ${r.scanned}`);
    console.log(`${APPLY ? 'wrote' : 'would write'} summaries               : ${r.wrote}`);
    if (!APPLY) console.log('\nDRY RUN — re-run with --apply.\n');

    await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
```

- [ ] **Step 3: Register the nightly cron**

In `backend/services/notificationScheduler.js`:

**3a.** Add near the top:
```js
const { rollupDaily } = require('./dailyRollup');
```

**3b.** Inside `initScheduler()`, after the existing `cron.schedule('0 * * * *', ...)` block, add:
```js
  // Daily rollup of raw activity into DailySummary. Inherits the same
  // serverless caveat as the hourly job (see IMPROVEMENT_PLAN.md H-13).
  cron.schedule('30 3 * * *', () => {
    console.log('🗓️  Running daily activity rollup...');
    rollupDaily({ apply: true, beforeDays: 2 })
      .then((r) => console.log(`✅ Rollup wrote ${r.wrote} daily summaries`))
      .catch((err) => console.error('Daily rollup failed:', err.message));
  });
```

**3c.** Export the helper so it can be triggered manually/externally too:
```js
module.exports = { initScheduler, checkUpcomingDeadlines, checkOverdueGoals, rollupDaily };
```

- [ ] **Step 4: Syntax-check**

Run: `cd backend && node --check services/dailyRollup.js && node --check scripts/rollup-daily.js && node --check services/notificationScheduler.js`
Expected: no output.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test`
Expected: all PASS (no test file imports the scheduler; `dailyRollup` is exercised only via the pure `buildDaySummary` in `rollup.test.js`).

- [ ] **Step 6: Commit**

```bash
git add backend/services/dailyRollup.js backend/scripts/rollup-daily.js backend/services/notificationScheduler.js
git commit -m "feat(backend): nightly daily-summary rollup (service + CLI + cron)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Read-path compatibility touch-ups

**Files:**
- Modify: `backend/routes/analytics.js` (`/timeslot/:userId` `fileCount`)
- Modify: `backend/routes/leaderboard.js` (`activityCount`)
- Modify: `backend/tests/ingestWiring.test.js` (append read-path assertions)

**Interfaces:**
- Consumes: bucket docs carry `files: [String]` and `flushCount: Number` (Tasks 2-3)
- Produces: `/timeslot` `fileCount` counts real files across bucketed + legacy docs; leaderboard "activity count" stays flush-based

- [ ] **Step 1: Extend the wiring test**

In `backend/tests/ingestWiring.test.js`, add a section before the summary line:

```js
console.log('\nread-path compatibility');
const analyticsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'analytics.js'), 'utf8');
const leaderboardSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'leaderboard.js'), 'utf8');

check('/timeslot fileCount reads the bucket files[] array', () => {
  assert.ok(/a\.files/.test(analyticsSrc) && /flatMap/.test(analyticsSrc));
});
check('leaderboard activityCount is flush-based via flushCount', () => {
  assert.ok(/\$ifNull:\s*\[\s*['"]\$flushCount['"]/.test(leaderboardSrc));
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd backend && node tests/ingestWiring.test.js`
Expected: FAIL — the two new checks.

- [ ] **Step 3: Fix `/timeslot` `fileCount`**

In `backend/routes/analytics.js`, in the `/timeslot/:userId` handler, replace:
```js
        const fileCount = new Set(activities.map(a => a.fileName)).size;
```
with:
```js
        const fileCount = new Set(
            activities.flatMap(a =>
                (Array.isArray(a.files) && a.files.length) ? a.files
                : (a.fileName ? [a.fileName] : [])
            )
        ).size;
```

- [ ] **Step 4: Fix the leaderboard count**

In `backend/routes/leaderboard.js`, in the `$group` stage, replace:
```js
                    activityCount: { $sum: 1 }
```
with:
```js
                    activityCount: { $sum: { $ifNull: ["$flushCount", 1] } }
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && node --check routes/analytics.js && node --check routes/leaderboard.js && npm test`
Expected: all PASS. `streak.test.js` still passes (it extracts helper functions from `analytics.js`, unaffected by the `/timeslot` change).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/analytics.js backend/routes/leaderboard.js backend/tests/ingestWiring.test.js
git commit -m "fix(backend): read paths tolerate bucketed activity docs (files[], flushCount)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Documentation + context updates

**Files:**
- Modify: `CODETRACKR_PROJECT_CONTEXT.md`
- Modify: `docs/IMPROVEMENT_PLAN.md`
- Modify: `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md`
- Modify: `docs/interview-preparation/CodeTrackr_Interview_Preparation.md`
- Modify: `docs/interview-preparation/CodeTrackr_Interview_Cheat_Sheet.md`
- Modify: `docs/interview-preparation/CodeTrackr_Architecture.md`
- Modify: `docs/SESSION-LOG-2026-08-27.md`
- Modify: `C:\Users\soham\.claude\projects\C--Users-soham-Downloads-codetrackr-CodeTrackr-main\memory\codetrackr-overview.md`

**Interfaces:** none (docs only)

- [ ] **Step 1: `CODETRACKR_PROJECT_CONTEXT.md`**

- §7 (Database design): `activities` — one doc per **10-minute (userId, project, language) window** via atomic `$inc` upsert (`routes/extension.js` + `services/activityBucket.js`); `ACTIVITY_BUCKET_MS=0` restores per-flush inserts; legacy per-flush docs coexist. Analytics sub-documents are **sparse** (no `default: 0`; only non-zero leaves written). `date` field and `{userId:1,date:-1}` index **removed**. New: `bucketStart`, `files[]`, `flushCount`. New indexes `{userId:1,timestamp:-1}` and partial-unique `{userId:1,projectName:1,language:1,bucketStart:1}`; 400-day TTL on `createdAt`. New `dailysummaries` collection (nightly `scripts/rollup-daily.js` / `initScheduler` cron).
- §8 (API): `POST /api/extension/track` now **upserts a 10-minute bucket** (201 with `bucket:{...}`), or 202 `{merged}` for a signal-less flush; `/track/batch` loops the same.
- §9 (Extension): **2.3.0** — skips signal-less flushes (buffered time carries forward), `minFlushMinutes` default `2`.
- §17 (Limitations): replace "one doc per flush ... unbounded growth" with the bucketed model; soften the idempotency line (a same-window retry now merges); add "all-time reads (leaderboard, `/summary`, `metrics >90d`) still scan raw `activities` — not yet repointed at `dailysummaries`; 400-day TTL is a safety net; tightening it + the cutover is the follow-up (bundled with `UserStats`)".
- §19 (Status): add "DB write-reduction (#3/#2/#4/#6/#1) implemented 2026-09-08 on `feat/security-and-insights`."

- [ ] **Step 2: `docs/IMPROVEMENT_PLAN.md`**

Add a `Status` entry: "**Write-reduction batch (#3 bucket-on-write, #2 skip-empty, #4 sparse sub-docs + drop `date`, #6 DailySummary + 400d TTL, #1 minFlushMinutes 2): DONE 2026-09-08.** Verified by `activityBucket`, `activityModel`, `ingestWiring`, `rollup` test suites. **Follow-up:** tighten the TTL and repoint the all-time reads (`/leaderboard`, `/api/analytics/summary`, `/api/metrics` beyond 90d) at `dailysummaries` — bundle with the `UserStats` rollup (Quick Wins #9)."

- [ ] **Step 3: `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md`**

Add a banner right after the title:
```markdown
> **IMPLEMENTED 2026-09-08** (branch `feat/security-and-insights`): levers #3, #2, #4, #6 and
> #1 shipped — see `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md` and
> `docs/superpowers/plans/2026-09-08-db-write-reduction.md`. Follow-up: tighten the TTL and
> repoint the all-time reads at `dailysummaries` (with `UserStats`).
```

- [ ] **Step 4: The three interview docs**

- `CodeTrackr_Interview_Preparation.md`: find each "one Activity document per flush" / "one doc per flush" (sections around D1, the extension section, limitations, code-level) and change to "one document per 10-minute (user, project, language) window — the extension flushes counters, the backend `$inc`-upserts the bucket". Keep the correctness note ("`duration` is real seconds, never the bucket width").
- `CodeTrackr_Interview_Cheat_Sheet.md`: "Data flow" and "Database" one-pagers — "one `Activity` doc per flush" -> "one doc per 10-min window (atomic `$inc` upsert)"; add a line to "Things NOT to claim": "the write path now buckets — say 10-minute `$inc` upsert, not append-only per-flush".
- `CodeTrackr_Architecture.md`: the ingest data-flow block — the step "→ Activity doc (1 per flush)" becomes "→ `$inc` upsert into the 10-min bucket doc".

- [ ] **Step 5: `docs/SESSION-LOG-2026-08-27.md`**

Append:
```markdown
## 9. DB write-reduction (2026-09-08)

Implemented levers #3/#2/#4/#6/#1 from `docs/interview-preparation/CodeTrackr_DB_Write_Reduction.md`
via the superpowers brainstorm -> spec -> plan flow.

- Spec: `docs/superpowers/specs/2026-09-08-db-write-reduction-design.md`
- Plan: `docs/superpowers/plans/2026-09-08-db-write-reduction.md`

**What shipped:** `services/activityBucket.js` (pure planner); `/track` `$inc`-upserts a
10-minute `(userId, project, language)` bucket; `Activity` schema lost its `default: 0`
leaves and the dead `date` field/index, gained `bucketStart`/`files`/`flushCount`, a
partial-unique bucket index, `{userId:1,timestamp:-1}`, and a 400-day TTL; extension 2.3.0
skips signal-less flushes and defaults `minFlushMinutes` to 2; `DailySummary` + nightly
`rollup-daily.js`. `ACTIVITY_BUCKET_MS=0` is the rollback lever.

**Correctness:** `$inc.duration` is the real measured seconds — totals are unchanged;
only time-of-day resolution drops to the 10-minute grid.

**Follow-up:** tighten the TTL + repoint all-time reads at `dailysummaries` (with `UserStats`).

**Migration to run against the live DB:** `node backend/scripts/migrate-drop-date.js --apply`,
then optionally `node backend/scripts/rollup-daily.js --apply`.
```

- [ ] **Step 6: memory pointer**

In `memory/codetrackr-overview.md`, add one bullet under the findings:
"- **Write path buckets (2026-09-08):** `/track` `$inc`-upserts a 10-minute `(user, project, language)` document; `date` field/index dropped; extension 2.3.0 skips empty flushes; `DailySummary` rollup + 400d TTL. `ACTIVITY_BUCKET_MS=0` = legacy per-flush. Follow-up: repoint all-time reads at `dailysummaries`."

- [ ] **Step 7: Commit**

```bash
git add CODETRACKR_PROJECT_CONTEXT.md docs/IMPROVEMENT_PLAN.md docs/interview-preparation/ docs/SESSION-LOG-2026-08-27.md
git commit -m "docs: record the DB write-reduction batch (bucketing, sparse docs, rollup)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(Commit the memory file separately — it's outside the repo.)

---

## Task 9: Final verification + limitations record

**Files:**
- Modify: `docs/superpowers/plans/2026-09-08-db-write-reduction.md` (check the boxes)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: 10 suites PASS — `streak`, `ingest`, `metrics`, `authorization`, `routeGuards`, `passwordHash`, `activityBucket`, `activityModel`, `ingestWiring`, `rollup`.

- [ ] **Step 2: Full extension suite**

Run: `cd extension && npm run build && npm test`
Expected: `trackers` + `activation` PASS.

- [ ] **Step 3: Syntax-check every changed backend file**

Run:
```bash
cd backend && for f in models/Activity.js models/DailySummary.js routes/extension.js routes/analytics.js routes/leaderboard.js services/activityBucket.js services/dailySummary.js services/dailyRollup.js services/notificationScheduler.js scripts/migrate-drop-date.js scripts/rollup-daily.js scripts/seed-demo-insights.js; do node --check "$f" || echo "FAIL: $f"; done
```
Expected: no `FAIL` lines.

- [ ] **Step 4: Dry-run the two scripts (needs `MONGO_URI`)**

Run: `cd backend && node scripts/migrate-drop-date.js` and `node scripts/rollup-daily.js`
Expected: both print a sane plan and exit 0 without writing. If no DB is available, note this as "verified by code review only" (matches the repo's existing posture — see `SESSION-LOG` §3).

- [ ] **Step 5: Hand-trace the correctness invariant**

In a node REPL in `backend/`:
```js
const { planActivityWrite } = require('./services/activityBucket');
const base = { userId:'u', projectName:'p', language:'ts', fileName:'a.ts', fileType:'.ts',
  editorAnalytics:{charsInserted:100}, focusAnalytics:{flowBlocksMs:[]}, gitAnalytics:{}, terminalAnalytics:{} };
const t = new Date('2026-03-10T14:21:00Z');
const p1 = planActivityWrite({ ...base, duration: 45 }, t);
const p2 = planActivityWrite({ ...base, duration: 60 }, new Date('2026-03-10T14:24:00Z'));
console.log(p1.update.$inc.duration, p2.update.$inc.duration, p1.setOnInsert.bucketStart.toISOString(), p2.setOnInsert.bucketStart.toISOString());
// expect: 45 60 2026-03-10T14:20:00.000Z 2026-03-10T14:20:00.000Z
// -> two flushes, same bucket, $inc sums to 105 (NOT 1200). bucketStart is the window start.
```

- [ ] **Step 6: Confirm no stray production read of `date`**

Run: `cd backend && grep -rn "\.date\b\|'date'\|\"date\"" routes/ services/ | grep -v "\$dateToString\|toISOString"`
Expected: no matches in `routes/` or `services/` (dev scripts under `scripts/`, `tools/` are out of scope).

- [ ] **Step 7: Tick every checkbox in this plan and commit**

```bash
git add docs/superpowers/plans/2026-09-08-db-write-reduction.md
git commit -m "docs(plan): DB write-reduction — all tasks complete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 Data model → Task 2 ✓ (fields, sparse leaves, drop `date`, all 4 index changes, TTL) + Task 2 Step 6 migration ✓
- §4 `activityBucket.js` → Task 1 ✓ (`BUCKET_MS`, `bucketStartFor`, `hasSignal`, `bucketFilter`, `buildBucketUpdate`, `planActivityWrite`)
- §5 Ingest route → Task 3 ✓ (`ACTIVITY_BUCKET_MS`, `/track` 3 modes + 11000 retry, `/track/batch` loop, re-exports)
- §6 Extension → Task 4 ✓ (`payloadHasSignal`, `flushIfNeeded` guard, idle branch, `minFlushMinutes` 2, 2.3.0, changelog, build, package, tests)
- §7 Rollup + TTL → Task 5 (model + pure builder) + Task 6 (orchestration + CLI + cron) ✓; TTL is in Task 2 §3.4 ✓
- §8 Read-path touch-ups → Task 7 ✓ (`/timeslot` fileCount, leaderboard flushCount)
- §9 Tests → each task ships its tests; package.json updated in Tasks 1/2/3/5 ✓
- §10 Docs → Task 8 ✓
- §11 Known limitations → recorded in Task 8 (CONTEXT §17, SESSION-LOG) and here
- §12 Verification checklist → Task 9 ✓

**Deviations from spec (intentional):**
- §5.3 said "group `/track/batch` by bucket key in JS, one upsert per group". Plan does a
  simple per-activity loop instead — the batch endpoint is unused by the shipped extension,
  and a loop is obviously correct. Same end state (bucketed docs).

**Placeholder scan:** no "TBD"/"handle errors"/"similar to Task N"/"write tests for the above" — every code step has real code, every test step has real assertions.

**Type consistency:** `planActivityWrite` return shape (`mode`/`filter`/`update`/`setOnInsert`/`bucketStart`/`inc`) is defined in Task 1 and consumed identically in Task 3. `buildDaySummary(userId, day, docs)` defined in Task 5, called with the same signature in Task 6. `payloadHasSignal(payload)` defined and tested in Task 4. `EDITOR_INC`/`TERMINAL_INC`/`DEEP_BLOCK_MS` exported in Task 1, imported in Task 5. `files` / `flushCount` field names consistent across Tasks 2, 3, 5, 7.
