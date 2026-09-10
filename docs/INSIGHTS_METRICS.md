# CodeTrackr — Insights Metric Reference

> **What this file is.** The definition of record for every number on the Insights page: what
> it measures, the exact formula, the units, how it degrades on thin data — and, where a
> formula changed on 2026‑09‑10, what it used to be and why that was wrong.
>
> **Rule:** if a metric cannot be computed honestly from data the extension actually collects,
> it is not shown. Nothing here is estimated, imputed, or padded.
>
> Implementation: `backend/services/metricsDerive.js` (pure maths, unit-tested) and
> `backend/services/metricsService.js` (aggregation). Tests: `backend/tests/metrics.test.js`,
> `backend/tests/metricsService.test.js`.

---

## 0. What the raw inputs actually mean

Every formula below is only as good as its inputs, and several inputs do **not** mean what
their names suggest. Traced from the tracker source, not from documentation.

| Input | Real meaning | Consequence for formulas |
|---|---|---|
| `duration` (s) | Wall-clock seconds of the flush interval, **including idle under 2 minutes** | Slightly inflates all time totals. Not "active coding time". |
| `focusAnalytics.focusedMs` | Time the **VS Code window was in the foreground**. No activity required. | Not a work clock. Never use it as a denominator for work-quality ratios. |
| `focusAnalytics.flowBlocksMs[]` | **Activity-bounded** stretches: first activity → last activity, closed after 2 min idle | The best "real work" signal available. A block that spans several flushes is emitted **once, in full**, in the flush where it closes — so a 10-minute bucket may contain a 60-minute block. |
| `editorAnalytics.linesInserted` | Count of **newline characters** inserted | A long single-line edit counts 0. It is a proxy for lines, not a count of them. |
| `editorAnalytics.linesDeleted` | **Line boundaries spanned** by a deletion | Intra-line deletion counts 0. |
| `editorAnalytics.churnLines` | Deleted lines matched against insertions ≤ 10 min old | Bounded above by `linesInserted`, so `churnLines / linesInserted ∈ [0,1]`. |
| `editorAnalytics.readMs` / `writeMs` | 5-second attention samples: an edit in the last 5 s ⇒ `writeMs`, else `readMs`. Sampled only while focused | `readMs + writeMs` ≈ focused time, on a **different clock** from `focusedMs`. |
| `editorAnalytics.fileSwitches` | `onDidChangeActiveTextEditor` firings | Fires on opens, diffs and previews too — a noisy proxy. |
| `gitAnalytics.commits` | `HEAD.commit` changed | Rebase/amend also moves HEAD. |
| `terminalAnalytics.*` | Shell execution counts + exit codes | Counts are additive; `successRate`/`buildSuccessRate` are **derived percentages** and are recomputed on read, never summed. |

**Two limits that bound every time-of-day metric:**
1. Activity is stored in **10-minute buckets**, so timing resolution is ±10 minutes.
2. Idle under 2 minutes counts toward `duration`.

Neither is claimed away anywhere below.

---

## 1. Confidence gating (applies to every metric)

Before 2026‑09‑10 a number computed from three days of data rendered identically to one backed
by six months. Every metric now ships a sidecar:

```js
metrics.meta[name] = { confidence: 'insufficient' | 'low' | 'high', sampleSize, unit }
```

`confidenceFor(sample, { min, good })` → below `min` it is **`insufficient`** and the UI renders
`—` plus "needs more data"; at or above `good` it is `high`; between, `low` (badged "early").

| Metric | Sample unit | `min` | `good` |
|---|---|---|---|
| `deepWorkRatio`, `flowBlocks` | flow blocks | 3 | 12 |
| `volumeStability` | active days | 3 | 10 |
| `activeDaysRatio` | days observed | 3 | 14 |
| `truePeakWindow` | distinct days in the window | 3 | 10 |
| `churnRatio` | lines inserted | 50 | 500 |
| `comprehensionLoad` | attention ms | 600 000 (10 min) | 7 200 000 (2 h) |
| `contextSwitchesPerHour` | focused hours | 0.5 | 5 |
| `estimationCalibration` | completed goals | 1 | 3 |

---

## 2. Deep work ratio

**Measures:** of the time you were *actually working*, the share spent in unbroken stretches of
25 minutes or more. **Unit:** ratio, 0–1.

```
blocks   = flowBlocksMs filtered to finite, > 0
deepMs   = Σ blocks where block ≥ 25 min
totalMs  = Σ blocks
deepWorkRatio = totalMs > 0 ? deepMs / totalMs : 0
```

### What it was, and why that was wrong

```
deepWorkRatio = deepMs / totalFocusedMs        ← removed 2026-09-10
```

Two independent defects:

