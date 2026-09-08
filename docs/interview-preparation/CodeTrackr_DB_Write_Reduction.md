# CodeTrackr — Reducing Database Write Volume & Redundancy

*How to cut the number (and size) of documents written to the `activities` collection.
Verified against the current code. Ordered cheapest → most involved.*

---

## The current picture

- The extension calls `POST /api/extension/track` on a timer; the backend does **one
  `Activity.create()` per request** (`backend/routes/extension.js`).
- A flush fires when buffered active time reaches `minFlushMinutes` (**default 0.5 min**) on
  a `flushIntervalSeconds` (**default 30 s**) tick.
- So during active coding: **~1 document every 30–90 seconds**. A focused 2-hour session ≈
  **80–120 documents**.
- Each document is ~0.5–2 KB and **repeats**:
  - metadata every time: `userId`, `fileName`, `fileType`, `projectName`, `language`, plus
    both `timestamp` **and** `date` (now always equal);
  - the **full shape** of `terminalAnalytics`, `editorAnalytics`, `focusAnalytics`,
    `gitAnalytics` — every field has `default: 0` in `models/Activity.js`, so Mongoose
    writes the whole structure even for a flush where you only typed in one file and touched
    nothing else.

Two problems to attack: **(A) too many rows**, **(B) each row carries mostly-empty structure**.

---

## Lever 1 — Tune the flush cadence *(0 code, immediate, reversible)*

Raise `minFlushMinutes` from `0.5` to `2`–`5` (and optionally `flushIntervalSeconds` to `60`).
Change the defaults in `extension/package.json` `contributes.configuration`, or just set them
in VS Code settings.

- **Effect:** roughly linear. `minFlushMinutes: 3` → a 2-hour session drops from ~100 docs to
  ~20.
- **Trade-off:** (1) coarser granularity — the "10-minute time-slot drill-down"
  (`/api/analytics/timeslot`) and the hourly chart get fewer data points per bucket; (2) a
  crash now loses up to `minFlushMinutes` of buffered time instead of 0.5.
- **Say:** *"The flush interval was a straight knob between write volume and granularity. I
  set it to 3 minutes — still fine for an hourly chart, and 6× fewer writes."*

---

## Lever 2 — Skip flushes that carry no real signal *(small)*

Right now a flush is sent whenever *time* accrued, even if the interval had **zero edits,
zero commands, zero commits, zero completed flow blocks** (you were reading or thinking with
VS Code focused). Those are near-empty documents — and they also inflate "coding time"
(this is finding **L-7**).

**Do** — in `extension/src/extension.ts` `flushIfNeeded`, before `sendActivity`:

```ts
const e = editorAnalytics, t = terminalAnalytics, g = gitAnalytics, f = focusAnalytics;
const hasSignal =
  e.charsInserted > 0 || e.charsDeleted > 0 || e.saveCount > 0 ||
  t.totalCommands > 0 || g.commits > 0 || f.flowBlocksMs.length > 0;
if (!force && !hasSignal) return;   // keep buffering; don't write an empty doc
```

Or enforce it backend-side: if the payload is all-zero and `duration` is tiny, return `204`
and don't insert.

- **Effect:** removes "phantom" documents; on a reading-heavy session this can be 20–40% of rows.
- **Say:** *"I stopped writing a document for an interval where nothing actually happened —
  it cut junk rows and also fixed a small over-count of coding time."*

---

## Lever 3 — Bucket on write: merge flushes into a 10-minute rollup *(the main change)*

Instead of inserting a new document per flush, **upsert into a per-window document** and
`$inc` the counters. Do it **on the backend** so the published extension doesn't change.

**Key:** `(userId, projectName, language, bucketStart)` where `bucketStart` is the flush
`timestamp` floored to a **10-minute boundary**.

**Why 10 minutes:** it's the *finest granularity any current read actually needs* — the
time-slot drill-down uses 10-minute slots, the daily view buckets by hour, streak and metrics
bucket by day. So no dashboard loses fidelity.

**Do** — replace `Activity.create({...})` in `routes/extension.js` with:

```js
const BUCKET_MS = 10 * 60 * 1000;
const bucketStart = new Date(Math.floor(when.getTime() / BUCKET_MS) * BUCKET_MS);

await Activity.findOneAndUpdate(
  { userId, projectName, language, bucketStart },
  {
    $setOnInsert: { userId, projectName, language, bucketStart, timestamp: bucketStart, date: bucketStart },
    $inc: {
      duration: Number(duration),
      linesAdded: num(linesAdded),
      linesRemoved: num(linesRemoved),
      'editorAnalytics.charsInserted': editor.charsInserted,
      'editorAnalytics.churnLines':    editor.churnLines,
      'terminalAnalytics.totalCommands': terminal.totalCommands,
      'gitAnalytics.commits': git.commits,
      // ...one $inc line per additive counter
    },
    $max: { 'focusAnalytics.longestBlockMs': focus.longestBlockMs },
    $push: { 'focusAnalytics.flowBlocksMs': { $each: focus.flowBlocksMs, $slice: -200 } },
    $addToSet: { files: fileName },              // keep a per-bucket file list
  },
  { upsert: true, new: true }
);
```

- **Effect:** a focused 1-hour single-file session goes from **~40–120 docs to ~6** (one per
  10-min window). A whole day of mixed work: tens of docs, not hundreds/thousands.
- **Atomicity:** `$inc` inside one `findOneAndUpdate` is atomic — unlike `server.js.old`,
  which did read-then-`.save()` and had a lost-update race. Two concurrent flushes for the
  same bucket both apply cleanly. (Add a `{ userId:1, projectName:1, language:1, bucketStart:1 }`
  **unique** index; on the rare upsert-insert race you get an `11000` — retry once as an update.)
