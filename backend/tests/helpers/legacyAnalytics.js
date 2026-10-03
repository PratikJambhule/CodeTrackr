/**
 * ORACLE for the M-1 refactor: the dashboard's daily and weekly aggregation
 * exactly as it was in routes/analytics.js before 2026-10-03, extracted
 * verbatim (by script) into pure functions over an array of activity docs.
 * The pipeline version must produce the same output for the same data.
 * Do not "fix" this file — its value is that it is the old code.
 */
/* eslint-disable */
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

function legacyDaily(todayActivities, timezoneOffset) {
        // Calculate total hours for TODAY only
        const totalSeconds = todayActivities.reduce((sum, a) => sum + (a.duration || 0), 0);
        const totalHours = totalSeconds / 3600;

        // Calculate unique projects for TODAY only
        const uniqueProjects = new Set(todayActivities.map(a => a.projectName).filter(Boolean));
        const projectCount = uniqueProjects.size;

        // Calculate total lines added for TODAY only
        const totalLinesAdded = todayActivities.reduce((sum, a) => sum + (a.linesAdded || 0), 0);

        // Calculate streak days (consecutive days with activity)

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


        return {
            totalHours: parseFloat(totalHours.toFixed(2)),
            projectCount,
            totalLinesAdded,
            dailyActivity,
            languageBreakdown,
            terminalSummary,
            terminalTimeline,
            buildTimeline,
            gitTimeline
        };
}

function legacyWeekly(activities, timezoneOffset) {
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


        return {
            totalHours: parseFloat(totalHours.toFixed(2)),
            projectCount: uniqueProjects.size,
            totalLinesAdded,
            dailyActivity,
            languageBreakdown,
            terminalSummary,
            terminalTimeline,
            buildTimeline,
            gitTimeline
        };
}

module.exports = { legacyDaily, legacyWeekly };
