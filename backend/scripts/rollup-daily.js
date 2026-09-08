#!/usr/bin/env node
/**
 * Roll raw `activities` older than N days into DailySummary documents.
 *
 *   node scripts/rollup-daily.js                 # dry run, days ending >= 2 days ago
 *   node scripts/rollup-daily.js --apply
 *   node scripts/rollup-daily.js --apply --before 7 --force
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { rollupDaily } = require('../services/dailyRollup');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const beforeIdx = args.indexOf('--before');
const BEFORE = beforeIdx !== -1 ? Number(args[beforeIdx + 1]) : 2;

(async () => {
    if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

    const r = await rollupDaily({ apply: APPLY, beforeDays: BEFORE, force: FORCE });

    console.log(`\n(userId, day) pairs before the cutoff : ${r.scanned}`);
    console.log(`${APPLY ? 'wrote' : 'would write'} summaries               : ${r.wrote}`);
    if (!APPLY) console.log('\nDRY RUN — re-run with --apply.\n');

    await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
