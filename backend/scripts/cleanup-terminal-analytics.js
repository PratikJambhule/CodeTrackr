#!/usr/bin/env node
/**
 * One-off cleanup: remove untrustworthy terminalAnalytics data.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two separate sources of bad data were confirmed on 2026-08-28:
 *
 * 1. GAUGE POLLUTION. The extension build that was actually installed
 *    (a stale dist/ shipped by the pre-2.0.11 packaging bug) tracked
 *    `terminalErrorCount` as a CUMULATIVE session counter that was never
 *    reset, and populated no other terminal field. Every flush therefore
 *    re-sent the running total. The backend sums that field across
 *    documents, so a counter that grows all session gets added to itself
 *    repeatedly — producing 56,872 "errors" from 879 commands all-time.
 *    Signature: totalCommands === 0 AND terminalErrorCount > 0.
 *
 * 2. SYNTHETIC SEED DATA. Rows written by backend/tools/seed_*.js carry
 *    fabricated command counts. Signature: timestamp lands exactly on a
 *    minute boundary (ms % 60000 === 0); real flushes land on arbitrary
 *    milliseconds.
 *
 * Extension 2.1.0 resets counters every flush (consumeInterval), so data
 * recorded from 2.1.0 onward is a genuine per-interval delta and summing
 * it is correct. This script only cleans what came before.
 *
 * WHAT IT DOES
 * ------------
 * Resets the terminalAnalytics sub-document to zeros on affected rows.
 * It does NOT delete activity documents — coding time, languages, projects
 * and line counts are left untouched, so hours and the leaderboard are
 * unaffected.
 *
 * USAGE
 * -----
 *   node scripts/cleanup-terminal-analytics.js              # dry run (default)
 *   node scripts/cleanup-terminal-analytics.js --apply      # perform the write
 *   node scripts/cleanup-terminal-analytics.js --apply --no-backup
 *
 * A JSON backup of every modified document's original terminalAnalytics is
 * written before any change, unless --no-backup is passed.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const NO_BACKUP = process.argv.includes('--no-backup');

const ZEROED = {
    totalCommands: 0,
    terminalErrorCount: 0,
    successfulCommands: 0,
    failedCommands: 0,
    successRate: 0,
    buildRuns: 0,
    testRuns: 0,
    successfulBuilds: 0,
    failedBuilds: 0,
    buildSuccessRate: 0,
    debuggingSessions: 0,
    commandUsage: { git: 0, npm: 0, node: 0, python: 0, docker: 0, gcc: 0, java: 0, pip: 0, misc: 0 },
    gitActivity: { commits: 0, pushes: 0, pulls: 0, checkouts: 0, merges: 0, clones: 0 },
    repeatedFailedCommands: [],
    lastCommand: 'unknown',
    lastCommandTimestamp: null
};

/** A flush landing exactly on a minute boundary was generated, not recorded. */
function isSynthetic(timestamp) {
    return new Date(timestamp).getTime() % 60000 === 0;
}

(async () => {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI is not set. Copy .env.example to .env first.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
    const Activity = require('../models/Activity');

    const total = await Activity.countDocuments();

    // Candidates: anything carrying terminal numbers we cannot trust.
    const candidates = await Activity.find({
        $or: [
            { 'terminalAnalytics.totalCommands': { $gt: 0 } },
            { 'terminalAnalytics.terminalErrorCount': { $gt: 0 } }
        ]
    }).select('timestamp terminalAnalytics').lean();

    const gaugePolluted = [];
    const synthetic = [];
    const realLooking = [];

    for (const doc of candidates) {
        const ta = doc.terminalAnalytics || {};
        if (isSynthetic(doc.timestamp)) synthetic.push(doc);
        else if ((ta.totalCommands || 0) === 0 && (ta.terminalErrorCount || 0) > 0) gaugePolluted.push(doc);
        else realLooking.push(doc);
    }

    const targets = [...gaugePolluted, ...synthetic];
    const targetIds = targets.map((d) => d._id);

    console.log('\n=== SCOPE ===');
    console.log(`total activity documents        : ${total}`);
    console.log(`carrying terminal numbers       : ${candidates.length}`);
    console.log(`  gauge-polluted (cmds=0,err>0) : ${gaugePolluted.length}  <- will be zeroed`);
    console.log(`  synthetic seed rows           : ${synthetic.length}  <- will be zeroed`);
    console.log(`  real-looking, left untouched  : ${realLooking.length}`);

    if (realLooking.length > 0) {
        console.log('\n  Sample of rows being LEFT ALONE:');
        realLooking.slice(0, 5).forEach((d) =>
            console.log(`    ${new Date(d.timestamp).toISOString()}  cmds=${d.terminalAnalytics.totalCommands} err=${d.terminalAnalytics.terminalErrorCount}`)
        );
    }

    if (targetIds.length === 0) {
        console.log('\nNothing to clean.');
        await mongoose.disconnect();
        return;
    }

    const errSum = targets.reduce((s, d) => s + (d.terminalAnalytics.terminalErrorCount || 0), 0);
    const cmdSum = targets.reduce((s, d) => s + (d.terminalAnalytics.totalCommands || 0), 0);
    console.log(`\nBad totals to be removed: ${errSum} "errors", ${cmdSum} commands`);

    if (!APPLY) {
        console.log('\n=== DRY RUN — nothing was changed. Re-run with --apply to perform the write. ===\n');
        await mongoose.disconnect();
        return;
    }

    if (!NO_BACKUP) {
        const file = path.join(__dirname, `terminal-analytics-backup-${Date.now()}.json`);
        fs.writeFileSync(
            file,
            JSON.stringify(
                targets.map((d) => ({ _id: d._id, timestamp: d.timestamp, terminalAnalytics: d.terminalAnalytics })),
                null,
                1
            )
        );
        console.log(`\nBackup written: ${file}`);
    }

    const result = await Activity.updateMany(
        { _id: { $in: targetIds } },
        { $set: { terminalAnalytics: ZEROED } }
    );
    console.log(`\nUpdated ${result.modifiedCount} document(s).`);

    const [after] = await Activity.aggregate([
        { $group: { _id: null, err: { $sum: '$terminalAnalytics.terminalErrorCount' }, cmds: { $sum: '$terminalAnalytics.totalCommands' } } }
    ]);
    console.log(`Post-cleanup all-time totals: errors=${after?.err ?? 0}, commands=${after?.cmds ?? 0}`);

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
