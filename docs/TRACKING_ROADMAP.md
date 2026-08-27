# CodeTrackr — Tracking & Analytics Roadmap

_Written 2026-08-28. Companion docs: `ARCHITECTURE.md` (how it works today), `IMPROVEMENT_PLAN.md` (what's broken)._

This is a spec, not a record of work done. Nothing here is implemented yet.

---

## The principle

Today CodeTrackr measures **volume**: minutes, lines, command counts. Volume answers "how much?" and produces insights like _"you coded 24 hours this week"_ — which the user already knew.

Refined productivity analytics measure **rhythm and feedback loops**. Those answer "how well, and what changed?" and produce insights the user cannot see about themselves:

> _"Your longest unbroken coding block fell from 74 minutes to 19 over three weeks, while total hours stayed flat."_

Two developers can log identical hours and have completely different days. Everything below exists to make that difference visible.

Organising frame — **the four F's**. Every metric belongs to one:

| | Question | Core signals |
|---|---|---|
| **Focus** | Am I on one thing or many? | context switches, window focus, unique files |
| **Flow** | Am I getting uninterrupted depth? | block length distribution, interruption density |
| **Feedback** | How fast do I learn I'm wrong? | edit→test latency, mean time to green |
| **Friction** | How much effort is rework? | churn, error density, undo rate, repeated failures |

---

## Part 0 — Fix before adding

Two existing signals are actively misleading. Adding metrics on top of them compounds the error.

**F-1. `linesAdded` / `linesRemoved` are net line-count deltas.**
`extension.ts` diffs `doc.lineCount` against a previous value. Delete 10 lines and write 10 replacements and it records **zero**. Refactoring — the most skilled work — reads as idleness.
→ Use `event.contentChanges`: `change.text` for inserted characters, `change.rangeLength` for removed. Keep gross insert and gross delete as separate counters; never collapse to a net figure.

**F-2. Git activity only counts terminal commands.**
`gitTracker.ts` classifies commands typed into the integrated terminal. Commits made through VS Code's Source Control panel, GitLens, or any GUI register as **zero**. For most users that is most of their commits.
→ Use the built-in Git extension API:
```ts
const git = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
const repo = git?.repositories[0];
repo?.state.onDidChange(() => {
  // repo.state.HEAD?.commit, .name
  // repo.state.workingTreeChanges.length, .indexChanges.length
});
```
This also yields **uncommitted work age**, which terminal parsing can never provide.

---

## Part 1 — Raw signals to capture

All of these are **counters or durations accumulated in the extension** and flushed with the existing payload. No new endpoint, no event streaming, no schema redesign — they slot in beside `terminalAnalytics`.

### Tier A — build first (highest insight per line of code)

| Signal | API | Notes |
|---|---|---|
| Context switches | `window.onDidChangeActiveTextEditor` | Already subscribed; just count it |
| Unique files touched | derive from the same event | Set size per interval |
| Flow blocks | existing idle detection | Emit array of completed block lengths |
| Window focus / blur | `window.onDidChangeWindowState` | `state.focused` — removes phantom time |
| Read vs. write time | editor focused, no `contentChanges` arriving | Comprehension vs. authoring |
| Gross chars in/out | `onDidChangeTextDocument` | Replaces the broken net-line metric |
| Undo / redo count | `event.reason === TextDocumentChangeReason.Undo` | Free hesitation signal |
| Save count | `onDidSaveTextDocument` | Denominator for several ratios |

### Tier B — high value, moderate effort

| Signal | API | Notes |
|---|---|---|
| Errors introduced / resolved | `languages.onDidChangeDiagnostics` + `languages.getDiagnostics(uri)` | Timestamp appearance and clearance to get resolution time |
| Peak concurrent error count | same | How deep in the red you go |
| Per-language error breakdown | same, keyed by `document.languageId` | Where you're weakest |
| Churn lines | track inserted lines, mark those deleted within 10 min | The single best "spinning vs. progressing" signal |
| Task outcomes | `tasks.onDidEndTaskProcess` → `exitCode` | Reliable build/test results for task-run builds, unlike terminal parsing |
| Debug session depth | existing `DebugTracker` | Duration, breakpoints, exceptions |
| Git state | Git extension API (F-2) | Commits, files changed, uncommitted age |

### Tier C — useful, lower priority

| Signal | API | Notes |
|---|---|---|
| Large-insert count and size | `contentChanges` with `text.length > 80` | Frame as "large inserts", **not** as a copy-paste judgement |
| Cold-start latency | activation → first edit | Time to get going |
| Selection / cursor activity | `onDidChangeTextEditorSelection` | Distinguishes active reading from an idle open file |
| Terminal command repetition | existing `repeatedFailedCommands` | Already captured, not yet surfaced |

---

## Part 2 — Proposed schema additions

Additive only. Existing documents keep working; missing sub-documents read as zero. `terminalAnalytics` is untouched for backward compatibility with published extension versions.

```js
// models/Activity.js — new sub-documents

editorAnalytics: {
  charsInserted, charsDeleted,          // gross, from contentChanges
  linesInserted, linesDeleted,          // gross
  churnLines,                           // written then deleted within 10 min
  undoCount, redoCount,
  saveCount,
  fileSwitches,
  uniqueFiles,
  readMs, writeMs,                      // comprehension vs. authoring
  largeInsertCount, largeInsertChars
},

focusAnalytics: {
  focusedMs, blurredMs,
  blurEvents,
  flowBlocksMs: [Number],               // completed uninterrupted blocks
  longestBlockMs
},

diagnosticsAnalytics: {
  errorsIntroduced, errorsResolved,
  warningsIntroduced,
  resolutionMsTotal, resolutionCount,   // mean = total / count
  peakErrorCount,
  byLanguage: { /* languageId -> { introduced, resolved, resolutionMsTotal } */ }
},

debugAnalytics: {
  sessions, totalMs, breakpointHits, exceptions
},

gitAnalytics: {                          // from the Git extension API
  commits, filesChanged,
  linesCommitted,
  uncommittedAgeMs,
  uncommittedFiles
}
```

Payload grows by roughly 1–2 KB of JSON per flush. Negligible.

### Privacy rules (non-negotiable)

- **Never** send file contents, diffs, or commit messages.
- Hash absolute file paths; transmit only basename + extension.
- Keep the existing command sanitiser and extend it to branch names.
- `churn`, `readMs`, `undoCount`, `largeInsertCount` and every diagnostics figure are **private to the user**. They must never feed the leaderboard or group comparisons — that turns a self-awareness tool into surveillance. Leaderboards stay on coarse volume.

---

## Part 3 — Derived metrics

These are **computed server-side in the planned `metricsService.js`** from the raw counters above. This is where the analytics stop being a dashboard and start being insight. Each one is deterministic, testable, and grounded — exactly what the AI layer needs as input.

### Focus

**1. Deep Work Ratio** = `time in blocks ≥ 25 min ÷ total tracked time`
One headline number for the whole system. Trends better than any raw count.
> _"38% of your time was deep work this week, down from 61%."_

**2. Context-Switch Cost** — compare output quality (churn ratio, error density) in the 10 minutes after a project switch against steady-state.
> _"After switching projects you take 14 minutes to return to your normal edit rate. You switched 9 times on Wednesday."_

**3. Interruption Density** = blur events per focused hour.

### Flow

**4. Flow-block distribution** — median, longest, and count of blocks ≥25 min. Report the distribution, never just the sum.

**5. Session archetype classification** — cluster each session from its ratios:

| Archetype | Signature |
|---|---|
| Deep build | high write, low churn, low error density |
| Debug grind | high debug time, high error count, low net lines |
| Exploration | high read ratio, low write, many file switches |
| Admin / config | high terminal, low editor time |

Then show the **weekly mix**. This is what makes analytics feel intelligent rather than arithmetic.
> _"Half your week was debug grind, up from 20%. Most of it was in `payments/`."_

**6. Marginal productivity by session hour** — compare churn and error density in hours 1–2 against hour 4+.
> _"Your error rate roughly triples after your third continuous hour."_
Probably the most behaviour-changing metric in this document.

### Feedback

**7. Feedback-loop latency** = median time from first edit to first test or build run.

**8. Mean Time To Green (MTTG)** = median time from first failing build/test to the next passing one.

**9. Error resolution time, by language.**
> _"TypeScript errors take you 45 seconds on average; Python errors take 6 minutes."_
Actionable — it points straight at a tooling or knowledge gap.

### Friction

**10. Churn ratio** = `churnLines ÷ linesInserted`, per project and per language. Rework hotspots.

**11. Error density** = errors introduced per 100 lines written, per language. A learning curve when tracked over months.

**12. Rework hotspots** — files ranked by repeated high churn across sessions. Sustained high churn in one file is a design problem, not a discipline problem.

**13. Comprehension load** = `readMs ÷ (readMs + writeMs)` per project, tracked over time. It should **fall** as you learn a codebase. If it doesn't, the code is hostile.

### Rhythm and habit

**14. Consistency index** = coefficient of variation of daily minutes over 4 weeks. Low variance beats high totals for sustainability — and it is a better headline than a raw streak.

**15. Quality streak** — consecutive days containing at least one ≥25-minute deep block. A 30-day streak of 3-minute sessions is noise; this isn't.

**16. True peak window** — the 2-hour window with the best *combined* score (commits, low churn, low error density), **not** the one with the most minutes. "Most active" and "most productive" are frequently different hours, and today you only compute the former.

**17. Project momentum** = trend of commits and net lines per project, plus days since last touch. Surfaces stalled work.

**18. Estimation calibration** — you already have the `Goal` model with `targetHours`. Compare against actual hours logged against that tech stack.
> _"You finish goals at about 1.8× your estimate. Your last four were all underestimated."_
This uses **data you already collect** and needs no new tracking at all — the cheapest high-value item in this document.

### Wellbeing (frame supportively, never as judgement)

**19. Boundary metrics** — share of coding outside 09:00–18:00, late-night session count, weekend ratio. Present as observation, never as praise for late nights.

---

## Part 4 — Suggested phasing

**Phase A — ✅ DONE 2026-08-28 (extension 2.1.0).** Implemented via `superpowers/plans/2026-08-28-tracking-phase-a.md`.
Verified by 32 extension assertions and 33 backend assertions. Next up: Phase B.

**Phase A (original scope) — fix + cheap wins.** F-1, F-2, then Tier A signals. Derived: Deep Work Ratio, flow-block distribution, true peak window, consistency index, estimation calibration (#18 needs no new tracking).

**Phase B — the friction layer.** Tier B signals. Derived: churn ratio, error density and resolution time, MTTG, feedback-loop latency, rework hotspots.

**Phase C — the interesting one.** Session archetypes, marginal productivity by hour, context-switch cost, comprehension load trend.

Phase A alone changes the product from "hours counter" to "productivity analytics". Ship it before the AI insights layer, because these are the metrics that layer should be reasoning over — an LLM given only totals can only rephrase totals.

---

## Part 5 — How this feeds the AI layer

Each derived metric maps to one grounded insight template. The AI's job is **selection, phrasing and correlation** — never invention of numbers.

```
StructuredMetrics {
  deepWorkRatio, flowBlocks{median,longest,count},
  contextSwitchesPerHour, comprehensionLoad,
  churnRatio, errorDensityByLanguage, meanResolutionMsByLanguage,
  feedbackLoopMedianMs, mttgMedianMs,
  sessionArchetypeMix, marginalProductivityByHour,
  consistencyIndex, qualityStreak, truePeakWindow,
  estimationCalibrationFactor, projectMomentum[]
}
```

The validator described in the AI design must reject any generated figure not traceable to this object. With metrics this specific, the model has enough real material that it never needs to reach for filler — which is the actual defence against generic motivational output.

---

## What not to track

- **Keystroke counts.** Gameable and they reward verbose typing.
- **Lines of code as achievement.** The 60× units bug in `goals.js` is a standing reminder of how misleading raw counts are.
- **A single composite "productivity score."** It collapses exactly the distinctions this document exists to create, and it invites comparison. Report the four F's separately.
- **Anything comparative by default.** Focus, churn and read-ratio are for self-comparison over time, not ranking against other people.
