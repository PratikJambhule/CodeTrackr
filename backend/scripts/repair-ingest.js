/**
 * One-off repair after the stale-index 500s on POST /api/extension/track (2026-10-22).
 *
 *   node scripts/repair-ingest.js            # dry run: prints what it would change
 *   node scripts/repair-ingest.js --apply    # operator action
 *
 * 1. Drops unique indexes on `activities` that models/Activity.js does not declare (the stale
 *    { userId, day, source, fileKey, hour, timestamp } index allowed one bucket per user per window).
 * 2. Lowers window counters (windowusages, last 48 h) to the seconds actually credited, undoing the
 *    claims of uploads that were refused, so queued uploads are credited when they go through.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const WindowUsage = require('../models/WindowUsage');
const { staleUniqueIndexes, windowRepairs } = require('../services/ingestRepair');

const APPLY = process.argv.includes('--apply');

async function repair({ apply = false, now = Date.now() } = {}) {
  const live = await Activity.collection.indexes();
  const stale = staleUniqueIndexes(live, Activity.schema.indexes());

  const since = new Date(now - 48 * 3600e3);
  const usages = await WindowUsage.find({ bucketStart: { $gte: since } }).lean();
  const sums = await Activity.aggregate([
    { $match: { bucketStart: { $gte: since } } },
    { $group: { _id: { userId: { $toString: '$userId' }, bucketStart: '$bucketStart' }, seconds: { $sum: '$duration' } } },
  ]);
  const credited = new Map(sums.map((s) => [`${s._id.userId}|${s._id.bucketStart.toISOString()}`, s.seconds]));
  const windows = windowRepairs(usages, credited);

  if (apply) {
    for (const ix of stale) await Activity.collection.dropIndex(ix.name);
    for (const w of windows) await WindowUsage.updateOne({ _id: w._id, seconds: w.from }, { $set: { seconds: w.to } });
  }
  return { stale: stale.map((ix) => ({ name: ix.name, key: ix.key })), windows };
}

if (require.main === module) {
  (async () => {
    if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000, autoIndex: false, autoCreate: false }); // maintenance: never build indexes or collections
    const r = await repair({ apply: APPLY });
    console.log(`\nStale unique indexes on activities: ${r.stale.length}`);
    for (const ix of r.stale) console.log(`  - ${ix.name}  ${JSON.stringify(ix.key)}`);
    console.log(`Window counters above what was credited (last 48 h): ${r.windows.length}`);
    for (const w of r.windows) console.log(`  - user …${String(w.userId).slice(-4)} ${w.bucketStart.toISOString()}: ${w.from} s -> ${w.to} s`);
    console.log(APPLY ? '\nAPPLIED.\n' : '\nDRY RUN — re-run with --apply to drop the indexes and lower the counters.\n');
    await mongoose.disconnect();
  })().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { repair };