- **`fileCount` on the drill-down:** it currently does `new Set(a.fileName).size`. Keep it
  working by storing `files: [...]` per bucket (as above), or a `files: { "app.ts": {edits, ms} }`
  map if you want per-file detail back.
- **Backward compatible:** the extension is unchanged, so the Marketplace build keeps working.
- **Say:** *"Ingest was an append-only event log — one row per 30-second flush. I changed it
  to a windowed upsert: flushes for the same user, project and language in the same 10-minute
  window merge into one document with `$inc`. I picked 10 minutes because that's the finest
  bucket any dashboard reads, so nothing lost resolution, and the row count dropped by
  roughly an order of magnitude. The old code tried this with read-then-save and had a race;
  `$inc` in a single update is atomic."*
- **Shows:** event log vs rollup, `$inc` atomicity, choosing a window from read requirements,
  upsert races, backward compatibility with a shipped client.

---

## Lever 4 — Make the analytics sub-documents sparse *(per-document size)*

Attacks redundancy **B**. Today every document carries the full `terminalAnalytics` /
`gitAnalytics` / `focusAnalytics` shape even when all zero.

**Do:**
- In `models/Activity.js`, drop the `default: 0` on the sub-object fields (keep them optional).
- In `routes/extension.js`, only include a sub-object in the write when it has data:
  `...(hasTerminal && { terminalAnalytics }), ...(hasGit && { gitAnalytics })`.
- Drop the **`date`** field entirely — it's always equal to `timestamp` now, nothing queries
  it, and its index (`{ userId: 1, date: -1 }`) is dead weight. Removing the field **and**
  that index is a real redundancy cut.
- On read, treat missing sub-objects as zero (the metrics service already uses `$ifNull`).

- **Effect:** a "just typing in one file" document shrinks from ~1.5 KB to a few hundred
  bytes; less storage, smaller working set, faster scans.
- **Say:** *"Every activity row stored an empty terminal/git/focus object and a duplicate
  date field with its own index. I made the sub-objects optional and dropped the dead `date`
  field and index — same information, roughly a third of the on-disk size."*

---

## Lever 5 — Batch the network path *(round-trips, not rows)*

The `/track/batch` endpoint already exists (`insertMany`) but the extension never calls it.
Have the extension buffer, say, 5 flush-payloads and send them together every few minutes.

```js
const inserted = await Activity.insertMany(prepared, { ordered: false });
```

- **Important distinction:** this reduces **HTTP requests and write-concern round-trips**, not
  document count — you still get one row per flush *unless* you combine it with Lever 3
  (`insertMany` → then bucket, or dedupe within the batch first).
- **Say:** *"Batching cut the request count 5×; combined with the 10-minute bucketing it also
  cuts rows."*

---

## Lever 6 — TTL + history rollup *(bounds the collection long-term)*

Bucketing slows growth; it doesn't stop it. Add:

- A **TTL index** on raw activity: `activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60*60*24*90 })`
  — raw docs self-delete after 90 days.
- A **nightly job** that rolls docs older than ~30 days into one `DailySummary` document per
  `(userId, day)` **before** the TTL removes them, so history charts still work.
- Pairs with the **`UserStats` rollup** already recommended in `CodeTrackr_Quick_Wins.md` #9
  (that one keeps the *leaderboard* fast; this keeps the *raw collection* small).

- **Say:** *"Recent data stays raw for the drill-down; anything older than a month gets rolled
  into a daily summary and the raw rows expire via a TTL index. The working set stays flat
  instead of growing forever."*

---

## What each read path needs (so you know a bucket size is safe)

| Read | Groups by | Safe bucket |
|---|---|---|
| Daily view `/analytics/:userId` | hour of day | ≤ 60 min |
| Time-slot drill-down `/analytics/timeslot` | 10-minute slots | **≤ 10 min** ← the binding one |
| Weekly view `/analytics/weekly` | day | ≤ 1 day |
| Streak `computeStreak` | day | ≤ 1 day |
| Insights `/api/metrics` | day and hour; flow-blocks per doc | ≤ 60 min + `$push` the block arrays |
| Leaderboard | all-time per user | any |

→ **10 minutes** is the sweet spot: every read keeps full resolution.

---

## Recommended combination

1. **Lever 3** (10-minute bucket-on-write) — the headline change, ~10× fewer rows, backend-only.
2. **Lever 2** (skip empty flushes) — free extra reduction + a correctness fix.
3. **Lever 4** (sparse sub-docs, drop `date`) — smaller rows, less index bloat.
4. **Lever 6** (TTL + daily rollup) — keeps it bounded for good.
5. Keep **Lever 1** in your back pocket as the zero-risk knob.

---

## The one-paragraph interview answer

> *"Ingest was an append-only event log — one document per 30-second flush, each repeating
> the file/project/language metadata and a full set of mostly-zero analytics objects, so a
> two-hour session was ~100 tiny rows. I changed it to a windowed rollup: on ingest the
> backend upserts into a per-(user, project, language, 10-minute-window) document and `$inc`s
> the counters, which is atomic in a single update, unlike the earlier read-then-save version
> that had a lost-update race. I chose a 10-minute window because that's the finest bucket
> any dashboard actually reads, so nothing lost resolution and row count dropped by about an
> order of magnitude. On top of that I stopped writing a document for an interval with no
> real activity, made the analytics sub-objects optional so an empty one isn't stored, and
> added a TTL plus a nightly daily-summary job so the raw collection stays bounded instead of
> growing forever."*
