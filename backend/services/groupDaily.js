'use strict';

/**
 * Per-member seconds per local day for a group board (spec 2026-10-04 §6): the
 * day cells of the standings tower and the race chart.
 *
 *   window given   one cell per local day in [from, to), up to MAX_DAYS
 *   no window      the last 7 local days, ending today
 *
 * Days are the VIEWER's local days (?timezone=, Date.getTimezoneOffset()):
 * members can be in different zones, and the board is read by one person.
 */
const Activity = require('../models/Activity');
const { matchActivityUsers, USER_KEY } = require('./activityUser');
const { localMidnightUtc, clampOffset } = require('./historyView');

const DAY_MS = 864e5;
const MAX_DAYS = 62; // a contest is a week or two; longer windows get no cells

/** Local date keys (YYYY-MM-DD) for every local day touched by [from, to). */
function localDates(from, to, offsetMinutes) {
  const offsetMs = clampOffset(offsetMinutes) * 60000;
  const keyOf = (t) => new Date(t - offsetMs).toISOString().slice(0, 10);
  const dates = [];
  for (let t = localMidnightUtc(from, offsetMinutes).getTime(); t < to.getTime(); t += DAY_MS) {
    dates.push(keyOf(t));
    if (dates.length > MAX_DAYS) return null;
  }
  return dates;
}

async function groupDaily({ memberIds, from, to, offsetMinutes = 0, now = new Date() }) {
  let start = from;
  let end = to;
  if (!start) {
    start = new Date(localMidnightUtc(now, offsetMinutes).getTime() - 6 * DAY_MS);
    end = new Date(start.getTime() + 7 * DAY_MS);
  }
  const dates = localDates(start, end, offsetMinutes);
  if (!dates) return null;

  const offsetMs = clampOffset(offsetMinutes) * 60000;
  const rows = await Activity.aggregate([
    { $match: { userId: matchActivityUsers(memberIds), timestamp: { $gte: start, $lt: end }, duration: { $gte: 0 } } },
    {
      $group: {
        _id: {
          u: USER_KEY,
          d: { $dateToString: { format: '%Y-%m-%d', date: { $subtract: ['$timestamp', offsetMs] }, timezone: 'UTC' } },
        },
        seconds: { $sum: '$duration' },
      },
    },
  ]);

  const index = new Map(dates.map((d, i) => [d, i]));
  const byUser = {};
  for (const id of memberIds) byUser[id] = new Array(dates.length).fill(0);
  for (const row of rows) {
    const i = index.get(row._id.d);
    if (i !== undefined && byUser[row._id.u]) byUser[row._id.u][i] += row.seconds;
  }
  return { dates, byUser };
}

module.exports = { groupDaily, localDates, MAX_DAYS };
