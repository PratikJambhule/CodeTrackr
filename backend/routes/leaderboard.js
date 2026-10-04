const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const User = require('../models/user');
const UserStats = require('../models/UserStats');
const { USER_KEY } = require('../services/activityUser');
const { isAuthenticated } = require('../middleware/auth');
const { statsComplete } = require('../services/userStats');

/**
 * Global leaderboard.
 *
 * Scoring is deliberately RELATIVE: every score is `your value / the field's
 * best value * 5`. That means a score moves when somebody else's does, and in a
 * one-user install everyone is 5.0. That is the product's existing design and
 * the dashboard renders it as-is; this module only guarantees the numbers are
 * real and in range.
 *
 * All-time requests read the `userstats` running totals (H-7 fixed 2026-10-03):
 * three indexed reads instead of aggregating every activity. A `?days=` window,
 * or an install where the backfill has not finished yet (`statsComplete()`), still
 * scans `activities`.
 * The `X-Leaderboard-Source` header says which path answered.
 */

const MAX_WINDOW_DAYS = 400; // matches the Activity TTL; beyond this there is no data
const SCORE_MAX = 5;

/** Clamp into [0, SCORE_MAX] and format like the dashboard expects. */
function score(value, best) {
    if (!Number.isFinite(value) || !Number.isFinite(best) || best <= 0) return '0.0';
    const scaled = (value / best) * SCORE_MAX;
    if (!Number.isFinite(scaled)) return '0.0';
    return Math.min(SCORE_MAX, Math.max(0, scaled)).toFixed(1);
}

/**
 * Largest value of `pick` across `rows`, floored at 1 so it is always a safe
 * divisor. Uses a fold rather than `Math.max(...rows.map(...))` — spreading an
 * array of this size throws RangeError once the user count reaches the engine's
 * argument limit (~100k), which would take the whole endpoint down.
 */
function maxOf(rows, pick) {
    let best = 1;
    for (const row of rows) {
        const value = pick(row);
        if (Number.isFinite(value) && value > best) best = value;
    }
    return best;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const EMPTY = {
    totalHours: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    codeChanges: 0,
    netCodeChanges: 0,
    projectCount: 0,
    commits: 0,
    flushes: 0,
};

/**
 * All-time rows from the `userstats` running totals (roadmap item 6): the top
 * `limit` users by time, plus the global maxima the relative scores divide by.
 * Three indexed reads, independent of how much activity exists.
 */
async function rowsFromStats(limit) {
    const [top, byCommits, byChanges] = await Promise.all([
        UserStats.find({}).sort({ totalSeconds: -1 }).limit(limit)
            .populate('userId', 'name profilePictureUrl').lean(),
        UserStats.findOne({}).sort({ commits: -1 }).select('commits').lean(),
        UserStats.findOne({}).sort({ codeChanges: -1 }).select('codeChanges').lean(),
    ]);
    const rows = top
        .filter((s) => s.userId) // account deleted
        .map((s) => ({
            userId: s.userId._id,
            name: s.userId.name,
            profilePictureUrl: s.userId.profilePictureUrl,
            totalHours: (s.totalSeconds || 0) / 3600,
            totalLinesAdded: s.linesAdded || 0,
            totalLinesRemoved: s.linesRemoved || 0,
            codeChanges: s.codeChanges || 0,
            netCodeChanges: (s.linesAdded || 0) - (s.linesRemoved || 0),
            projectCount: (s.projects || []).length,
            commits: s.commits || 0,
            flushes: s.flushes || 0,
        }));
    return {
        rows,
        maxima: {
            hours: Math.max(1, rows.length ? rows[0].totalHours : 0),
            commits: Math.max(1, (byCommits && byCommits.commits) || 0),
            changes: Math.max(1, (byChanges && byChanges.codeChanges) || 0),
        },
    };
}

/**
 * Rows from a scan of `activities` in a time window (`?days=`), or all-time
 * before the `userstats` backfill has run. This is the old O(all documents)
 * path, kept because windowed totals cannot come from all-time counters.
 */
async function rowsFromScan(windowDays, limit) {
    const match = {
        // Guard against garbage the ingest bounds-check predates: a negative
        // or non-numeric duration otherwise subtracts from a real total.
        duration: { $gte: 0 },
    };
    if (windowDays) {
        match.timestamp = { $gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) };
    }

    // No email: this list goes to every signed-in user (Quick-Wins #16).
    const allUsers = await User.find({}).select('_id name profilePictureUrl').lean();

    const activityData = await Activity.aggregate([
        { $match: match },
        {
            $group: {
                _id: USER_KEY, // legacy String or ObjectId -> one row per user
                totalDuration: { $sum: '$duration' },
                totalLinesAdded: { $sum: '$linesAdded' },
                totalLinesRemoved: { $sum: '$linesRemoved' },
                projects: { $addToSet: '$projectName' },
                // Real commits, from the Git extension API (gitStateTracker).
                // Documents written before that tracker existed carry only the
                // terminal-derived count, so fall back to it per document.
                // These are two views of the same event, never summed.
                totalCommits: {
                    $sum: {
                        $ifNull: [
                            '$gitAnalytics.commits',
                            { $ifNull: ['$terminalAnalytics.gitActivity.commits', 0] },
                        ],
                    },
                },
                // How many flushes merged into this row. Bucketed documents
                // count their merges; legacy per-flush documents count as one.
                flushes: { $sum: { $ifNull: ['$flushCount', 1] } },
            },
        },
        {
            $addFields: {
                totalHours: { $divide: ['$totalDuration', 3600] },
                projectCount: { $size: '$projects' },
                codeChanges: { $add: ['$totalLinesAdded', '$totalLinesRemoved'] },
                netCodeChanges: { $subtract: ['$totalLinesAdded', '$totalLinesRemoved'] },
            },
        },
    ]);

    const activityMap = new Map();
    for (const data of activityData) {
        if (data._id === null || data._id === undefined) continue;
        activityMap.set(String(data._id), {
            totalHours: data.totalHours || 0,
            totalLinesAdded: data.totalLinesAdded || 0,
            totalLinesRemoved: data.totalLinesRemoved || 0,
            codeChanges: data.codeChanges || 0,
            netCodeChanges: data.netCodeChanges || 0,
            projectCount: data.projectCount || 0,
            commits: data.totalCommits || 0,
            flushes: data.flushes || 0,
        });
    }

    const all = allUsers.map(user => ({
        userId: user._id,
        name: user.name,
        profilePictureUrl: user.profilePictureUrl,
        ...(activityMap.get(String(user._id)) || EMPTY),
    }));
    all.sort((a, b) => b.totalHours - a.totalHours);
    return {
        rows: all.slice(0, limit),
        maxima: {
            hours: maxOf(all, u => u.totalHours),
            commits: maxOf(all, u => u.commits),
            changes: maxOf(all, u => u.codeChanges),
        },
    };
}

