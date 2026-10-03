#!/usr/bin/env node
/**
 * Convert activities.userId from hex String to ObjectId (roadmap item 10, M-6).
 * Safe to run while the app is live: every read already matches both forms.
 *
 *   node scripts/migrate-activity-userid.js            # dry run: count only
 *   node scripts/migrate-activity-userid.js --apply    # operator action
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { migrateActivityUserIds } = require('../services/activityUserMigration');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const r = await migrateActivityUserIds({ apply: APPLY });
  console.log(`\nactivities with a String userId : ${r.strings}`);
  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to convert them.\n');
  } else {
    console.log(`converted ${r.converted}, merged into an existing bucket ${r.merged}, skipped (not an ObjectId) ${r.skipped}, remaining ${r.remaining}`);
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
