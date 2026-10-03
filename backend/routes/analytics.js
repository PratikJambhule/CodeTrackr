const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const mongoose = require('mongoose');
const { isAuthenticated } = require('../middleware/auth');
const { assertOwnership } = require('../services/authorization');
const { viewData } = require('../services/analyticsViews');
const { matchActivityUser } = require('../services/activityUser');

/**
 * Verifies the caller owns :userId. Returns the id to query, or null when a
 * response has already been sent.
 *
 * The :userId param is retained for compatibility with the deployed dashboard
 * but is now verified against the session rather than trusted (H-1).
 */
function resolveOwnedUserId(req, res) {
    const sessionUserId = req.user && req.user._id ? req.user._id.toString() : null;
    const verdict = assertOwnership(req.params.userId, sessionUserId);
    if (!verdict.ok) {
        res.status(verdict.status).json({ message: verdict.message });
        return null;
    }
    return req.params.userId || sessionUserId;
}

function mergeCountMap(target, incoming) {
    if (!incoming) return;
    Object.entries(incoming).forEach(([key, value]) => {
        const numeric = Number(value) || 0;
        target[key] = (target[key] || 0) + numeric;
    });
}

function mergeRepeatedFailures(targetMap, entries) {
    if (!Array.isArray(entries)) return;
    entries.forEach(entry => {
        if (!entry || !entry.command) return;
        const key = entry.command;
        const existing = targetMap.get(key) || { command: key, count: 0, timestamps: [] };
        existing.count += Number(entry.count) || 0;
        if (Array.isArray(entry.timestamps)) {
            existing.timestamps.push(...entry.timestamps);
        }
        targetMap.set(key, existing);
    });
}

function buildTerminalSummary(activities) {
    const summary = {
        totalCommands: 0,
        terminalErrorCount: 0,
        successfulCommands: 0,
        failedCommands: 0,
        successRate: 0,
        buildRuns: 0,
        testRuns: 0,
        successfulBuilds: 0,
        failedBuilds: 0,
        buildSuccessRate: 0,
        debuggingSessions: 0,
        commandUsage: {
            git: 0,
            npm: 0,
            node: 0,
            python: 0,
            docker: 0,
            gcc: 0,
            java: 0,
            pip: 0,
            misc: 0
        },
        gitActivity: {
            commits: 0,
            pushes: 0,
            pulls: 0,
            checkouts: 0,
            merges: 0,
            clones: 0
        },
        repeatedFailedCommands: []
    };

    const repeatedFailures = new Map();

    activities.forEach(activity => {
        const terminal = activity.terminalAnalytics || {};
        summary.totalCommands += Number(terminal.totalCommands) || 0;
        summary.terminalErrorCount += Number(terminal.terminalErrorCount) || 0;
        summary.successfulCommands += Number(terminal.successfulCommands) || 0;
        summary.failedCommands += Number(terminal.failedCommands) || 0;
        summary.buildRuns += Number(terminal.buildRuns) || 0;
        summary.testRuns += Number(terminal.testRuns) || 0;
        summary.successfulBuilds += Number(terminal.successfulBuilds) || 0;
        summary.failedBuilds += Number(terminal.failedBuilds) || 0;
        summary.debuggingSessions += Number(terminal.debuggingSessions) || 0;

        mergeCountMap(summary.commandUsage, terminal.commandUsage);

        summary.gitActivity.commits += Number(terminal?.gitActivity?.commits) || 0;
        summary.gitActivity.pushes += Number(terminal?.gitActivity?.pushes) || 0;
        summary.gitActivity.pulls += Number(terminal?.gitActivity?.pulls) || 0;
        summary.gitActivity.checkouts += Number(terminal?.gitActivity?.checkouts) || 0;
        summary.gitActivity.merges += Number(terminal?.gitActivity?.merges) || 0;
        summary.gitActivity.clones += Number(terminal?.gitActivity?.clones) || 0;

        mergeRepeatedFailures(repeatedFailures, terminal.repeatedFailedCommands);
    });

    summary.successRate = summary.totalCommands > 0
        ? Math.round((summary.successfulCommands / summary.totalCommands) * 100)
        : 0;

    summary.buildSuccessRate = summary.buildRuns > 0
        ? Math.round((summary.successfulBuilds / summary.buildRuns) * 100)
        : 0;

    summary.repeatedFailedCommands = Array.from(repeatedFailures.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    return summary;
}

// Day key + display label for an instant, in the user's local timezone.
// timezoneOffset is Date.getTimezoneOffset() (minutes, negative east of UTC).
function localDayInfo(instant, timezoneOffset) {
    const offsetMs = (Number(timezoneOffset) || 0) * 60000;
    const local = new Date(new Date(instant).getTime() - offsetMs);
    return {
        key: local.toISOString().slice(0, 10),
        label: local.toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric", timeZone: "UTC"
        })
    };
}

