const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const User = require('../models/user');
const { isAuthenticated } = require('../middleware/auth');

/**
 * Global leaderboard.
 *
 * Scoring is deliberately RELATIVE: every score is `your value / the field's
 * best value * 5`. That means a score moves when somebody else's does, and in a
 * one-user install everyone is 5.0. That is the product's existing design and
 * the dashboard renders it as-is; this module only guarantees the numbers are
 * real and in range.
 *
 * Known limitation (IMPROVEMENT_PLAN H-7/H-8): this aggregates the whole
 * `activities` collection and loads every user, with no cache. It is bounded in
 * practice only by the collection's 400-day TTL. The fix is the deferred
 * `UserStats` running-total rollup, not a bigger pipeline here.
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

router.get('/', isAuthenticated, async (req, res, next) => {
    try {
        // Optional window. Default stays all-time so the endpoint's meaning is
        // unchanged for existing callers.
        const requestedDays = Number.parseInt(req.query.days, 10);
        const windowDays = Number.isFinite(requestedDays) && requestedDays > 0
            ? Math.min(requestedDays, MAX_WINDOW_DAYS)
            : null;

        const match = {
            // Guard against garbage the ingest bounds-check predates: a negative
            // or non-numeric duration otherwise subtracts from a real total.
            duration: { $gte: 0 },
        };
        if (windowDays) {
            match.timestamp = { $gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) };
        }

        const allUsers = await User.find({}).select('_id name email profilePictureUrl').lean();

        const activityData = await Activity.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$userId',
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

        const leaderboardData = allUsers.map(user => ({
            userId: user._id,
            name: user.name,
            email: user.email,
            profilePictureUrl: user.profilePictureUrl,
            ...(activityMap.get(String(user._id)) || EMPTY),
        }));

        leaderboardData.sort((a, b) => b.totalHours - a.totalHours);

        const maxHours = maxOf(leaderboardData, u => u.totalHours);
        const maxChanges = maxOf(leaderboardData, u => u.codeChanges);
        const maxCommits = maxOf(leaderboardData, u => u.commits);

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

            user.speed = score(user.commits, maxCommits);
            user.quality = score(user.codeChanges, maxChanges);
            user.engagement = score(user.totalHours, maxHours);
            // netCodeChanges goes negative for a net-deletion window. The old
            // `Math.min(5, x)` left that negative, which then dragged `overall`
            // below zero; a refactor that removes code is not negative impact.
            user.impact = score(Math.max(0, user.netCodeChanges), maxChanges);

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
