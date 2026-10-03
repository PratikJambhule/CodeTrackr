'use strict';

/**
 * Dashboard aggregation in MongoDB instead of Node (roadmap item 9, M-1).
 *
 * The daily and weekly routes used to load every activity document in the
 * window (the daily view loaded 7 days to show 1) and add them up with
 * Array.reduce. This runs ONE pipeline with $facet: per-hour or per-day rows,
 * per-language totals, the terminal summary and the top repeated failures come
 * back already summed, so the response size no longer depends on how many
 * documents the window holds. The routes only lay the rows out on the 24-hour
 * or 7-day grid.
 *
 * Local time: timestamps are shifted by the client's offset and then read as
 * UTC (offset = Date.getTimezoneOffset(), minutes, negative east of UTC) —
 * the same convention as metricsService and localDayInfo.
 */
const Activity = require('../models/Activity');
const { matchActivityUser } = require('./activityUser');

const n = (path) => ({ $ifNull: [path, 0] });
const COMMAND_USAGE = ['git', 'npm', 'node', 'python', 'docker', 'gcc', 'java', 'pip', 'misc'];
const GIT_ACTIVITY = ['commits', 'pushes', 'pulls', 'checkouts', 'merges', 'clones'];
const TERMINAL_SUMS = [
  'totalCommands', 'terminalErrorCount', 'successfulCommands', 'failedCommands',
  'buildRuns', 'testRuns', 'successfulBuilds', 'failedBuilds', 'debuggingSessions',
];

/**
 * @param {object} q
 * @param {string} q.userId
 * @param {Date}   q.from   inclusive
 * @param {Date}   q.to     exclusive
 * @param {number} q.offsetMinutes  Date.getTimezoneOffset() of the client
 * @param {'hour'|'day'} q.unit     how to key the timeline rows
 */
async function viewData({ userId, from, to, offsetMinutes = 0, unit }) {
  const local = { $subtract: ['$timestamp', (Number(offsetMinutes) || 0) * 60000] };
  const key = unit === 'hour'
    ? { $hour: { date: local, timezone: 'UTC' } }
    : { $dateToString: { format: '%Y-%m-%d', date: local, timezone: 'UTC' } };

  const terminalGroup = { _id: null };
  for (const f of TERMINAL_SUMS) terminalGroup[f] = { $sum: n(`$terminalAnalytics.${f}`) };
  for (const f of COMMAND_USAGE) terminalGroup[`cu_${f}`] = { $sum: n(`$terminalAnalytics.commandUsage.${f}`) };
  for (const f of GIT_ACTIVITY) terminalGroup[`ga_${f}`] = { $sum: n(`$terminalAnalytics.gitActivity.${f}`) };

  const [r] = await Activity.aggregate([
    { $match: { userId: matchActivityUser(userId), timestamp: { $gte: from, $lt: to } } },
    {
      $facet: {
        totals: [{
          $group: {
            _id: null,
            docs: { $sum: 1 },
            seconds: { $sum: n('$duration') },
            linesAdded: { $sum: n('$linesAdded') },
            projects: { $addToSet: '$projectName' },
          },
        }],
        timeline: [{
          $group: {
            _id: key,
            seconds: { $sum: n('$duration') },
            success: { $sum: n('$terminalAnalytics.successfulCommands') },
            failed: { $sum: n('$terminalAnalytics.failedCommands') },
            buildSuccess: { $sum: n('$terminalAnalytics.successfulBuilds') },
            buildFailed: { $sum: n('$terminalAnalytics.failedBuilds') },
            commits: { $sum: n('$terminalAnalytics.gitActivity.commits') },
            pushes: { $sum: n('$terminalAnalytics.gitActivity.pushes') },
            pulls: { $sum: n('$terminalAnalytics.gitActivity.pulls') },
          },
        }],
        languages: [{ $group: { _id: { $ifNull: ['$language', 'Unknown'] }, seconds: { $sum: n('$duration') } } }],
        terminal: [{ $group: terminalGroup }],
        repeated: [
          { $unwind: '$terminalAnalytics.repeatedFailedCommands' },
          { $match: { 'terminalAnalytics.repeatedFailedCommands.command': { $nin: [null, ''] } } },
          {
            $group: {
              _id: '$terminalAnalytics.repeatedFailedCommands.command',
              count: { $sum: n('$terminalAnalytics.repeatedFailedCommands.count') },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 5 },
        ],
      },
    },
  ]);

  const totals = r.totals[0] || { docs: 0, seconds: 0, linesAdded: 0, projects: [] };
  const t = r.terminal[0] || {};
  const terminalSummary = {};
  for (const f of TERMINAL_SUMS.slice(0, 4)) terminalSummary[f] = t[f] || 0;
  terminalSummary.successRate = 0;
  for (const f of TERMINAL_SUMS.slice(4, 8)) terminalSummary[f] = t[f] || 0;
  terminalSummary.buildSuccessRate = 0;
  terminalSummary.debuggingSessions = t.debuggingSessions || 0;
  terminalSummary.commandUsage = Object.fromEntries(COMMAND_USAGE.map((f) => [f, t[`cu_${f}`] || 0]));
  terminalSummary.gitActivity = Object.fromEntries(GIT_ACTIVITY.map((f) => [f, t[`ga_${f}`] || 0]));
  terminalSummary.successRate = terminalSummary.totalCommands > 0
    ? Math.round((terminalSummary.successfulCommands / terminalSummary.totalCommands) * 100) : 0;
  terminalSummary.buildSuccessRate = terminalSummary.buildRuns > 0
    ? Math.round((terminalSummary.successfulBuilds / terminalSummary.buildRuns) * 100) : 0;
  terminalSummary.repeatedFailedCommands = r.repeated.map((x) => ({ command: x._id, count: x.count, timestamps: [] }));

  return {
    docs: totals.docs,
    totalSeconds: totals.seconds,
    totalLinesAdded: totals.linesAdded,
    projectCount: (totals.projects || []).filter(Boolean).length,
    timeline: new Map(r.timeline.map((row) => [String(row._id), row])),
    languageBreakdown: r.languages
      .map((l) => ({ _id: l._id, hours: parseFloat((l.seconds / 3600).toFixed(2)) }))
      .sort((a, b) => b.hours - a.hours),
    terminalSummary,
  };
}

module.exports = { viewData };