1. **It divided two different clocks.** `deepMs` comes from flow blocks, which are
   activity-bounded. `totalFocusedMs` is wall-clock window-foreground time. A flow block stays
   open across a brief alt-tab, while `focusedMs` does not accrue during it — so the ratio
   could legitimately exceed 1. There is no meaningful "112 % deep work".
2. **The denominator was corrupted.** `FocusTracker` accrued `focusedMs` on its own 15-second
   ticker, independent of the main loop's idle-pause, and nothing consumed it while paused.
   Leaving VS Code focused and walking away for five hours added five hours to the next
   flush's `focusedMs`. Worked example — code 09:00–09:30, return 14:00: the next flush
   reported ≈ 5 h focused, so the ratio collapsed toward 0. **This is why the metric read as
   near-zero for real users.** Fixed in extension 2.4.0 (`FocusTracker.setPaused`).

Dividing by total block time puts both sides on the same clock, bounds the result to [0,1] by
construction, and answers the question the label actually implies.

---

## 3. Flow block distribution

**Measures:** the *shape* of your working stretches. Eighteen 5-minute blocks and one 90-minute
block both total 90 minutes and mean completely different things — so this reports the
distribution, never the sum. **Unit:** milliseconds / counts.

```
medianMs, longestMs, totalMs, blockCount,
deepBlockCount = |{ block ≥ 25 min }|
```

Unchanged apart from adding `totalMs` (needed as the deep-work denominator).

---

## 4. Volume stability  *(was: "Consistency index")*

**Measures:** how even your daily volume is **on the days you actually coded**.
**Unit:** ratio, 0–1.

```
med  = median(dailyMinutes > 0)
mad  = median(|dailyMinutes − med|)
volumeStability = clamp(1 − mad / med, 0, 1)
```

### What it was, and why that was wrong

```
consistencyIndex = clamp(1 − stddev/mean, 0, 1)     ← coefficient of variation
```

1. **It never measured what its name claimed.** The daily aggregate emits no row for a day with
   zero activity, so zero-days were invisible. Someone who coded five days, vanished for ten,
   then coded five more scored as highly "consistent". The UI labelled it "Consistency" and
   told users "you code at a steady daily rhythm" — a claim the formula could not support.
2. **CV is dominated by one outlier.** A single 10-hour Saturday collapsed a month of steady
   work. `1 − MAD/median` is robust: the test asserts `[60,60,60,60,600]` still scores ≥ 0.9.

The cadence question people *thought* they were seeing is now answered separately, by
`activeDaysRatio`. `consistencyIndex` remains exported as an alias so the API stays
backward-compatible.

---

## 5. Coding cadence  *(new)*

**Measures:** the share of days in the window on which you coded at all. This is what
"consistency" colloquially means. **Unit:** ratio, 0–1.

```
activeDaysRatio = clamp(activeDays / observedDays, 0, 1)
```

`observedDays = min(windowDays, max(activeDays, 1))` — the window can only be as long as the
data actually spans, so a brand-new user is not scored against 30 days they were never tracked
for.

---

## 6. Quality streak  *(new — roadmap #15)*

**Measures:** consecutive days, ending today or yesterday, containing at least one block of
≥ 25 minutes. **Unit:** days.

A 30-day streak of three-minute sessions is noise; this is not. Anchoring on *yesterday* as
well as today means the streak does not read as broken before you have started work today.

---

## 7. True peak window

**Measures:** the two-hour window of the day in which the most of your output *survived*.
**Unit:** hour range, scored in surviving minutes.

```
per hour:  churnRatio = linesInserted > 0 ? min(1, churnLines / linesInserted) : 0
           surviving  = minutes × (1 − churnRatio)

per 2-hour window w = (h, h+1):
           score = surviving(h) + surviving(h+1)
           days  = max(distinctDays(h), distinctDays(h+1))
           eligible iff days ≥ 3 and score > 0

truePeakWindow = argmax(score) over eligible windows      // null if none
```

### What it was, and why that was wrong

```
score = commits × 10 + linesInserted / 10 − churnLines / 5     ← removed
best  = argmax over single hours with minutes > 0
```

1. **No sample floor.** Any hour with any minutes was eligible. One commit in an hour you had
   coded in *exactly once* over 30 days scored 10 and beat a consistently productive morning.
   The `days` floor is the single most important part of this fix.
2. **Unvalidated magic weights.** Why ×10, /10, /5? Nothing justified them, and they made the
   output an uninterpretable score rather than a quantity. Commits are now excluded entirely:
   they are bursty, and a one-line typo fix counted the same as a day's work.
3. **Wrong window size.** `TRACKING_ROADMAP.md` #16 specifies a **two-hour** window; the code
   used one hour.

"Surviving minutes" needs no weights, is expressed in a real unit, and directly encodes the
distinction the metric exists to make — *productive* is not *busy*.

