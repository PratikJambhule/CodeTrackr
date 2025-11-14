const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const mongoose = require('mongoose');
const { isAuthenticated } = require('../middleware/auth');

// GET user's analytics data - Daily view with hourly breakdown
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        console.log('Daily analytics request for userId:', userId);

        const userIdStr = userId.toString();

        // Get today's date
        const today = new Date();
        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const endOfToday = new Date(today.setHours(23, 59, 59, 999));

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
                languageBreakdown: []
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
        const uniqueDays = [...new Set(activities.map(a => {
            const date = new Date(a.timestamp);
            return date.toISOString().split('T')[0];
        }))].sort();

        let streakDays = 0;
        if (uniqueDays.length > 0) {
            streakDays = 1;
            for (let i = uniqueDays.length - 1; i > 0; i--) {
                const current = new Date(uniqueDays[i]);
                const previous = new Date(uniqueDays[i - 1]);
                const diffTime = Math.abs(current - previous);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    streakDays++;
                } else {
                    break;
                }
            }
        }

        // HOURLY activity aggregation for last 7 days (for the line chart)
        const hourlyMap = {};
        activities.forEach(a => {
            const date = new Date(a.timestamp);
            const hour = date.getHours();
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

        res.json({
            totalHours: parseFloat(totalHours.toFixed(2)),
            projectCount,
            totalLinesAdded,
            streakDays,
            dailyActivity,
            languageBreakdown
        });

    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Error fetching analytics data', error: error.message });
    }
});

// GET user's weekly analytics data - day-wise breakdown for last 7 days
router.get('/weekly/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        console.log('Weekly analytics request for userId:', userId);

        const userIdStr = userId.toString();

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
                languageBreakdown: []
            });
        }

        // Calculate daily aggregations for last 7 days
        const dailyMap = {};
        activities.forEach(a => {
            const date = new Date(a.timestamp);
            const dayKey = date.toISOString().split('T')[0];
            
            if (!dailyMap[dayKey]) {
                dailyMap[dayKey] = 0;
            }
            dailyMap[dayKey] += (a.duration || 0) / 3600;
        });

        // Create array for last 7 days (even if no activity)
        const dailyActivity = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayKey = date.toISOString().split('T')[0];
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
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
        const uniqueDays = [...new Set(activities.map(a => {
            const date = new Date(a.timestamp);
            return date.toISOString().split('T')[0];
        }))].sort();

        let streakDays = 0;
        if (uniqueDays.length > 0) {
            streakDays = 1;
            for (let i = uniqueDays.length - 1; i > 0; i--) {
                const current = new Date(uniqueDays[i]);
                const previous = new Date(uniqueDays[i - 1]);
                const diffTime = Math.abs(current - previous);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    streakDays++;
                } else {
                    break;
                }
            }
        }

        res.json({
            totalHours: parseFloat(totalHours.toFixed(2)),
            projectCount: uniqueProjects.size,
            totalLinesAdded,
            streakDays,
            dailyActivity,
            languageBreakdown
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
        const userIdStr = userId.toString();

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
router.get('/timeslot/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { start, end } = req.query;
        
        console.log(`Time slot analytics request for userId: ${userId}, ${start}:00 - ${end}:00`);

        const userIdStr = userId.toString();
        const startHour = parseInt(start);
        const endHour = parseInt(end);

        // Get today's date with specified time range
        const today = new Date();
        const startTime = new Date(today.setHours(startHour, 0, 0, 0));
        const endTime = new Date(today.setHours(endHour, 0, 0, 0));

        console.log(`Searching activities between ${startTime} and ${endTime}`);

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
            activityCount: activities.length
        });

    } catch (error) {
        console.error('Error fetching time slot analytics:', error);
        res.status(500).json({ message: 'Error fetching time slot analytics', error: error.message });
    }
});

module.exports = router;