/**
 * The UTC instant at which "today" began in the user's timezone (H-22).
 * `timezoneOffset` is Date.getTimezoneOffset(): minutes, negative east of UTC.
 * Take the LOCAL date first, then convert its midnight back to UTC. The old
 * inline version took the UTC date, so it was a day off whenever the two
 * dates differ (00:00-05:30 in India).
 */
function localMidnightUtc(instant, timezoneOffset) {
    const offset = Number(timezoneOffset);
    const offsetMs = (Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0) * 60000;
    const local = new Date(new Date(instant).getTime() - offsetMs);
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs);
}

const STREAK_WINDOW_DAYS = 90;

// Consecutive days with recorded activity, bucketed in the user's local
// timezone and anchored to today (or yesterday, so a day that has not started
// yet does not read as a broken streak). Returns 0 when neither has activity.
async function computeStreak(userIdStr, timezoneOffset) {
    const offsetMs = (Number(timezoneOffset) || 0) * 60000;
    const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 24 * 3600000);

    const days = await Activity.aggregate([
        { $match: { userId: matchActivityUser(userIdStr), timestamp: { $gte: since } } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: "%Y-%m-%d",
                        date: { $subtract: ["$timestamp", offsetMs] }
                    }
                },
                seconds: { $sum: "$duration" }
            }
        },
        { $match: { seconds: { $gt: 0 } } }
    ]);

    const active = new Set(days.map(d => d._id));
    if (active.size === 0) return 0;

    // Shift "now" into the user's timezone, then read the UTC day so the key
    // format matches the aggregation above.
    const localNow = new Date(Date.now() - offsetMs);
    const keyFor = (daysAgo) =>
        new Date(localNow.getTime() - daysAgo * 24 * 3600000).toISOString().slice(0, 10);

    const start = active.has(keyFor(0)) ? 0 : (active.has(keyFor(1)) ? 1 : -1);
    if (start === -1) return 0;

    let streak = 0;
    for (let i = start; i < STREAK_WINDOW_DAYS; i++) {
        if (!active.has(keyFor(i))) break;
        streak++;
    }
    return streak;
}

// GET user's analytics data - Daily view with hourly breakdown
router.get('/:userId', isAuthenticated, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { timezone } = req.query; // Get timezone offset from query (in minutes)

        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;

        // Get today's date boundaries in user's timezone
        const now = new Date();
        const timezoneOffset = timezone ? parseInt(timezone) : 0; // Timezone offset in minutes
        
        // Midnight in the user's timezone, as a UTC instant (H-22).
        const userMidnightInUTC = localMidnightUtc(now, timezoneOffset);
        
        const startOfToday = new Date(userMidnightInUTC.getTime());
        const endOfToday = new Date(userMidnightInUTC.getTime() + (24 * 3600000) - 1);

        // One $facet pipeline over TODAY only (M-1). The old code loaded seven
        // days of documents into Node to show one day.
        const view = await viewData({
            userId: userIdStr,
            from: startOfToday,
            to: new Date(endOfToday.getTime() + 1),
            offsetMinutes: timezoneOffset,
            unit: 'hour',
        });

        if (view.docs === 0) {
            // Same contract as before: empty arrays only when there has been no
            // activity at all in the last 7 days; otherwise a zero-filled day.
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600000);
            const anyThisWeek = await Activity.exists({ userId: matchActivityUser(userIdStr), timestamp: { $gte: sevenDaysAgo } });
            if (!anyThisWeek) {
                return res.json({
                    totalHours: 0,
                    projectCount: 0,
                    totalLinesAdded: 0,
                    streakDays: 0,
                    dailyActivity: [],
                    languageBreakdown: [],
                    terminalSummary: buildTerminalSummary([]),
                    terminalTimeline: [],
                    buildTimeline: [],
                    gitTimeline: []
                });
            }
        }

        const totalHours = view.totalSeconds / 3600;
        const projectCount = view.projectCount;
        const totalLinesAdded = view.totalLinesAdded;
        const streakDays = await computeStreak(userIdStr, timezoneOffset);
        const languageBreakdown = view.languageBreakdown;
        const terminalSummary = view.terminalSummary;

        // Lay the per-hour rows out on the 0:00..23:00 grid.
        const dailyActivity = [];
        const terminalTimeline = [];
        const buildTimeline = [];
        const gitTimeline = [];
        for (let hour = 0; hour < 24; hour++) {
            const row = view.timeline.get(String(hour)) || {};
            const hourKey = `${hour}:00`;
            dailyActivity.push({ day: hourKey, hours: parseFloat(((row.seconds || 0) / 3600).toFixed(2)) });
            terminalTimeline.push({ hour: hourKey, success: row.success || 0, failed: row.failed || 0 });
            buildTimeline.push({ hour: hourKey, success: row.buildSuccess || 0, failed: row.buildFailed || 0 });
            gitTimeline.push({ hour: hourKey, commits: row.commits || 0, pushes: row.pushes || 0, pulls: row.pulls || 0 });
        }

        res.json({
            totalHours: parseFloat(totalHours.toFixed(2)),
            projectCount,
            totalLinesAdded,
            streakDays,
            dailyActivity,
            languageBreakdown,
            terminalSummary,
            terminalTimeline,
            buildTimeline,
            gitTimeline
        });

    } catch (error) {
        return next(error);
    }
});

