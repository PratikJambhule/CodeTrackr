#!/usr/bin/env node
/**
 * Replace stored command text with its kind (plan B5): "g++ two_sum.cpp" -> "compile".
 * Run once after deploying the API that stops storing text. Safe while the app is live.
 *
 *   node scripts/scrub-command-text.js            # dry run: count only
 *   node scripts/scrub-command-text.js --apply    # operator action
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { scrubCommandText } = require('../services/commandTextScrub');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const r = await scrubCommandText({ apply: APPLY });
  console.log(`\nactivities still holding command text : ${r.withText}`);
  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to replace the text with its kind.\n');
  } else {
    console.log(`updated ${r.updated}, remaining ${r.remaining}`);
  }
  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
