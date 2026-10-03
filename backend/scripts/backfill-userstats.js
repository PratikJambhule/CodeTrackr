#!/usr/bin/env node
/**
 * Build (or reconcile) the `userstats` running totals from `activities`
 * (roadmap item 6). Until this has run once, the leaderboard keeps using the
 * old full scan, so deploying the code first is safe.
 *
 *   node scripts/backfill-userstats.js            # dry run: counts users only
 *   node scripts/backfill-userstats.js --apply    # operator action; run when ingest is quiet
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { rebuildAll } = require('../services/userStats');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const r = await rebuildAll({ apply: APPLY });
  console.log(`\nusers with activity : ${r.users}`);
  console.log(APPLY ? `userstats written    : ${r.written}` : '\nDRY RUN — re-run with --apply to write userstats.\n');
  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
