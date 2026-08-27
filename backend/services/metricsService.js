/**
 * Derived productivity metrics — database assembly.
 *
 * The maths lives in metricsDerive.js (pure, unit tested). This module only
 * gathers the aggregates those functions need.
 *
 * Metrics that depend on fields introduced in extension 2.1.0 return 0/null
 * for older activity; they fill in as new data arrives.
 */

const Activity = require('../models/Activity');
const Goal = require('../models/Goal');
const {
    deepWorkRatio,
    flowBlockStats,
    consistencyIndex,
    truePeakWindow,
    estimationCalibration
} = require('./metricsDerive');

async function buildMetrics(userId, { days = 30, timezoneOffset = 0 } = {}) {
    const userIdStr = String(userId);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const offsetMs = Number(timezoneOffset) * 60000;
    const match = { userId: userIdStr, timestamp: { $gte: since } };

    const [totalsRow] = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                focusedMs: { $sum: { $ifNull: ['$focusAnalytics.focusedMs', 0] } },
                blocks: { $push: { $ifNull: ['$focusAnalytics.flowBlocksMs', []] } },
                churnLines: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } },
                linesInserted: { $sum: { $ifNull: ['$editorAnalytics.linesInserted', 0] } },
                readMs: { $sum: { $ifNull: ['$editorAnalytics.readMs', 0] } },
                writeMs: { $sum: { $ifNull: ['$editorAnalytics.writeMs', 0] } },
                fileSwitches: { $sum: { $ifNull: ['$editorAnalytics.fileSwitches', 0] } },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', 0] } },
                totalSeconds: { $sum: '$duration' }
            }
        }
    ]);

    const totals = totalsRow || {};
    const flowBlocksMs = (totals.blocks || []).reduce((all, arr) => all.concat(arr || []), []);

    const daily = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: { $subtract: ['$timestamp', offsetMs] }
                    }
                },
                minutes: { $sum: { $divide: ['$duration', 60] } }
            }
        }
    ]);

    const hourly = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: { $hour: { date: { $subtract: ['$timestamp', offsetMs] }, timezone: 'UTC' } },
                minutes: { $sum: { $divide: ['$duration', 60] } },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', 0] } },
                linesInserted: { $sum: { $ifNull: ['$editorAnalytics.linesInserted', 0] } },
                churnLines: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } }
            }
        },
        { $project: { _id: 0, hour: '$_id', minutes: 1, commits: 1, linesInserted: 1, churnLines: 1 } }
    ]);

    const goalPairs = await buildGoalPairs(userId, userIdStr);

    const attentionMs = (totals.readMs || 0) + (totals.writeMs || 0);
    const focusedHours = (totals.focusedMs || 0) / 3600000;

    return {
        windowDays: days,
        deepWorkRatio: deepWorkRatio(flowBlocksMs, totals.focusedMs || 0),
        flowBlocks: flowBlockStats(flowBlocksMs),
        consistencyIndex: consistencyIndex(daily.map((d) => d.minutes)),
        truePeakWindow: truePeakWindow(hourly),
        estimationCalibration: estimationCalibration(goalPairs),
        churnRatio: totals.linesInserted
            ? Math.round((totals.churnLines / totals.linesInserted) * 100) / 100
            : 0,
        comprehensionLoad: attentionMs
            ? Math.round(((totals.readMs || 0) / attentionMs) * 100) / 100
            : 0,
        contextSwitchesPerHour: focusedHours
            ? Math.round(((totals.fileSwitches || 0) / focusedHours) * 10) / 10
            : 0,
        commits: totals.commits || 0,
        totalHours: Math.round(((totals.totalSeconds || 0) / 3600) * 100) / 100
    };
}

/**
 * Pairs each completed goal's estimate against hours actually logged for its
 * tech stack. Matching by language is coarse — noted as a Phase A limitation.
 */
async function buildGoalPairs(userId, userIdStr) {
    const goals = await Goal.find({ userId, status: 'completed' }).lean();
    if (goals.length === 0) return [];

    const stacks = [...new Set(goals.map((g) => g.techStack).filter(Boolean))];
    if (stacks.length === 0) return [];

    const totals = await Activity.aggregate([
        { $match: { userId: userIdStr, language: { $in: stacks } } },
        { $group: { _id: '$language', seconds: { $sum: '$duration' } } }
    ]);

    const byStack = new Map(totals.map((t) => [t._id, t.seconds]));

    return goals
        .filter((g) => g.techStack)
        .map((g) => ({
            estimatedHours: g.targetHours,
            actualHours: (byStack.get(g.techStack) || 0) / 3600
        }));
}

module.exports = { buildMetrics };
