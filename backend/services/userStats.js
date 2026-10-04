'use strict';

/**
 * Per-user running totals for the leaderboard (roadmap item 6, H-7/H-8).
 *
 * Ingest $incs one `userstats` row per credited write, so the all-time
 * leaderboard reads N rows for N users instead of aggregating every activity
 * document on every request. `scripts/backfill-userstats.js` rebuilds the rows
 * from `activities` (first deploy, or to reconcile).
 *
 * buildStatsUpdate is pure and unit-tested.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param normalized  the normalised flush
 * @param credited    seconds actually credited (after the anti-cheat limits)
 * @param when        upload time, for lastActiveAt
 * @param opts.timeOnly  a signal-less top-up: time only, no counters, no flush
 */
function buildStatsUpdate(normalized, credited, when, opts = {}) {
  const totalSeconds = num(credited);
  if (opts.timeOnly) return { $inc: { totalSeconds } };

  const p = normalized || {};
  const t = p.terminalAnalytics || {};
  const gitCommits = p.gitAnalytics && p.gitAnalytics.commits !== undefined && p.gitAnalytics.commits !== null
    ? num(p.gitAnalytics.commits)
    : num(t.gitActivity && t.gitActivity.commits);
  const linesAdded = num(p.linesAdded);
  const linesRemoved = num(p.linesRemoved);

  const update = {
    $inc: {
      totalSeconds,
      linesAdded,
      linesRemoved,
      codeChanges: linesAdded + linesRemoved,
      commits: gitCommits,
      flushes: 1,
      totalCommands: num(t.totalCommands),
      failedCommands: num(t.failedCommands),
      buildRuns: num(t.buildRuns),
      failedBuilds: num(t.failedBuilds),
    },
    $max: { lastActiveAt: when },
  };
  if (p.projectName) update.$addToSet = { projects: p.projectName };
  return update;
}

module.exports = { buildStatsUpdate };

/**
 * Rebuild every user's running totals from `activities` (first deploy, or to
 * reconcile drift). Overwrites with $set. Run it when ingest is quiet: an
 * upload landing between the aggregate and the write is counted twice or not
 * at all for that user. Returns { users, written }.
 */
async function rebuildAll({ apply = false } = {}) {
    const mongoose = require('mongoose');
    const Activity = require('../models/Activity');
    const UserStats = require('../models/UserStats');
    const ifNull0 = (path) => ({ $ifNull: [path, 0] });

    const rows = await Activity.aggregate([
        { $match: { duration: { $gte: 0 } } },
        {
            $group: {
                _id: { $toString: '$userId' }, // legacy String or ObjectId -> one row
                totalSeconds: { $sum: '$duration' },
                linesAdded: { $sum: ifNull0('$linesAdded') },
                linesRemoved: { $sum: ifNull0('$linesRemoved') },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', ifNull0('$terminalAnalytics.gitActivity.commits')] } },
                flushes: { $sum: { $ifNull: ['$flushCount', 1] } },
                totalCommands: { $sum: ifNull0('$terminalAnalytics.totalCommands') },
                failedCommands: { $sum: ifNull0('$terminalAnalytics.failedCommands') },
                buildRuns: { $sum: ifNull0('$terminalAnalytics.buildRuns') },
                failedBuilds: { $sum: ifNull0('$terminalAnalytics.failedBuilds') },
                projects: { $addToSet: '$projectName' },
                lastActiveAt: { $max: '$timestamp' },
            },
        },
    ]);

    let written = 0;
    for (const r of rows) {
        if (!mongoose.isValidObjectId(r._id)) continue;
        if (!apply) continue;
        const { _id, ...totals } = r;
        totals.codeChanges = totals.linesAdded + totals.linesRemoved;
        totals.projects = (totals.projects || []).filter(Boolean);
        await UserStats.updateOne({ userId: _id }, { $set: totals }, { upsert: true });
        written += 1;
    }
    if (apply) {
        const Migration = require('../models/Migration');
        await Migration.updateOne(
            { _id: BACKFILL_ID },
            { $set: { completedAt: new Date(), details: { users: rows.length, written } } },
            { upsert: true },
        );
    }
    return { users: rows.length, written };
}

const BACKFILL_ID = 'userstats-backfill';

/**
 * True once `rebuildAll({ apply: true })` has finished. Until then the
 * userstats rows hold only what ingest added since the deploy (the people who
 * uploaded since), so all-time boards must keep scanning `activities`. "The
 * collection is not empty" was the old test, and one new upload passed it
 * (D-39). One indexed read by _id.
 */
async function statsComplete() {
    const Migration = require('../models/Migration');
    return Boolean(await Migration.exists({ _id: BACKFILL_ID }));
}

module.exports.rebuildAll = rebuildAll;
module.exports.statsComplete = statsComplete;
module.exports.BACKFILL_ID = BACKFILL_ID;
