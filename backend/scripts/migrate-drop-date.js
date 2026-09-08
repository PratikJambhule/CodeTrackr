#!/usr/bin/env node
/**
 * One-off: drop the dead `date` field from `activities` and its index.
 * Nothing in production reads `date` (see the write-reduction spec).
 *
 *   node scripts/migrate-drop-date.js            # dry run
 *   node scripts/migrate-drop-date.js --apply
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const col = mongoose.connection.collection('activities');

  const withDate = await col.countDocuments({ date: { $exists: true } });
  const indexes = await col.indexes();
  const legacyIdx = indexes.find((i) => i.name === 'userId_1_date_-1');

  console.log(`\ndocuments carrying a 'date' field : ${withDate}`);
  console.log(`legacy index userId_1_date_-1     : ${legacyIdx ? 'present' : 'absent'}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to perform the change.\n');
    await mongoose.disconnect();
    return;
  }

  if (legacyIdx) {
    await col.dropIndex('userId_1_date_-1');
    console.log("dropped index 'userId_1_date_-1'");
  }
  const r = await col.updateMany({ date: { $exists: true } }, { $unset: { date: '' } });
  console.log(`unset 'date' on ${r.modifiedCount} document(s)`);

  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