router.get('/', isAuthenticated, async (req, res, next) => {
    try {
        // Optional window. Default stays all-time so the endpoint's meaning is
        // unchanged for existing callers.
        const requestedDays = Number.parseInt(req.query.days, 10);
        const windowDays = Number.isFinite(requestedDays) && requestedDays > 0
            ? Math.min(requestedDays, MAX_WINDOW_DAYS)
            : null;
        const requestedLimit = Number.parseInt(req.query.limit, 10);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, MAX_LIMIT)
            : DEFAULT_LIMIT;

        const useStats = !windowDays && (await statsComplete());
        const { rows: leaderboardData, maxima } = useStats
            ? await rowsFromStats(limit)
            : await rowsFromScan(windowDays, limit);
        res.set('X-Leaderboard-Source', useStats ? 'userstats' : 'scan');

        leaderboardData.forEach((user, index) => {
            user.rank = index + 1;

            if (user.totalHours === 0 && user.codeChanges === 0 && user.commits === 0) {
                user.speed = '0.0';
                user.quality = '0.0';
                user.engagement = '0.0';
                user.impact = '0.0';
                user.overall = '0.0';
                user.commitScore = '0.0';
                return;
            }

            user.speed = score(user.commits, maxima.commits);
            user.quality = score(user.codeChanges, maxima.changes);
            user.engagement = score(user.totalHours, maxima.hours);
            // netCodeChanges goes negative for a net-deletion window. The old
            // `Math.min(5, x)` left that negative, which then dragged `overall`
            // below zero; a refactor that removes code is not negative impact.
            user.impact = score(Math.max(0, user.netCodeChanges), maxima.changes);

            user.overall = (
                (parseFloat(user.speed) +
                    parseFloat(user.quality) +
                    parseFloat(user.engagement) +
                    parseFloat(user.impact)) / 4
            ).toFixed(1);

            // Absolute, not relative: 20 commits in the window is the target.
            user.commitScore = score(user.commits, 20);
        });

        res.json(leaderboardData);
    } catch (error) {
        return next(error);
    }
});

// The router is the module (app.use mounts it directly). The two pure helpers
// ride along as properties so they can be unit tested without booting express.
module.exports = router;
module.exports.score = score;
module.exports.maxOf = maxOf;
