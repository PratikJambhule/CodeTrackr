#!/usr/bin/env node
/**
 * Read-only performance probe for the Insights path.
 *
 * Measures what a single GET /api/metrics actually costs: documents scanned by
 * each aggregate, documents read for sessionization, and wall-clock time —
 * plus whether the queries use an index.
 *
 * READ ONLY. Runs `explain` and counts; writes nothing.
 *
 *   node scripts/measure-insights.js [--days 30] [--user <userId>]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Activity = require('../models/Activity');

const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

(async () => {
    const days = Number(arg('days', 30));
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, family: 4, tls: true });

    let userId = arg('user', null);
    if (!userId) {
        const [top] = await Activity.aggregate([
            { $group: { _id: '$userId', n: { $sum: 1 } } },
            { $sort: { n: -1 } },
            { $limit: 1 },
        ]);
        userId = top?._id;
    }
    if (!userId) {
        console.log('No activity in the database — nothing to measure.');
        await mongoose.disconnect();
        return;
    }

    const since = new Date(Date.now() - days * 86400000);
    const match = { userId: String(userId), timestamp: { $gte: since } };

    console.log(`\nUser ${userId}  ·  window ${days} days  ·  since ${since.toISOString()}\n`);

    const total = await Activity.countDocuments({ userId: String(userId) });
    const inWindow = await Activity.countDocuments(match);
    console.log(`documents for this user, all time : ${total}`);
    console.log(`documents in the window           : ${inWindow}`);

    // Does the window query use the {userId, timestamp} index?
    const plan = await Activity.find(match).explain('executionStats');
    const stats = plan.executionStats || {};
    const stage = JSON.stringify(plan.queryPlanner?.winningPlan || {});
    console.log(`\nwindow query`);
    console.log(`  index used   : ${/IXSCAN/.test(stage) ? 'yes (IXSCAN)' : 'NO — collection scan'}`);
    console.log(`  docs examined: ${stats.totalDocsExamined}`);
    console.log(`  keys examined: ${stats.totalKeysExamined}`);
    console.log(`  returned     : ${stats.nReturned}`);
    console.log(`  time         : ${stats.executionTimeMillis} ms`);

    // The real cost of one Insights request.
    const { buildMetrics } = require('../services/metricsService');
    const t0 = Date.now();
    const m = await buildMetrics(String(userId), { days, timezoneOffset: 0 });
    const cold = Date.now() - t0;
    const t1 = Date.now();
    await buildMetrics(String(userId), { days, timezoneOffset: 0 });
    const warm = Date.now() - t1;

    console.log(`\nbuildMetrics`);
    console.log(`  cold (baseline recomputed): ${cold} ms`);
    console.log(`  warm (baseline cached)    : ${warm} ms`);
    console.log(`  sessions found            : ${m.sessionCount}`);
    console.log(`  session window            : ${m.sessionWindowDays} days`);
    console.log(`  flow blocks               : ${m.flowBlocks.blockCount}`);
    console.log(`  active days               : ${m.activeDays}`);
    console.log(`\nconfidence:`);
    for (const [k, v] of Object.entries(m.meta)) {
        console.log(`  ${k.padEnd(24)} ${v.confidence.padEnd(13)} (${v.sampleSize} ${v.unit})`);
    }

    await mongoose.disconnect();
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
