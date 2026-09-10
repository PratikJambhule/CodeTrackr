/**
 * Derived productivity metrics — database assembly.
 *
 * The maths lives in metricsDerive.js (pure, unit tested). This module only
 * gathers the aggregates those functions need.
 *
 * Every metric is returned as a flat scalar (unchanged API surface) plus an
 * entry in `meta` carrying { confidence, sampleSize }. A metric whose
 * confidence is 'insufficient' must not be rendered as a number — the frontend
 * shows an explanatory placeholder instead. Showing a value derived from three
 * days of data as if it were backed by six months was the most misleading
 * behaviour of the previous version.
 */

const Activity = require('../models/Activity');
const Goal = require('../models/Goal');
const {
    THRESHOLDS,
    confidenceFor,
    deepWorkRatio,
    flowBlockStats,
    volumeStability,
    activeDaysRatio,
    qualityStreak,
    truePeakWindow,
    estimationCalibration,
    DEEP_BLOCK_MS,
} = require('./metricsDerive');
const { sessionize, archetypeMix } = require('./sessionize');
const { getBaseline, deltaFrom } = require('./insightsBaseline');

/**
 * Sessionization needs raw buckets (a daily summary has no within-day
 * structure), so it is capped independently of the metrics window: 30 days of
 * one user's buckets is a few hundred documents, but 365 would not be.
 */
const MAX_SESSION_DAYS = 30;

/** Only the fields sessionize() reads — keeps the payload small. */
const SESSION_PROJECTION = {
    bucketStart: 1, timestamp: 1, duration: 1, projectName: 1, language: 1,
    'editorAnalytics.linesInserted': 1, 'editorAnalytics.linesDeleted': 1,
    'editorAnalytics.churnLines': 1, 'editorAnalytics.readMs': 1,
    'editorAnalytics.writeMs': 1, 'editorAnalytics.fileSwitches': 1,
    'editorAnalytics.undoCount': 1,
    'focusAnalytics.focusedMs': 1, 'focusAnalytics.blurEvents': 1,
    'focusAnalytics.flowBlocksMs': 1,
    'gitAnalytics.commits': 1, 'gitAnalytics.filesChanged': 1,
    'terminalAnalytics.totalCommands': 1, 'terminalAnalytics.failedCommands': 1,
    'terminalAnalytics.terminalErrorCount': 1, 'terminalAnalytics.buildRuns': 1,
    'terminalAnalytics.failedBuilds': 1, 'terminalAnalytics.testRuns': 1,
    'terminalAnalytics.debuggingSessions': 1,
};

