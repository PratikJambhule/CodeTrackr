#!/usr/bin/env node
/**
 * Print exactly what GET /api/metrics would return for a user, without needing
 * the HTTP layer or a session. Read-only.
 *
 *   node scripts/preview-insights.js --email you@example.com [--days 30]
 */

require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const EMAIL = arg('--email');
const DAYS = Number(arg('--days') || 30);

(async () => {
    if (!EMAIL) { console.error('Missing --email'); process.exit(1); }

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
    const User = require('../models/user');
    const { buildMetrics } = require('../services/metricsService');

    const user = await User.findOne({ email: EMAIL });
    if (!user) { console.error(`No user with email ${EMAIL}`); await mongoose.disconnect(); process.exit(1); }

    // Match what the browser sends so day/hour bucketing lines up.
    const timezoneOffset = new Date().getTimezoneOffset();
    const m = await buildMetrics(user._id.toString(), { days: DAYS, timezoneOffset });

    const mins = (ms) => Math.round(ms / 60000);
    const pct = (r) => `${Math.round(r * 100)}%`;

    console.log(`\n=== Insights preview for ${user.name} — last ${m.windowDays} days ===\n`);
    console.log(`Deep work        : ${pct(m.deepWorkRatio)}`);
    console.log(`Flow blocks      : longest ${mins(m.flowBlocks.longestMs)} min, typical ${mins(m.flowBlocks.medianMs)} min`);
    console.log(`                   ${m.flowBlocks.deepBlockCount} deep of ${m.flowBlocks.blockCount} blocks`);
    console.log(`Consistency      : ${pct(m.consistencyIndex)}`);
    console.log(`Peak hour        : ${m.truePeakWindow ? String(m.truePeakWindow.hour).padStart(2, '0') + ':00 (score ' + m.truePeakWindow.score + ')' : 'n/a'}`);
    console.log(`Estimation       : ${m.estimationCalibration ? m.estimationCalibration.factor + 'x over ' + m.estimationCalibration.sampleSize + ' goals' : 'n/a'}`);
    console.log(`\nSecondary`);
    console.log(`  rework ratio        : ${pct(m.churnRatio)}`);
    console.log(`  time reading        : ${pct(m.comprehensionLoad)}`);
    console.log(`  file switches / hr  : ${m.contextSwitchesPerHour}`);
    console.log(`  commits             : ${m.commits}`);
    console.log(`  total hours         : ${m.totalHours}`);

    // The point of truePeakWindow is that the most PRODUCTIVE hour is often not
    // the BUSIEST one. Show both so that claim can be checked rather than trusted.
    const Activity = require('../models/Activity');
    const offsetMs = timezoneOffset * 60000;
    const busiest = await Activity.aggregate([
        { $match: { userId: user._id.toString(), timestamp: { $gte: new Date(Date.now() - DAYS * 864e5) } } },
        {
            $group: {
                _id: { $hour: { date: { $subtract: ['$timestamp', offsetMs] }, timezone: 'UTC' } },
                minutes: { $sum: { $divide: ['$duration', 60] } },
                churn: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } }
            }
        },
        { $sort: { minutes: -1 } },
        { $limit: 3 }
    ]);
    console.log(`\nBusiest hours by raw time (for comparison):`);
    busiest.forEach((h) =>
        console.log(`  ${String(h._id).padStart(2, '0')}:00  ${Math.round(h.minutes)} min, ${h.churn} churned lines`)
    );
    if (m.truePeakWindow && busiest[0] && busiest[0]._id !== m.truePeakWindow.hour) {
        console.log(`\n  -> busiest is ${String(busiest[0]._id).padStart(2, '0')}:00 but most PRODUCTIVE is ${String(m.truePeakWindow.hour).padStart(2, '0')}:00`);
    }
    console.log('');

    await mongoose.disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
