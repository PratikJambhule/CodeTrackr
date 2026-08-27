/**
 * Derived productivity metrics — pure functions.
 *
 * Deliberately dependency-free (no mongoose, no models) so the maths can be
 * unit tested without a database. metricsService.js does the querying and
 * calls into these.
 *
 * Definitions come from docs/TRACKING_ROADMAP.md Part 3.
 */

const DEEP_BLOCK_MS = 25 * 60 * 1000;

/** Share of focused time spent in blocks of >= 25 minutes. 0..1 */
function deepWorkRatio(flowBlocksMs, totalFocusedMs) {
    if (!Array.isArray(flowBlocksMs) || !totalFocusedMs || totalFocusedMs <= 0) return 0;
    const deepMs = flowBlocksMs
        .map(Number)
        .filter((b) => Number.isFinite(b) && b >= DEEP_BLOCK_MS)
        .reduce((sum, b) => sum + b, 0);
    return Math.round((deepMs / totalFocusedMs) * 100) / 100;
}

/** Median / longest / deep-block count. Report the distribution, not the sum. */
function flowBlockStats(flowBlocksMs) {
    const blocks = (Array.isArray(flowBlocksMs) ? flowBlocksMs : [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);

    if (blocks.length === 0) {
        return { medianMs: 0, longestMs: 0, deepBlockCount: 0, blockCount: 0 };
    }

    const mid = Math.floor(blocks.length / 2);
    const medianMs =
        blocks.length % 2 === 0 ? (blocks[mid - 1] + blocks[mid]) / 2 : blocks[mid];

    return {
        medianMs,
        longestMs: blocks[blocks.length - 1],
        deepBlockCount: blocks.filter((b) => b >= DEEP_BLOCK_MS).length,
        blockCount: blocks.length
    };
}

/**
 * 1 - coefficient of variation, clamped to [0, 1].
 * Low day-to-day variance beats high totals for sustainability.
 */
function consistencyIndex(dailyMinutes) {
    const values = (Array.isArray(dailyMinutes) ? dailyMinutes : [])
        .map(Number)
        .filter(Number.isFinite);
    if (values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean <= 0) return 0;

    const variance =
        values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.round(Math.max(0, Math.min(1, 1 - cv)) * 100) / 100;
}

/**
 * The most *productive* hour, not the busiest one.
 * score = commits*10 + linesInserted/10 - churnLines/5
 */
function truePeakWindow(hourly) {
    const rows = (Array.isArray(hourly) ? hourly : []).filter(
        (h) => Number(h && h.minutes) > 0
    );
    if (rows.length === 0) return null;

    let best = null;
    for (const row of rows) {
        const score =
            Number(row.commits || 0) * 10 +
            Number(row.linesInserted || 0) / 10 -
            Number(row.churnLines || 0) / 5;
        if (!best || score > best.score) {
            best = { hour: Number(row.hour), score: Math.round(score * 100) / 100 };
        }
    }
    return best;
}

/**
 * Mean ratio of actual to estimated hours across completed goals.
 * factor > 1 means the user consistently underestimates.
 */
function estimationCalibration(pairs) {
    const usable = (Array.isArray(pairs) ? pairs : []).filter(
        (p) => Number(p && p.estimatedHours) > 0 && Number.isFinite(Number(p && p.actualHours))
    );
    if (usable.length < 2) return null;

    const ratios = usable.map((p) => Number(p.actualHours) / Number(p.estimatedHours));
    const factor = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    return { factor: Math.round(factor * 100) / 100, sampleSize: usable.length };
}

module.exports = {
    DEEP_BLOCK_MS,
    deepWorkRatio,
    flowBlockStats,
    consistencyIndex,
    truePeakWindow,
    estimationCalibration
};
