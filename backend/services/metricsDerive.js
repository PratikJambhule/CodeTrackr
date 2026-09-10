/**
 * Derived productivity metrics — pure functions.
 *
 * Deliberately dependency-free (no mongoose, no models) so the maths can be
 * unit tested without a database. metricsService.js does the querying and
 * calls into these.
 *
 * Definitions originate in docs/TRACKING_ROADMAP.md Part 3. Where a formula
 * diverges from that document, the reason is recorded here and in
 * docs/INSIGHTS_METRICS.md (which is the reference doc for these).
 *
 * Audit note (2026-09-10): several formulas were measuring something other
 * than their name. Each fix is commented at its function.
 */

const DEEP_BLOCK_MS = 25 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Confidence
 * ------------------------------------------------------------------ */

/**
 * Grade a metric by how much evidence backs it.
 *
 * A number rendered from three days of data looked identical to one backed by
 * six months, which is the single most misleading thing the Insights page did.
 * `min` is the floor below which we refuse to show a value at all.
 *
 * @returns {'insufficient'|'low'|'high'}
 */
function confidenceFor(sample, { min, good }) {
    const n = Number(sample);
    if (!Number.isFinite(n) || n < min) return 'insufficient';
    return n >= good ? 'high' : 'low';
}

/** Sample thresholds per metric, in the metric's own natural unit. */
const THRESHOLDS = {
    deepWorkRatio: { min: 3, good: 12 },          // flow blocks
    flowBlocks: { min: 3, good: 12 },             // flow blocks
    volumeStability: { min: 3, good: 10 },        // active days
    activeDaysRatio: { min: 3, good: 14 },        // window days observed
    truePeakWindow: { min: 3, good: 10 },         // distinct days in the window
    churnRatio: { min: 50, good: 500 },           // lines inserted
    comprehensionLoad: { min: 600000, good: 7200000 }, // attention ms (10 min / 2 h)
    contextSwitchesPerHour: { min: 0.5, good: 5 },// focused hours
    estimationCalibration: { min: 1, good: 3 },   // completed goals
};

/* ------------------------------------------------------------------ *
 * Focus / flow
 * ------------------------------------------------------------------ */

