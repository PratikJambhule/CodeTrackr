#!/usr/bin/env node
/**
 * Read-only probe: what shape is the stored activity actually in?
 *
 * Answers the question the metric formulas depend on — are the analytics
 * sub-documents being populated at all, and from when? Distinguishes "the
 * formula is wrong" from "the data was never collected".
 *
 * READ ONLY.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Activity = require('../models/Activity');

(async () => {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, family: 4, tls: true });

    const total = await Activity.countDocuments({});
    const bucketed = await Activity.countDocuments({ bucketStart: { $exists: true } });
    console.log(`\ntotal activity documents : ${total}`);
    console.log(`bucketed (post 2026-09-08): ${bucketed}`);
    console.log(`legacy per-flush          : ${total - bucketed}`);

    const has = async (field) => Activity.countDocuments({ [field]: { $exists: true, $ne: null } });
    const nonZero = async (field) => Activity.countDocuments({ [field]: { $gt: 0 } });

    console.log(`\nanalytics sub-document presence`);
    for (const f of ['editorAnalytics', 'focusAnalytics', 'gitAnalytics', 'terminalAnalytics']) {
        console.log(`  ${f.padEnd(20)} present in ${await has(f)} docs`);
    }

    console.log(`\nkey leaves with a non-zero value`);
    for (const f of [
        'editorAnalytics.linesInserted', 'editorAnalytics.churnLines',
        'editorAnalytics.readMs', 'editorAnalytics.writeMs', 'editorAnalytics.fileSwitches',
        'focusAnalytics.focusedMs', 'focusAnalytics.longestBlockMs',
        'gitAnalytics.commits', 'terminalAnalytics.totalCommands',
    ]) {
        console.log(`  ${f.padEnd(36)} ${await nonZero(f)} docs`);
    }

    const withBlocks = await Activity.countDocuments({ 'focusAnalytics.flowBlocksMs.0': { $exists: true } });
    console.log(`  ${'focusAnalytics.flowBlocksMs (non-empty)'.padEnd(36)} ${withBlocks} docs`);

    // When did each signal first and last appear?
    console.log(`\nfirst / last document carrying each signal`);
    for (const f of ['focusAnalytics.focusedMs', 'editorAnalytics.linesInserted', 'terminalAnalytics.totalCommands']) {
        const first = await Activity.findOne({ [f]: { $gt: 0 } }).sort({ timestamp: 1 }).select('timestamp').lean();
        const last = await Activity.findOne({ [f]: { $gt: 0 } }).sort({ timestamp: -1 }).select('timestamp').lean();
        console.log(`  ${f.padEnd(32)} ${first ? first.timestamp.toISOString().slice(0, 10) : '—'} .. ${last ? last.timestamp.toISOString().slice(0, 10) : '—'}`);
    }

    const newest = await Activity.findOne({}).sort({ timestamp: -1 }).lean();
    console.log(`\nnewest document: ${newest ? newest.timestamp.toISOString() : '—'}`);
    if (newest) {
        console.log('  sample shape:', JSON.stringify({
            bucketStart: newest.bucketStart, duration: newest.duration,
            flushCount: newest.flushCount, language: newest.language,
            editorAnalytics: newest.editorAnalytics, focusAnalytics: newest.focusAnalytics,
        }, null, 2).slice(0, 900));
    }

    await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
