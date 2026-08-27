const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const mongoose = require('mongoose');
const { isAuthenticated } = require('../middleware/auth');
const { assertOwnership } = require('../services/authorization');

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

const STREAK_WINDOW_DAYS = 90;

// Consecutive days with recorded activity, bucketed in the user's local
// timezone and anchored to today (or yesterday, so a day that has not started
// yet does not read as a broken streak). Returns 0 when neither has activity.
async function computeStreak(userIdStr, timezoneOffset) {
    const offsetMs = (Number(timezoneOffset) || 0) * 60000;
    const since = new Date(Date.now() - STREAK_WINDOW_DAYS * 24 * 3600000);

    const days = await Activity.aggregate([
        { $match: { userId: userIdStr, timestamp: { $gte: since } } },
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
router.get('/:userId', isAuthenticated, async (req, res) => {
    try {
        const { userId } = req.params;
        const { timezone } = req.query; // Get timezone offset from query (in minutes)
        console.log('Daily analytics request for userId:', userId, 'timezone offset:', timezone);

        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;

        // Get today's date boundaries in user's timezone
        const now = new Date();
        const timezoneOffset = timezone ? parseInt(timezone) : 0; // Timezone offset in minutes
        
        // Calculate midnight in user's timezone, converted to UTC
        const userMidnightInUTC = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        ));
        userMidnightInUTC.setUTCMinutes(userMidnightInUTC.getUTCMinutes() + timezoneOffset);
        
        const startOfToday = new Date(userMidnightInUTC.getTime());
        const endOfToday = new Date(userMidnightInUTC.getTime() + (24 * 3600000) - 1);

        // Get activities from last 7 days for overall stats
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const activities = await Activity.find({
            userId: userIdStr,
            timestamp: { $gte: sevenDaysAgo }
        });

        console.log(`Found ${activities.length} activities in last 7 days`);

        // Get TODAY's activities for stats
        const todayActivities = activities.filter(a => {
            const activityDate = new Date(a.timestamp);
            return activityDate >= startOfToday && activityDate <= endOfToday;
        });

        console.log(`Found ${todayActivities.length} activities today`);

        if (!activities || activities.length === 0) {
            console.log('No activities found, returning empty data');
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

        // Calculate total hours for TODAY only
        const totalSeconds = todayActivities.reduce((sum, a) => sum + (a.duration || 0), 0);
        const totalHours = totalSeconds / 3600;

        // Calculate unique projects for TODAY only
        const uniqueProjects = new Set(todayActivities.map(a => a.projectName).filter(Boolean));
        const projectCount = uniqueProjects.size;

        // Calculate total lines added for TODAY only
        const totalLinesAdded = todayActivities.reduce((sum, a) => sum + (a.linesAdded || 0), 0);

        // Calculate streak days (consecutive days with activity)
        const streakDays = await computeStreak(userIdStr, timezoneOffset);

        // HOURLY activity aggregation for TODAY only (for the line chart)
        const hourlyMap = {};
        todayActivities.forEach(a => {
            const date = new Date(a.timestamp);
            // Adjust to user's timezone
            const userTime = new Date(date.getTime() - (timezoneOffset * 60000));
            const hour = userTime.getUTCHours();
            const hourKey = `${hour}:00`;
            if (!hourlyMap[hourKey]) {
                hourlyMap[hourKey] = 0;
            }
            hourlyMap[hourKey] += (a.duration || 0) / 3600; // Convert seconds to hours
        });

        // Create hourly breakdown (0:00 to 23:00)
        const dailyActivity = [];
        for (let hour = 0; hour < 24; hour++) {
            const hourKey = `${hour}:00`;
            dailyActivity.push({
                day: hourKey,
                hours: parseFloat((hourlyMap[hourKey] || 0).toFixed(2))
            });
        }

        // Language breakdown - TODAY ONLY for daily view (already filtered above)
        const languageMap = {};
        todayActivities.forEach(a => {
            const lang = a.language || 'Unknown';
            if (!languageMap[lang]) {
                languageMap[lang] = 0;
            }
            languageMap[lang] += (a.duration || 0) / 3600; // Convert seconds to hours
        });

        const languageBreakdown = Object.entries(languageMap)
            .map(([_id, hours]) => ({ _id, hours: parseFloat(hours.toFixed(2)) }))
            .sort((a, b) => b.hours - a.hours);

        const terminalSummary = buildTerminalSummary(todayActivities);

        const terminalHourlyMap = {};
        const buildHourlyMap = {};
        const gitHourlyMap = {};
        todayActivities.forEach(a => {
            const date = new Date(a.timestamp);
            const userTime = new Date(date.getTime() - (timezoneOffset * 60000));
            const hour = userTime.getUTCHours();
            const hourKey = `${hour}:00`;
            if (!terminalHourlyMap[hourKey]) {
                terminalHourlyMap[hourKey] = { success: 0, failed: 0 };
            }
            if (!buildHourlyMap[hourKey]) {
                buildHourlyMap[hourKey] = { success: 0, failed: 0 };
            }
            if (!gitHourlyMap[hourKey]) {
                gitHourlyMap[hourKey] = { commits: 0, pushes: 0, pulls: 0 };
            }
            const terminal = a.terminalAnalytics || {};
            terminalHourlyMap[hourKey].success += Number(terminal.successfulCommands) || 0;
            terminalHourlyMap[hourKey].failed += Number(terminal.failedCommands) || 0;
            buildHourlyMap[hourKey].success += Number(terminal.successfulBuilds) || 0;
            buildHourlyMap[hourKey].failed += Number(terminal.failedBuilds) || 0;
            gitHourlyMap[hourKey].commits += Number(terminal?.gitActivity?.commits) || 0;
            gitHourlyMap[hourKey].pushes += Number(terminal?.gitActivity?.pushes) || 0;
            gitHourlyMap[hourKey].pulls += Number(terminal?.gitActivity?.pulls) || 0;
        });

        const terminalTimeline = [];
        const buildTimeline = [];
        const gitTimeline = [];
        for (let hour = 0; hour < 24; hour++) {
            const hourKey = `${hour}:00`;
            terminalTimeline.push({
                hour: hourKey,
                success: terminalHourlyMap[hourKey]?.success || 0,
                failed: terminalHourlyMap[hourKey]?.failed || 0
            });
            buildTimeline.push({
                hour: hourKey,
                success: buildHourlyMap[hourKey]?.success || 0,
                failed: buildHourlyMap[hourKey]?.failed || 0
            });
            gitTimeline.push({
                hour: hourKey,
                commits: gitHourlyMap[hourKey]?.commits || 0,
                pushes: gitHourlyMap[hourKey]?.pushes || 0,
                pulls: gitHourlyMap[hourKey]?.pulls || 0
            });
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
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Error fetching analytics data', error: error.message });
    }
});

// GET user's weekly analytics data - day-wise breakdown for last 7 days
router.get('/weekly/:userId', isAuthenticated, async (req, res) => {
    try {
        const { userId } = req.params;
        const { timezone } = req.query;
        const timezoneOffset = timezone ? parseInt(timezone) : 0;
        console.log('Weekly analytics request for userId:', userId);

        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;

        // Get activities from the last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const activities = await Activity.find({
            userId: userIdStr,
            timestamp: { $gte: sevenDaysAgo }
        });

        console.log(`Found ${activities.length} activities for weekly view`);

        if (!activities || activities.length === 0) {
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

        // Calculate daily aggregations for last 7 days
        const dailyMap = {};
        activities.forEach(a => {
            const dayKey = localDayInfo(a.timestamp, timezoneOffset).key;
            
            if (!dailyMap[dayKey]) {
                dailyMap[dayKey] = 0;
            }
            dailyMap[dayKey] += (a.duration || 0) / 3600;
        });

        // Create array for last 7 days (even if no activity)
        const dailyActivity = [];
        for (let i = 6; i >= 0; i--) {
            const { key: dayKey, label: dayName } = localDayInfo(Date.now() - i * 24 * 3600000, timezoneOffset);
            
            dailyActivity.push({
                day: dayName,
                hours: parseFloat((dailyMap[dayKey] || 0).toFixed(2))
            });
        }

        // Language breakdown for entire week
        const languageMap = {};
        activities.forEach(a => {
            const lang = a.language || 'Unknown';
            if (!languageMap[lang]) {
                languageMap[lang] = 0;
            }
            languageMap[lang] += (a.duration || 0) / 3600;
        });

        const languageBreakdown = Object.entries(languageMap)
            .map(([_id, hours]) => ({ _id, hours: parseFloat(hours.toFixed(2)) }))
            .sort((a, b) => b.hours - a.hours);

        // Calculate totals
        const totalSeconds = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
        const totalHours = totalSeconds / 3600;
        const uniqueProjects = new Set(activities.map(a => a.projectName).filter(Boolean));
        const totalLinesAdded = activities.reduce((sum, a) => sum + (a.linesAdded || 0), 0);

        // Calculate streak
        const streakDays = await computeStreak(userIdStr, timezoneOffset);

        const terminalSummary = buildTerminalSummary(activities);

        const terminalDailyMap = {};
        const buildDailyMap = {};
        const gitDailyMap = {};
        activities.forEach(a => {
            const dayKey = localDayInfo(a.timestamp, timezoneOffset).key;
            if (!terminalDailyMap[dayKey]) {
                terminalDailyMap[dayKey] = { success: 0, failed: 0 };
            }
            if (!buildDailyMap[dayKey]) {
                buildDailyMap[dayKey] = { success: 0, failed: 0 };
            }
            if (!gitDailyMap[dayKey]) {
                gitDailyMap[dayKey] = { commits: 0, pushes: 0, pulls: 0 };
            }

            const terminal = a.terminalAnalytics || {};
            terminalDailyMap[dayKey].success += Number(terminal.successfulCommands) || 0;
            terminalDailyMap[dayKey].failed += Number(terminal.failedCommands) || 0;
            buildDailyMap[dayKey].success += Number(terminal.successfulBuilds) || 0;
            buildDailyMap[dayKey].failed += Number(terminal.failedBuilds) || 0;
            gitDailyMap[dayKey].commits += Number(terminal?.gitActivity?.commits) || 0;
            gitDailyMap[dayKey].pushes += Number(terminal?.gitActivity?.pushes) || 0;
            gitDailyMap[dayKey].pulls += Number(terminal?.gitActivity?.pulls) || 0;
        });

        const terminalTimeline = [];
        const buildTimeline = [];
        const gitTimeline = [];
        for (let i = 6; i >= 0; i--) {
            const { key: dayKey, label: dayName } = localDayInfo(Date.now() - i * 24 * 3600000, timezoneOffset);

            terminalTimeline.push({
                day: dayName,
                success: terminalDailyMap[dayKey]?.success || 0,
                failed: terminalDailyMap[dayKey]?.failed || 0
            });
            buildTimeline.push({
                day: dayName,
                success: buildDailyMap[dayKey]?.success || 0,
                failed: buildDailyMap[dayKey]?.failed || 0
            });
            gitTimeline.push({
                day: dayName,
                commits: gitDailyMap[dayKey]?.commits || 0,
                pushes: gitDailyMap[dayKey]?.pushes || 0,
                pulls: gitDailyMap[dayKey]?.pulls || 0
            });
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
        console.error('Error fetching weekly analytics:', error);
        res.status(500).json({ message: 'Error fetching weekly analytics data', error: error.message });
    }
});

// GET user's daily and per-stack coding activity (legacy endpoint)
router.get('/summary/:userId', isAuthenticated, async (req, res) => {
    try {
        const { userId } = req.params;

        // userId is stored as String in Activity model
        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;

        // Daily total hours (duration is in seconds, so we divide by 3600)
        const dailyTotals = await Activity.aggregate([
            { $match: { userId: userIdStr } },
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
            { $match: { userId: userIdStr } },
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
        res.status(500).json({ message: 'Error fetching analytics data', error: error.message });
    }
});

// GET time slot detailed analytics
router.get('/timeslot/:userId', isAuthenticated, async (req, res) => {
    try {
        const { userId } = req.params;
        const { start, end, timezone } = req.query;
        
        console.log(`Time slot analytics request for userId: ${userId}, ${start}:00 - ${end}:00, timezone offset: ${timezone}`);

        const userIdStr = resolveOwnedUserId(req, res);
        if (!userIdStr) return;
        const startHour = parseInt(start);
        const endHour = parseInt(end);
        const timezoneOffset = timezone ? parseInt(timezone) : 0;

        // Get today's date at midnight in user's timezone
        const now = new Date();
        
        // Calculate what time in UTC corresponds to midnight in user's timezone
        // If timezoneOffset is -330 (IST), we need to ADD 330 minutes to UTC to get IST
        // So to go from IST midnight to UTC, we SUBTRACT 330 minutes
        const userMidnightInUTC = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        ));
        userMidnightInUTC.setUTCMinutes(userMidnightInUTC.getUTCMinutes() + timezoneOffset);
        
        // Now add the hours to get the time range in UTC
        const startTime = new Date(userMidnightInUTC.getTime() + (startHour * 3600000));
        const endTime = new Date(userMidnightInUTC.getTime() + (endHour * 3600000));

        console.log(`Searching activities between ${startTime.toISOString()} and ${endTime.toISOString()}`);

        // Get activities in this time slot for today
        const activities = await Activity.find({
            userId: userIdStr,
            timestamp: { $gte: startTime, $lt: endTime }
        }).sort({ timestamp: 1 });

        console.log(`Found ${activities.length} activities in time slot`);

        // Calculate statistics
        const totalMinutes = activities.reduce((sum, a) => sum + (a.duration / 60), 0);
        const totalLines = activities.reduce((sum, a) => sum + (a.linesAdded || 0) + (a.linesRemoved || 0), 0);
        const fileCount = new Set(activities.map(a => a.fileName)).size;
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
        console.error('Error fetching time slot analytics:', error);
        res.status(500).json({ message: 'Error fetching time slot analytics', error: error.message });
    }
});

module.exports = router;
