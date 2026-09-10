/**
 * 90-day metric baselines, lazily cached.
 *
 * Strategy (deliberate, and the smallest thing that works):
 *   - Current-window metrics are computed from raw `activities` on request.
 *     They must be live; a tracker that shows you yesterday is useless.
 *   - The 90-day baseline is the only genuinely wasteful part to recompute per
 *     load, so it — and only it — is cached in `UserInsights`, refreshed at
 *     most once a day, on read.
 *
 * No cron. A missing or stale document is simply recomputed by the next
 * request, so there is nothing to schedule, nothing to backfill, and no way for
 * the cache to drift permanently out of date.
 *
 * `computeBaseline` is injected rather than imported to avoid a require cycle
 * with metricsService (which is the thing that computes metrics).
 */

const UserInsights = require('../models/UserInsights');

const BASELINE_DAYS = 90;
const MAX_AGE_MS = 24 * 3600 * 1000;

/** Metrics worth comparing against a personal baseline. */
const BASELINE_KEYS = [
    'deepWorkRatio',
    'volumeStability',
    'activeDaysRatio',
    'churnRatio',
    'comprehensionLoad',
    'contextSwitchesPerHour',
    'interruptionsPerHour',
];

const isStale = (doc, now) =>
    !doc || !doc.computedAt || (now - new Date(doc.computedAt).getTime()) >= MAX_AGE_MS;

/**
 * Return the user's 90-day baseline, recomputing it if absent or older than a
 * day. Never throws: a baseline is a nice-to-have, so a failure degrades to
 * "no comparison available" rather than failing the whole Insights request.
 *
 * @param computeBaseline async (userId, {days, timezoneOffset}) => metrics
 */
async function getBaseline(userId, { timezoneOffset = 0, now = Date.now() } = {}, computeBaseline) {
    const userIdStr = String(userId);
    let doc = null;

    try {
        doc = await UserInsights.findOne({ userId: userIdStr }).lean();
    } catch {
        return null; // read failure — carry on without a comparison
    }

    if (!isStale(doc, now)) {
        return { baseline: doc.baseline || {}, computedAt: doc.computedAt, days: doc.baselineDays, activeDays: doc.activeDays };
    }

    if (typeof computeBaseline !== 'function') return null;

    let fresh;
    try {
        fresh = await computeBaseline(userIdStr, { days: BASELINE_DAYS, timezoneOffset });
    } catch {
        // Recompute failed. A stale baseline still beats none, so serve it.
        return doc
            ? { baseline: doc.baseline || {}, computedAt: doc.computedAt, days: doc.baselineDays, activeDays: doc.activeDays, stale: true }
            : null;
    }

    const baseline = {};
    for (const key of BASELINE_KEYS) {
        const value = fresh?.[key];
        const confidence = fresh?.meta?.[key]?.confidence;
        // Only record a metric the baseline window itself has enough data for —
        // comparing against an unreliable baseline is worse than not comparing.
        // An ungated metric (no meta entry) is skipped rather than trusted: a
        // missing gate must never read as "confident".
        if (typeof value === 'number' && confidence && confidence !== 'insufficient') {
            baseline[key] = value;
        }
    }

    const payload = {
        baseline,
        baselineDays: BASELINE_DAYS,
        activeDays: fresh?.activeDays || 0,
        computedAt: new Date(now),
    };

    try {
        await UserInsights.updateOne({ userId: userIdStr }, { $set: payload }, { upsert: true });
    } catch {
        // Cache write failed; the computed values are still usable this request.
    }

    return {
        baseline: payload.baseline,
        computedAt: payload.computedAt,
        days: BASELINE_DAYS,
        activeDays: payload.activeDays,
    };
}

/**
 * Signed change from baseline, as a fraction of the baseline.
 * Returns null when there is nothing meaningful to compare against — a baseline
 * of 0 makes any percentage change infinite.
 */
function deltaFrom(current, baselineValue) {
    if (typeof current !== 'number' || typeof baselineValue !== 'number') return null;
    if (!Number.isFinite(current) || !Number.isFinite(baselineValue)) return null;
    if (baselineValue === 0) return null;
    return Math.round(((current - baselineValue) / Math.abs(baselineValue)) * 100) / 100;
}

module.exports = {
    BASELINE_DAYS,
    BASELINE_KEYS,
    MAX_AGE_MS,
    isStale,
    getBaseline,
    deltaFrom,
};