/** 'YYYY-MM-DD' for an instant shifted into the user's local day. */
function localDayKey(date, offsetMs) {
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

/**
 * @param withBaseline  set false when this call IS the baseline computation,
 *                      otherwise getBaseline -> buildMetrics -> getBaseline
 *                      recurses forever.
 * @param withSessions  set false to skip the raw-document read entirely.
 */
async function buildMetrics(
    userId,
    { days = 30, timezoneOffset = 0, withBaseline = true, withSessions = true } = {}
) {
    const userIdStr = String(userId);
    const now = Date.now();
    const since = new Date(now - days * 24 * 3600 * 1000);
    const offsetMs = Number(timezoneOffset) * 60000;
    const match = { userId: userIdStr, timestamp: { $gte: since } };

    const [totalsRow] = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                focusedMs: { $sum: { $ifNull: ['$focusAnalytics.focusedMs', 0] } },
                blurredMs: { $sum: { $ifNull: ['$focusAnalytics.blurredMs', 0] } },
                blurEvents: { $sum: { $ifNull: ['$focusAnalytics.blurEvents', 0] } },
                blocks: { $push: { $ifNull: ['$focusAnalytics.flowBlocksMs', []] } },
                churnLines: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } },
                linesInserted: { $sum: { $ifNull: ['$editorAnalytics.linesInserted', 0] } },
                readMs: { $sum: { $ifNull: ['$editorAnalytics.readMs', 0] } },
                writeMs: { $sum: { $ifNull: ['$editorAnalytics.writeMs', 0] } },
                fileSwitches: { $sum: { $ifNull: ['$editorAnalytics.fileSwitches', 0] } },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', 0] } },
                totalSeconds: { $sum: '$duration' },
            },
        },
    ]);

    const totals = totalsRow || {};
    const flowBlocksMs = (totals.blocks || []).reduce((all, arr) => all.concat(arr || []), []);

    // One pass per local day: minutes, and whether the day contained a deep
    // block (for the quality streak).
    const daily = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: { $subtract: ['$timestamp', offsetMs] },
                    },
                },
                minutes: { $sum: { $divide: ['$duration', 60] } },
                blocks: { $push: { $ifNull: ['$focusAnalytics.flowBlocksMs', []] } },
            },
        },
    ]);

    const dailyMinutes = daily.map((d) => d.minutes);
    const deepDayKeys = daily
        .filter((d) => (d.blocks || [])
            .some((arr) => (arr || []).some((b) => Number(b) >= DEEP_BLOCK_MS)))
        .map((d) => d._id);

    // `days` counts the DISTINCT local days an hour was observed on, which is
    // what stops a single all-nighter from winning truePeakWindow.
    const hourly = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: { $hour: { date: { $subtract: ['$timestamp', offsetMs] }, timezone: 'UTC' } },
                minutes: { $sum: { $divide: ['$duration', 60] } },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', 0] } },
                linesInserted: { $sum: { $ifNull: ['$editorAnalytics.linesInserted', 0] } },
                churnLines: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } },
                dayKeys: {
                    $addToSet: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: { $subtract: ['$timestamp', offsetMs] },
                        },
                    },
                },
            },
        },
        {
            $project: {
                _id: 0, hour: '$_id', minutes: 1, commits: 1, linesInserted: 1, churnLines: 1,
                days: { $size: '$dayKeys' },
            },
        },
    ]);

    const goalPairs = await buildGoalPairs(userId, userIdStr);

    const attentionMs = (totals.readMs || 0) + (totals.writeMs || 0);
    const focusedHours = (totals.focusedMs || 0) / 3600000;
    const blockStats = flowBlockStats(flowBlocksMs);
    const activeDays = daily.length;
    // The window can only be as long as the data we actually have.
    const observedDays = Math.min(days, Math.max(activeDays, 1));

    const todayKey = localDayKey(new Date(now), offsetMs);
    const yesterdayKey = localDayKey(new Date(now - 86400000), offsetMs);

    const peak = truePeakWindow(hourly);
    const calibration = estimationCalibration(goalPairs);

    const round2 = (n) => Math.round(n * 100) / 100;
    const churnRatio = totals.linesInserted
        ? round2(Math.min(1, totals.churnLines / totals.linesInserted))
        : 0;

    const meta = {
        deepWorkRatio: {
            confidence: confidenceFor(blockStats.blockCount, THRESHOLDS.deepWorkRatio),
            sampleSize: blockStats.blockCount,
            unit: 'flow blocks',
        },
        flowBlocks: {
            confidence: confidenceFor(blockStats.blockCount, THRESHOLDS.flowBlocks),
            sampleSize: blockStats.blockCount,
            unit: 'flow blocks',
        },
        volumeStability: {
            confidence: confidenceFor(activeDays, THRESHOLDS.volumeStability),
            sampleSize: activeDays,
            unit: 'active days',
        },
        activeDaysRatio: {
            confidence: confidenceFor(observedDays, THRESHOLDS.activeDaysRatio),
            sampleSize: observedDays,
            unit: 'days observed',
        },
        truePeakWindow: {
            confidence: peak
                ? confidenceFor(peak.days, THRESHOLDS.truePeakWindow)
                : 'insufficient',
            sampleSize: peak ? peak.days : 0,
            unit: 'days in window',
        },
        churnRatio: {
            confidence: confidenceFor(totals.linesInserted || 0, THRESHOLDS.churnRatio),
            sampleSize: totals.linesInserted || 0,
            unit: 'lines inserted',
        },
        comprehensionLoad: {
            confidence: confidenceFor(attentionMs, THRESHOLDS.comprehensionLoad),
            sampleSize: attentionMs,
            unit: 'attention ms',
        },
        contextSwitchesPerHour: {
            confidence: confidenceFor(focusedHours, THRESHOLDS.contextSwitchesPerHour),
            sampleSize: round2(focusedHours),
            unit: 'focused hours',
        },
        interruptionsPerHour: {
            confidence: confidenceFor(focusedHours, THRESHOLDS.contextSwitchesPerHour),
            sampleSize: round2(focusedHours),
            unit: 'focused hours',
        },
        estimationCalibration: {
            confidence: calibration
                ? confidenceFor(calibration.sampleSize, THRESHOLDS.estimationCalibration)
                : 'insufficient',
            sampleSize: calibration ? calibration.sampleSize : 0,
            unit: 'completed goals',
        },
    };

    // Sessions come from raw buckets: a daily summary loses the within-day
    // structure that gap-splitting depends on.
    let sessions = [];
    if (withSessions) {
        const sessionDays = Math.min(days, MAX_SESSION_DAYS);
        const sessionSince = new Date(now - sessionDays * 24 * 3600 * 1000);
        const docs = await Activity
            .find({ userId: userIdStr, timestamp: { $gte: sessionSince } }, SESSION_PROJECTION)
            .sort({ timestamp: 1 })
            .lean();
        sessions = sessionize(docs);
    }

    const result = {
        windowDays: days,
        sessionWindowDays: withSessions ? Math.min(days, MAX_SESSION_DAYS) : 0,
        sessionCount: sessions.length,
        archetypeMix: archetypeMix(sessions),
        // Newest first, and trimmed: the page shows a short recent list.
        recentSessions: sessions.slice(-20).reverse().map((s) => ({
            startMs: s.startMs,
            endMs: s.endMs,
            minutes: Math.round(s.durationSec / 60),
            archetype: s.archetype,
            reason: s.archetypeReason,
            projects: s.projects,
            languages: s.languages,
            deepBlockCount: s.deepBlockCount,
            commits: s.commits,
        })),
        // --- flat scalars: unchanged API surface ---
        deepWorkRatio: deepWorkRatio(flowBlocksMs),
        flowBlocks: blockStats,
        // Back-compat: the old key measured volume evenness, never cadence.
        consistencyIndex: volumeStability(dailyMinutes),
        volumeStability: volumeStability(dailyMinutes),
        activeDaysRatio: activeDaysRatio(activeDays, observedDays),
        activeDays,
        qualityStreak: qualityStreak(deepDayKeys, todayKey, yesterdayKey),
        truePeakWindow: peak,
        estimationCalibration: calibration,
        churnRatio,
        comprehensionLoad: attentionMs
            ? round2((totals.readMs || 0) / attentionMs)
            : 0,
        contextSwitchesPerHour: focusedHours
            ? Math.round(((totals.fileSwitches || 0) / focusedHours) * 10) / 10
            : 0,
        interruptionsPerHour: focusedHours
            ? Math.round(((totals.blurEvents || 0) / focusedHours) * 10) / 10
            : 0,
        commits: totals.commits || 0,
        totalHours: round2((totals.totalSeconds || 0) / 3600),
        focusedHours: round2(focusedHours),
        // --- confidence sidecar ---
        meta,
    };

    // Attach the user's own 90-day baseline and the change from it. Failures
    // here are non-fatal: a missing comparison is fine, a broken page is not.
    if (withBaseline) {
        const cached = await getBaseline(
            userIdStr,
            { timezoneOffset },
            (id, opts) => buildMetrics(id, { ...opts, withBaseline: false, withSessions: false })
        );
        if (cached) {
            result.baselineDays = cached.days;
            result.baselineComputedAt = cached.computedAt;
            for (const [key, value] of Object.entries(cached.baseline || {})) {
                if (!result.meta[key]) continue;
                result.meta[key].baseline = value;
                result.meta[key].delta = deltaFrom(result[key], value);
            }
        }
    }

    return result;
}