// GET user's weekly analytics data - day-wise breakdown for last 7 days
router.get('/weekly/:userId', isAuthenticated, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { timezone } = req.query;
        const timezoneOffset = timezone ? parseInt(timezone) : 0;

        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;

        // The seven local days shown on the chart: from local midnight six days
        // ago. (The old window started at the SERVER's midnight seven days ago,
        // so totals could include up to a day the chart did not show — M-32.)
        const weekStart = new Date(localMidnightUtc(Date.now(), timezoneOffset).getTime() - 6 * 24 * 3600000);
        const view = await viewData({
            userId: userIdStr,
            from: weekStart,
            to: new Date(Date.now() + 24 * 3600000),
            offsetMinutes: timezoneOffset,
            unit: 'day',
        });

        if (view.docs === 0) {
            return res.json({
                totalHours: 0,
                projectCount: 0,
                totalLinesAdded: 0,
                streakDays: 0,
                dailyActivity: [],
                languageBreakdown: [],
                terminalSummary: buildTerminalSummary([]),
                terminalTimeline: [],
                buildTimeline: [],
                gitTimeline: []
            });
        }

        const totalHours = view.totalSeconds / 3600;
        const uniqueProjects = { size: view.projectCount };
        const totalLinesAdded = view.totalLinesAdded;
        const streakDays = await computeStreak(userIdStr, timezoneOffset);
        const languageBreakdown = view.languageBreakdown;
        const terminalSummary = view.terminalSummary;

        // Lay the per-day rows out on the last-7-local-days grid.
        const dailyActivity = [];
        const terminalTimeline = [];
        const buildTimeline = [];
        const gitTimeline = [];
        for (let i = 6; i >= 0; i--) {
            const { key: dayKey, label: dayName } = localDayInfo(Date.now() - i * 24 * 3600000, timezoneOffset);
            const row = view.timeline.get(dayKey) || {};
            dailyActivity.push({ day: dayName, hours: parseFloat(((row.seconds || 0) / 3600).toFixed(2)) });
            terminalTimeline.push({ day: dayName, success: row.success || 0, failed: row.failed || 0 });
            buildTimeline.push({ day: dayName, success: row.buildSuccess || 0, failed: row.buildFailed || 0 });
            gitTimeline.push({ day: dayName, commits: row.commits || 0, pushes: row.pushes || 0, pulls: row.pulls || 0 });
        }

        res.json({
            totalHours: parseFloat(totalHours.toFixed(2)),
            projectCount: uniqueProjects.size,
            totalLinesAdded,
            streakDays,
            dailyActivity,
            languageBreakdown,
            terminalSummary,
            terminalTimeline,
            buildTimeline,
            gitTimeline
        });

    } catch (error) {
        return next(error);
    }
});

