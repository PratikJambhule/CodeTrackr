'use strict';

/**
 * Long-range views for the redesigned dashboard (spec 2026-10-04 §6), in ONE
 * $facet pipeline over the last 365 local days:
 *
 *   days       seconds per local day, days with activity only (year heatmap)
 *   hourOfDay  seconds per local hour, last 7 local days ("when you code")
 *   projects   top 8 projects by seconds, last 7 local days
 *   commits7d  commits in the last 7 local days: the git tracker's count first,
 *              terminal `git commit`s as the fallback (same rule as group boards)
 *
 * Local time follows analyticsViews: shift timestamps by the client's
 * Date.getTimezoneOffset() (minutes, negative east of UTC) and read them as UTC.
 * Bucketed activity carries its 10-minute window start, so a bucket counts in
 * the hour and day that window started in.
 */
const Activity = require('../models/Activity');
const { matchActivityUser } = require('./activityUser');

const DAY_MS = 864e5;
const n = (path) => ({ $ifNull: [path, 0] });

/** Offsets outside real time zones (±14 h) are treated as UTC. */
function clampOffset(offsetMinutes) {
  const v = Number(offsetMinutes);
  return Number.isFinite(v) && Math.abs(v) <= 14 * 60 ? v : 0;
}

/** The UTC instant at which the instant's local day began. */
function localMidnightUtc(instant, offsetMinutes) {
  const offsetMs = clampOffset(offsetMinutes) * 60000;
  const local = new Date(new Date(instant).getTime() - offsetMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs);
}

async function historyData({ userId, offsetMinutes = 0, now = new Date(), days = 365 }) {
  const offsetMs = clampOffset(offsetMinutes) * 60000;
  const today = localMidnightUtc(now, offsetMinutes).getTime();
  const yearStart = new Date(today - (days - 1) * DAY_MS);
  const weekStart = new Date(today - 6 * DAY_MS);
  const end = new Date(today + DAY_MS);
  const local = { $subtract: ['$timestamp', offsetMs] };
  const inWeek = { $match: { timestamp: { $gte: weekStart } } };

  const [r] = await Activity.aggregate([
    { $match: { userId: matchActivityUser(userId), timestamp: { $gte: yearStart, $lt: end } } },
    {
      $facet: {
        days: [
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: local, timezone: 'UTC' } }, seconds: { $sum: n('$duration') } } },
          { $match: { seconds: { $gt: 0 } } },
          { $sort: { _id: 1 } },
        ],
        hours: [
          inWeek,
          { $group: { _id: { $hour: { date: local, timezone: 'UTC' } }, seconds: { $sum: n('$duration') } } },
        ],
        projects: [
          inWeek,
          { $group: { _id: { $ifNull: ['$projectName', 'Unknown'] }, seconds: { $sum: n('$duration') } } },
          { $match: { seconds: { $gt: 0 } } },
          { $sort: { seconds: -1, _id: 1 } },
          { $limit: 8 },
        ],
        commits: [
          inWeek,
          {
            $group: {
              _id: null,
              commits: { $sum: { $ifNull: ['$gitAnalytics.commits', n('$terminalAnalytics.gitActivity.commits')] } },
            },
          },
        ],
      },
    },
  ]);

  const hourOfDay = new Array(24).fill(0);
  for (const h of r.hours) hourOfDay[h._id] = h.seconds;
  return {
    days: r.days.map((d) => ({ date: d._id, seconds: d.seconds })),
    hourOfDay,
    projects: r.projects.map((p) => ({ name: p._id, seconds: p.seconds })),
    commits7d: (r.commits[0] && r.commits[0].commits) || 0,
  };
}

module.exports = { historyData, localMidnightUtc, clampOffset };
