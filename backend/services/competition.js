'use strict';

/**
 * The group's weekly board (D-70). Pure: daily ledger rows in, a simple ranking out.
 *
 * It shows only counts that LeetCode, Codeforces and GitHub report, with no invented scores.
 * Ranked by problems solved. Everyone shares one calendar: India days, weeks from Monday.
 */

const IST_MS = 330 * 60 * 1000;
const DAY_MS = 864e5;
const KEEP_WEEKS = 3; // this week, last week, and a margin

const dayNum = (ms) => Math.floor((ms + IST_MS) / DAY_MS);
const numToKey = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const dayKey = (ms) => numToKey(dayNum(ms));
// Day 4 of the Unix epoch (5 Jan 1970) was a Monday.
const mondayOf = (n) => n - ((n - 4) % 7);

const bucket = (map, key, empty) => { if (!map[key]) map[key] = { ...empty }; return map[key]; };

/** Ledger days from Codeforces: `solved` holds each problem's first accepted time. */
function codeforcesDays(solved, history, now) {
  const since = now - KEEP_WEEKS * 7 * DAY_MS;
  const days = {};
  const empty = { problems: 0, contests: 0 };
  for (const s of solved) {
    if (s.t * 1000 >= since) bucket(days, dayKey(s.t * 1000), empty).problems += 1;
  }
  for (const r of history) {
    if (r.ratingUpdateTimeSeconds && r.ratingUpdateTimeSeconds * 1000 >= since) bucket(days, dayKey(r.ratingUpdateTimeSeconds * 1000), empty).contests += 1;
  }
  return days;
}

/** Ledger days from LeetCode's stored accepted problems. */
function leetcodeDays(solves) {
  const days = {};
  for (const s of solves) bucket(days, dayKey(new Date(s.solvedAt).getTime()), { problems: 0 }).problems += 1;
  return days;
}

/** Ledger days from GitHub's public events: pushes per day. */
function githubDays(events) {
  const days = {};
  for (const e of events) {
    if (e.type === 'PushEvent') bucket(days, dayKey(new Date(e.created_at).getTime()), { pushes: 0 }).pushes += 1;
  }
  return days;
}

function buildBoard({ members, rows, now }) {
  const today = dayNum(now);
  const monday = mondayOf(today);
  const totalsFor = (from) => {
    const end = numToKey(from + 6);
    const start = numToKey(from);
    const totals = new Map(members.map((m) => [m.id, { problems: 0, contests: 0, pushes: 0 }]));
    for (const r of rows) {
      const t = totals.get(String(r.userId));
      if (!t || r.day < start || r.day > end) continue;
      t.problems += r.problems || 0;
      t.contests += r.contests || 0;
      t.pushes += r.pushes || 0;
    }
    return totals;
  };

  const week = totalsFor(monday);
  const scores = members.map((m) => week.get(m.id).problems).sort((a, b) => b - a);
  const board = members
    .map((m) => ({ id: m.id, name: m.name, ...week.get(m.id), pos: scores.indexOf(week.get(m.id).problems) + 1 }))
    .sort((a, b) => a.pos - b.pos || b.contests - a.contests || b.pushes - a.pushes || a.name.localeCompare(b.name));

  const last = totalsFor(monday - 7);
  const best = Math.max(0, ...members.map((m) => last.get(m.id).problems));
  const lastWeek = best > 0 ? { problems: best, names: members.filter((m) => last.get(m.id).problems === best).map((m) => m.name) } : null;

  return {
    week: { startsOn: numToKey(monday), endsOn: numToKey(monday + 6), daysLeft: 6 - (today - monday) },
    rows: board,
    lastWeek,
  };
}

module.exports = { buildBoard, dayKey, codeforcesDays, leetcodeDays, githubDays, KEEP_WEEKS };