// GET user's daily and per-stack coding activity (legacy endpoint)
router.get('/summary/:userId', isAuthenticated, async (req, res, next) => {
    try {
        const { userId } = req.params;

        // Activity.userId may be a String (legacy) or an ObjectId (item 10).
        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;

        // Daily total hours (duration is in seconds, so we divide by 3600)
        const dailyTotals = await Activity.aggregate([
            { $match: { userId: matchActivityUser(userIdStr) } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
                    totalHours: { $sum: { $divide: ["$duration", 3600] } }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Per-technology stack time (in seconds, convert to hours)
        const stackTotals = await Activity.aggregate([
            { $match: { userId: matchActivityUser(userIdStr) } },
            {
                $group: {
                    _id: "$language",
                    totalHours: { $sum: { $divide: ["$duration", 3600] } }
                }
            },
            { $sort: { totalHours: -1 } }
        ]);

        res.json({ dailyTotals, stackTotals });

    } catch (error) {
        return next(error);
    }
});

// GET time slot detailed analytics
router.get('/timeslot/:userId', isAuthenticated, async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { start, end, timezone } = req.query;
        

        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;
        const startHour = parseInt(start);
        const endHour = parseInt(end);
        const timezoneOffset = timezone ? parseInt(timezone) : 0;

        // Get today's date at midnight in user's timezone
        const now = new Date();
        
        // Midnight in the user's timezone, as a UTC instant (H-22).
        const userMidnightInUTC = localMidnightUtc(now, timezoneOffset);
        
        // Now add the hours to get the time range in UTC
        const startTime = new Date(userMidnightInUTC.getTime() + (startHour * 3600000));
        const endTime = new Date(userMidnightInUTC.getTime() + (endHour * 3600000));


        // Get activities in this time slot for today
        const activities = await Activity.find({
            userId: matchActivityUser(userIdStr),
            timestamp: { $gte: startTime, $lt: endTime }
        }).sort({ timestamp: 1 });


        // Calculate statistics
        const totalMinutes = activities.reduce((sum, a) => sum + (a.duration / 60), 0);
        const totalLines = activities.reduce((sum, a) => sum + (a.linesAdded || 0) + (a.linesRemoved || 0), 0);
        // Bucketed docs carry a de-duplicated `files` array; legacy per-flush
        // docs carry a single `fileName`. Count real files across both.
        const fileCount = new Set(
            activities.flatMap(a =>
                (Array.isArray(a.files) && a.files.length)
                    ? a.files
                    : (a.fileName ? [a.fileName] : [])
            )
        ).size;
        const productivity = activities.length > 0 ? Math.min(100, Math.round((totalLines / activities.length) * 2)) : 0;

        const terminalSummary = buildTerminalSummary(activities);

        // Create 10-minute interval slots (12 slots for 2-hour window)
        const tenMinuteSlots = [];
        for (let i = 0; i < 12; i++) {
            const slotStart = startHour * 60 + i * 10; // minutes since midnight
            const slotEnd = slotStart + 10;
            const startMin = slotStart % 60;
            const endMin = slotEnd % 60;
            const startHourForSlot = Math.floor(slotStart / 60);
            const endHourForSlot = Math.floor(slotEnd / 60);
            
            tenMinuteSlots.push({
                label: `${String(startHourForSlot).padStart(2, '0')}:${String(startMin).padStart(2, '0')}-${String(endHourForSlot).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
                lines: 0
            });
        }
        
        // Aggregate activities into 10-minute slots
        activities.forEach(activity => {
            const activityTime = new Date(activity.timestamp);
            const minutesSinceStart = Math.floor((activityTime - startTime) / 60000);
            const slotIndex = Math.floor(minutesSinceStart / 10);
            
            if (slotIndex >= 0 && slotIndex < 12) {
                tenMinuteSlots[slotIndex].lines += (activity.linesAdded || 0) + (activity.linesRemoved || 0);
            }
        });

        // Language breakdown
        const languageMap = new Map();
        activities.forEach(activity => {
            const lang = activity.language || 'Unknown';
            if (!languageMap.has(lang)) {
                languageMap.set(lang, { _id: lang, minutes: 0, lines: 0 });
            }
            const entry = languageMap.get(lang);
            entry.minutes += activity.duration / 60;
            entry.lines += (activity.linesAdded || 0) + (activity.linesRemoved || 0);
        });

        const languages = Array.from(languageMap.values())
            .sort((a, b) => b.minutes - a.minutes);

        res.json({
            totalMinutes: Math.round(totalMinutes),
            totalLines,
            fileCount,
            productivity,
            tenMinuteSlots,
            languages,
            activityCount: activities.length,
            terminalSummary
        });

    } catch (error) {
        return next(error);
    }
});

module.exports = router;