/**
 * Pair each completed goal's estimate against the hours actually logged for it.
 *
 * FIXED 2026-09-10. The previous version matched `language === goal.techStack`
 * (free text — a goal tagged "React" never matched activity logged as
 * `typescript`) and applied **no date window**, so a 10-hour goal was measured
 * against every hour ever logged in that language.
 *
 * Now: case-insensitive match against language *or* project name, bounded to
 * the goal's own lifetime. A goal whose stack matches nothing is skipped rather
 * than reported as 0 hours — a fabricated 0 would read as "finished instantly".
 */
async function buildGoalPairs(userId, userIdStr) {
    const goals = await Goal.find({ userId, status: 'completed' }).lean();
    if (goals.length === 0) return [];

    const pairs = [];
    for (const goal of goals) {
        const stack = String(goal.techStack || '').trim();
        if (!stack || !(Number(goal.targetHours) > 0)) continue;

        const from = goal.createdAt ? new Date(goal.createdAt) : null;
        const to = new Date(goal.completedAt || goal.updatedAt || Date.now());
        if (!from || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue;

        const stackRe = new RegExp(`^${stack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const [row] = await Activity.aggregate([
            {
                $match: {
                    userId: userIdStr,
                    timestamp: { $gte: from, $lte: to },
                    $or: [{ language: stackRe }, { projectName: stackRe }],
                },
            },
            { $group: { _id: null, seconds: { $sum: '$duration' } } },
        ]);

        const actualHours = (row?.seconds || 0) / 3600;
        if (actualHours <= 0) continue; // nothing matched — don't fabricate a 0
        pairs.push({ estimatedHours: Number(goal.targetHours), actualHours });
    }
    return pairs;
}

module.exports = { buildMetrics, buildGoalPairs };