const positiveBlocks = (flowBlocksMs) =>
    (Array.isArray(flowBlocksMs) ? flowBlocksMs : [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);

/**
 * Share of *working* time spent in uninterrupted stretches of >= 25 minutes.
 *
 * FIXED 2026-09-10. Was `deepMs / totalFocusedMs`, which divided two different
 * clocks: flow blocks are activity-bounded (they close after 2 min idle),
 * while `focusedMs` is wall-clock time with the VS Code window in the
 * foreground. A block stays open across a brief alt-tab but `focusedMs` does
 * not accrue during it, so the ratio could exceed 1; and before the extension
 * 2.4.0 fix `focusedMs` also banked entire idle gaps, driving it toward 0.
 *
 * Dividing by total block time keeps both sides on the same clock, bounds the
 * result to [0,1] by construction, and answers the question the label implies:
 * "of the time I was actually working, how much was deep?"
 *
 * The second argument is accepted and ignored for backward compatibility.
 */
function deepWorkRatio(flowBlocksMs, _legacyFocusedMs) { // eslint-disable-line no-unused-vars
    const blocks = positiveBlocks(flowBlocksMs);
    const totalMs = blocks.reduce((sum, b) => sum + b, 0);
    if (totalMs <= 0) return 0;
    const deepMs = blocks.filter((b) => b >= DEEP_BLOCK_MS).reduce((sum, b) => sum + b, 0);
    return Math.round((deepMs / totalMs) * 100) / 100;
}

/** Median / longest / deep-block count. Report the distribution, not the sum. */
function flowBlockStats(flowBlocksMs) {
    const blocks = positiveBlocks(flowBlocksMs).sort((a, b) => a - b);

    if (blocks.length === 0) {
        return { medianMs: 0, longestMs: 0, deepBlockCount: 0, blockCount: 0, totalMs: 0 };
    }

    const mid = Math.floor(blocks.length / 2);
    const medianMs =
        blocks.length % 2 === 0 ? (blocks[mid - 1] + blocks[mid]) / 2 : blocks[mid];

    return {
        medianMs,
        longestMs: blocks[blocks.length - 1],
        deepBlockCount: blocks.filter((b) => b >= DEEP_BLOCK_MS).length,
        blockCount: blocks.length,
        totalMs: blocks.reduce((sum, b) => sum + b, 0),
    };
}

/* ------------------------------------------------------------------ *
 * Rhythm
 * ------------------------------------------------------------------ */

const median = (sorted) => {
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * How even the daily volume is *on the days you worked*, 0..1.
 *
 * FIXED 2026-09-10. This was `consistencyIndex` = `1 - stddev/mean` (coefficient
 * of variation). Two problems:
 *   1. The daily aggregate emits no rows for days with zero activity, so it was
 *      never measuring cadence — only the evenness of active days — despite the
 *      name and the UI label "Consistency".
 *   2. CV is dominated by a single outlier day.
 *
 * Now `1 - MAD/median` (median absolute deviation), which is robust, and the
 * cadence question it was mistaken for is answered by `activeDaysRatio`.
 */
function volumeStability(dailyMinutes) {
    const values = (Array.isArray(dailyMinutes) ? dailyMinutes : [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
    if (values.length === 0) return 0;

    const med = median(values);
    if (med <= 0) return 0;

    const deviations = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = median(deviations);
    return Math.round(Math.max(0, Math.min(1, 1 - mad / med)) * 100) / 100;
}

/**
 * Cadence: share of days in the window that had any activity, 0..1.
 * This is what "consistency" colloquially means, and what the old
 * `consistencyIndex` label led users to believe they were seeing.
 */
function activeDaysRatio(activeDays, windowDays) {
    const a = Number(activeDays);
    const w = Number(windowDays);
    if (!Number.isFinite(a) || !Number.isFinite(w) || w <= 0) return 0;
    return Math.round(Math.min(1, Math.max(0, a / w)) * 100) / 100;
}

/**
 * Consecutive days (ending today or yesterday) containing at least one deep
 * block. Roadmap #15 — a 30-day streak of 3-minute sessions is noise; this is
 * not. `deepDayKeys` is a Set/array of 'YYYY-MM-DD' local day keys.
 */
function qualityStreak(deepDayKeys, todayKey, yesterdayKey) {
    const days = new Set(deepDayKeys || []);
    if (days.size === 0) return 0;

    let cursor;
    if (days.has(todayKey)) cursor = todayKey;
    else if (days.has(yesterdayKey)) cursor = yesterdayKey;
    else return 0;

    let streak = 0;
    const date = new Date(`${cursor}T00:00:00.000Z`);
    while (days.has(date.toISOString().slice(0, 10))) {
        streak += 1;
        date.setUTCDate(date.getUTCDate() - 1);
    }
    return streak;
}

/**
 * The most productive *2-hour* window of the day (roadmap #16 specifies two
 * hours; the previous implementation used one).
 *
 * FIXED 2026-09-10. The old score was `commits*10 + linesInserted/10 -
 * churnLines/5` with no sample floor, so a single commit in an hour you had
 * coded in exactly once over 30 days scored 10 and won outright. The weights
 * were also unvalidated magic numbers.
 *
 * The score is now **surviving minutes**: `minutes * (1 - churnRatio)` — time
 * spent that did not get thrown away again. No magic weights, and it is
 * expressed in a real unit. Commits are deliberately excluded: they are bursty
 * and a one-line typo fix counts the same as a day's work.
 *
 * An hour is only eligible once it has been observed on `min` distinct days,
 * which is what stops noise from winning.
 *
 * @param hourly [{ hour, minutes, linesInserted, churnLines, days }]
 * @returns { startHour, endHour, score, minutes, days } | null
 */
function truePeakWindow(hourly, { minDays = THRESHOLDS.truePeakWindow.min } = {}) {
    const rows = Array.isArray(hourly) ? hourly : [];
    const byHour = new Map();
    for (const row of rows) {
        const hour = Number(row && row.hour);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const minutes = Math.max(0, Number(row.minutes) || 0);
        const inserted = Math.max(0, Number(row.linesInserted) || 0);
        const churn = Math.max(0, Number(row.churnLines) || 0);
        // churnLines is matched against inserts, so the ratio is bounded [0,1].
        const churnRatio = inserted > 0 ? Math.min(1, churn / inserted) : 0;
        byHour.set(hour, {
            hour,
            minutes,
            days: Math.max(0, Number(row.days) || 0),
            surviving: minutes * (1 - churnRatio),
        });
    }
    if (byHour.size === 0) return null;

    let best = null;
    for (let start = 0; start < 24; start++) {
        const a = byHour.get(start);
        const b = byHour.get((start + 1) % 24);
        if (!a && !b) continue;

        const minutes = (a?.minutes || 0) + (b?.minutes || 0);
        const score = (a?.surviving || 0) + (b?.surviving || 0);
        // Both halves need not qualify, but the window as a whole must have
        // been observed on enough distinct days to be more than noise.
        const days = Math.max(a?.days || 0, b?.days || 0);
        if (days < minDays || score <= 0) continue;

        if (!best || score > best.score) {
            best = {
                startHour: start,
                endHour: (start + 2) % 24,
                score: Math.round(score * 100) / 100,
                minutes: Math.round(minutes * 100) / 100,
                days,
            };
        }
    }
    return best;
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

/**
 * How far actual hours run over (or under) the estimate.
 *
 * FIXED 2026-09-10. Two defects:
 *   1. It required >= 2 completed goals, and *no route ever set a goal to
 *      completed* — so in production this could never return anything.
 *      `routes/goals.js` now has PATCH /:goalId/complete.
 *   2. `buildGoalPairs` joined activity on `language === goal.techStack` (free
 *      text) with no date window, so a "10h React goal" was compared against
 *      every hour of JavaScript ever logged.
 *
 * Reports the median ratio (robust to one runaway goal) plus the range, and
 * works from a single completed goal — flagged as low confidence rather than
 * withheld, because withholding it is why nobody ever saw this metric.
 */
function estimationCalibration(pairs) {
    const ratios = (Array.isArray(pairs) ? pairs : [])
        .filter((p) => Number(p && p.estimatedHours) > 0 && Number(p && p.actualHours) > 0)
        .map((p) => Number(p.actualHours) / Number(p.estimatedHours))
        .filter((r) => Number.isFinite(r) && r > 0)
        .sort((a, b) => a - b);

    if (ratios.length === 0) return null;

    const round = (n) => Math.round(n * 100) / 100;
    return {
        factor: round(median(ratios)),
        minFactor: round(ratios[0]),
        maxFactor: round(ratios[ratios.length - 1]),
        sampleSize: ratios.length,
    };
}

module.exports = {
    DEEP_BLOCK_MS,
    THRESHOLDS,
    confidenceFor,
    deepWorkRatio,
    flowBlockStats,
    volumeStability,
    activeDaysRatio,
    qualityStreak,
    truePeakWindow,
    estimationCalibration,
    // Back-compat alias: the old name measured volume evenness, not cadence.
    consistencyIndex: volumeStability,
};
