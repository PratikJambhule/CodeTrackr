# Rules engine over the insights metrics

**Added 2026-09-10.** Implementation: `backend/services/rulesEngine.js`. Tests:
`backend/tests/rulesEngine.test.js` (22 assertions). Wired into `GET /api/metrics`,
rendered by `frontend/src/pages/Insights.tsx`.

Companion documents: `docs/INSIGHTS_METRICS.md` (what each metric computes and why),
`docs/AUDIT-2026-09-10.md` (what the raw values actually mean).

---

## 1. What this is

The Insights page produced a grid of numbers and left the reader to interpret them. The rules
engine reads those same numbers and states, in words, the few things worth noticing —
"you are rewriting more than usual", "you do your best work 16:00–18:00".

It runs **in process, on an already-built metrics payload**. It issues no query of its own and
adds no measurable latency.

## 2. What this deliberately is not

**Not a model, and not an LLM.** Every finding is a declarative rule with a stated threshold.
That is a deliberate constraint, not a limitation we intend to lift:

- The whole Insights surface is honest about being deterministic statistics. Adding a
  probabilistic layer on top of ~140 documents of real analytics data would manufacture exactly
  the false authority the 2026-09-10 audit existed to remove.
- A rule can be unit tested against a fixture. A generated sentence cannot.
- The reader can check the claim, because the numbers that produced it travel with it.

If a narration layer is ever added, it should phrase *these findings*, not replace them.

## 3. The three guarantees

Every finding satisfies all three. They are enforced in code, not by convention.

### 3.1 Never fire on data we do not have

A rule declares `requires: ['churnRatio', ...]`. Before it is evaluated, every named metric must
have a `meta` entry whose `confidence` is not `'insufficient'`. This reuses the confidence gate
that already governs whether a number renders at all, so the panel and the grid can never
disagree.

A name that has **no** `meta` entry is treated as a failure, not a pass. This matters: the
natural guard `confidence !== 'insufficient'` evaluates true for `undefined`, so a typo or an
ungated metric would silently make the rule fire on unbacked data. That exact bug shipped once,
in `insightsBaseline`'s key list, where `interruptionsPerHour` was baselined against a vacuous
zero. `validateRules()` now checks every `requires` entry against `GATED_METRICS` **at module
load**, so a bad rule is a startup crash rather than a wrong number on someone's dashboard.

Metrics with no confidence gate (`qualityStreak`, `commits`, `totalHours`, `activeDays`) can
still be read inside a rule body — they are plain counts with nothing to be uncertain about —
but they may not appear in `requires`.

### 3.2 Always show the numbers

Each finding carries `evidence`: the actual values that tripped the threshold.

```json
{
  "id": "peak-window",
  "severity": "info",
  "title": "You do your best work 16:00–18:00",
  "detail": "That two-hour window scored highest on surviving minutes ... across 23 separate days.",
  "evidence": { "startHour": 16, "endHour": 18, "days": 23, "score": 837.25 }
}
```

### 3.3 Skips are visible

`evaluate()` returns `{ findings, skipped, totalFindings }`. `skipped` names each rule that could
not run and which metrics were missing. An empty panel then means "nothing stood out", and the UI
can say how many checks are still waiting on data — rather than implying everything is fine.

## 4. Shape

```js
{
  id: 'churn-spike',            // stable, used as the React key
  category: 'quality',          // quality | focus | rhythm | planning
  severity: 'warning',          // warning | info | positive
  requires: ['churnRatio'],     // gated metric names; validated at load
  evaluate(ctx) {               // -> null (does not fire) | { title, detail, evidence }
    ...
  },
}
```

`ctx` exposes `value`, `num`, `meta`, `confidence`, `sampleSize`, `baseline`, `delta`,
`hasBaseline`. Findings are sorted `warning` → `info` → `positive`, then by declaration order,
and capped (default 6) with `totalFindings` reporting the true count.

A rule that throws is caught and recorded in `skipped` with `reason: 'error'`. One malformed
payload must not take out the panel.

## 5. The rules as shipped

| id | severity | fires when |
|---|---|---|
| `churn-spike` | warning | `churnRatio > 0.3` **and** at least +0.10 over the user's own 90-day baseline |
| `churn-low` | positive | `churnRatio ≤ 0.15` at **high** confidence |
| `fragmented-focus` | warning | `contextSwitchesPerHour > 30` |
| `interruption-heavy` | warning | `interruptionsPerHour > 10` |
| `deep-work-strong` | positive | `deepWorkRatio ≥ 0.5` |
| `deep-work-scarce` | info | `deepWorkRatio < 0.15` |
| `peak-window` | info | `truePeakWindow` is non-null (already carries a ≥3-day floor) |
| `cadence-low` | info | `activeDaysRatio < 0.3` |
| `volume-erratic` | info | `volumeStability < 0.4` |
| `quality-streak` | positive | `qualityStreak ≥ 3` |
| `comprehension-heavy` | info | `comprehensionLoad > 0.7` |
| `estimation-under` | info | `estimationCalibration.factor > 1.25` |
| `estimation-accurate` | positive | `factor` within 0.85–1.15 |

`churn-spike` is the one rule that requires a baseline comparison rather than an absolute
threshold. High churn is normal for some people and some work; a *rise* against your own history
is the part worth saying. With no baseline yet, it stays silent.

## 6. Thresholds are judgement, and are not claimed to be more

The numbers in the table above are reasoned defaults, not empirically derived cut-offs — there is
not enough real data to derive them (see §7). They are all in one file, named, and unit tested,
so they can be revised deliberately. Anything presented as a threshold in the UI is phrased as an
observation, never as a diagnosis.

## 7. Verified against live data, 2026-09-10

Run read-only against the most active real account (6172 activity documents):

| window | active days | findings | skipped |
|---|---|---|---|
| 30 days | 6 | **0** | 10 |
| 365 days | 52 | 2 | 9 |

The 30-day result is the design working. Six sparse days is not enough to say anything, and the
engine says nothing rather than filling the panel. The two findings at 365 days were
`peak-window` (16:00–18:00, 23 distinct days) and `volume-erratic` (stability 0.27 across 52
active days).

Note `flowBlocks.blockCount = 0` in **both** windows — the focus-analytics blocker from
`AUDIT-2026-09-10.md` §7. Until the branch is deployed and real flow-block data arrives, every
focus rule (`deep-work-*`, `fragmented-focus`, `interruption-heavy`) will correctly stay skipped.

## 8. Deliberately not implemented

- **Per-user threshold learning.** Needs far more history than exists, and would make findings
  irreproducible between two people looking at the same screen.
- **Cross-user comparison** ("you churn more than most users"). The leaderboard is the place for
  comparison; insights is a private page, and importing other people's data into it changes what
  it is.
- **Persisting findings / trend-over-time.** Findings are derived, cheap, and recomputed per
  request. Storing them would create a second source of truth to keep in sync.
- **Actions or nudges** (notifications, emails on a warning). A threshold crossing is an
  observation, not grounds for interrupting somebody.