---

## 8. Estimation calibration

**Measures:** how far your completed goals ran over (or under) their estimate.
**Unit:** multiplier (1.4× = you take 40 % longer than you think).

```
per completed goal with techStack and targetHours > 0:
    window   = [goal.createdAt, goal.completedAt]
    actual   = Σ duration of activity in `window`
               where language OR projectName matches techStack (case-insensitive, exact)
    skip the goal entirely if actual == 0        // never fabricate a zero
    ratio    = actual hours / targetHours

factor    = median(ratios)          // median, not mean
minFactor = min(ratios)
maxFactor = max(ratios)
```

### What it was, and why that was wrong

**This metric could never produce a value in production.** It requires goals with
`status: 'completed'`, and **no route in the application ever set that** — only
`scripts/seed-demo-insights.js` did. It has now been given the missing state transition:
`PATCH /api/goals/:goalId/complete` (owner-scoped), a `Goal.completedAt` field, and a button on
the Goals page.

Three further defects in the calculation itself:

1. **The join was broken.** `language === goal.techStack` — an exact, case-sensitive match on a
   free-text field. A goal tagged "React" matched nothing at all, because activity is logged
   with `languageId` values like `typescript` and `typescriptreact`.
2. **No date window.** It summed *all activity ever* in that language. A 10-hour "JavaScript"
   goal was measured against every JavaScript hour since the account was created, producing
   ratios in the tens.
3. **Mean over ≥ 2 goals.** The mean let one runaway goal dominate, and the arbitrary
   two-sample floor meant that even after completing a goal you saw nothing. Now it is the
   **median**, reported with its range, and a single goal produces a `low`-confidence value
   rather than silence.

A goal whose stack matches no activity is **skipped**, not recorded as 0 hours — a fabricated
zero would read as "finished instantly", which is worse than no data.

---

## 9. Secondary metrics

| Metric | Formula | Unit | Notes |
|---|---|---|---|
| `churnRatio` | `min(1, churnLines / linesInserted)` | ratio 0–1 | Bounded because churn is matched against insertions. Clamped defensively. |
| `comprehensionLoad` | `readMs / (readMs + writeMs)` | ratio 0–1 | Should **fall** as you learn a codebase. Now trustworthy: read-only intervals used to be discarded entirely (see §10). |
| `contextSwitchesPerHour` | `fileSwitches / focusedHours` | count/hour | `fileSwitches` is a noisy proxy — opens and diffs also fire it. |
| `interruptionsPerHour` *(new — roadmap #3)* | `blurEvents / focusedHours` | count/hour | How often you were pulled out of the window. |
| `commits`, `totalHours`, `focusedHours`, `activeDays` | direct sums | counts / hours | `duration` is stored in **seconds**; every reader divides by 3600. |

---

## 10. Upstream fix that this reference depends on

Three of the metrics above were being fed corrupted data by the extension, independently of
their formulas. Fixed in **2.4.0** (`extension/CHANGELOG.md`, `docs/AUDIT-2026-09-10.md`):

- `buildPayload()` **resets every tracker**, and four paths bailed out *after* that point —
  a signal-less interval, a missing API key, an out-of-range duration, and a failed upload.
  Each silently destroyed the interval. In particular an interval spent **reading code and
  switching files** carries no edits, so `payloadHasSignal` was false and the payload was
  dropped along with its `readMs`, `fileSwitches` and `focusedMs`. `comprehensionLoad`
  therefore **under**-reported reading. Unsent payloads are now merged forward.
- `sendActivity` swallowed its own errors and never rethrew, so the retry path in
  `flushIfNeeded` was unreachable and every failed upload lost its interval — despite the
  documentation claiming the buffer was retried.
- `focusedMs` and `readMs` accrued through idle gaps (see §2).

**Any Insights figure computed from data collected before extension 2.4.0 carries these
biases.** They cannot be corrected retroactively — the lost intervals were never transmitted.

---

## 11. Deliberately not implemented

Not because they are hard, but because the collected data cannot support them honestly. Each
needs an extension change first.

| Metric | Blocked on |
|---|---|
| Edit intensity within a flow block | `flowBlocksMs` stores durations only — no per-block counters exist. |
| Idle-corrected active time | The extension would need to send `activeMs` (time with a real event) alongside `focusedMs`. |
| Edit survival / durable lines | Requires diffing against the last tracked snapshot on commit. Would be the single biggest accuracy upgrade — it reframes every metric from *activity* to *progress*. |
| Error density per 100 lines | No "error introduced" event is captured; terminal failures are not the same thing. |
| Feedback-loop latency, mean-time-to-green (roadmap #7, #8) | Needs event timestamps *within* an interval. 10-minute bucketing caps resolution at ±10 min. |
