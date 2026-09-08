/**
 * Daily rollup — DB orchestration. Rolls raw `activities` older than
 * `beforeDays` into one `DailySummary` per (userId, UTC day). Idempotent
 * ($set, re-runnable). Never deletes raw activity — the 400-day TTL on
 * `activities.createdAt` owns retention.
 */
const Activity = require('../models/Activity');
const DailySummary = require('../models/DailySummary');
const { buildDaySummary } = require('./dailySummary');

async function rollupDaily({ apply = false, beforeDays = 2, force = false } = {}) {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - beforeDays);

    // Distinct (userId, UTC day) pairs with raw activity before the cutoff.
    const pairs = await Activity.aggregate([
        { $match: { timestamp: { $lt: cutoff } } },
        {
            $group: {
                _id: {
                    userId: '$userId',
                    day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'UTC' } },
                },
            },
        },
    ]);

    let wrote = 0;
    for (const { _id: { userId, day } } of pairs) {
        if (!force) {
            const existing = await DailySummary.findOne({ userId, day }).lean();
            if (existing) continue;
        }
        const start = new Date(`${day}T00:00:00.000Z`);
        const end = new Date(start.getTime() + 86400000);
        const docs = await Activity.find({
            userId, timestamp: { $gte: start, $lt: end },
        }).lean();
        const summary = buildDaySummary(userId, day, docs);
        if (apply) {
            await DailySummary.updateOne({ userId, day }, { $set: summary }, { upsert: true });
        }
        wrote += 1;
    }

    return { scanned: pairs.length, wrote, apply, beforeDays };
}

module.exports = { rollupDaily };
