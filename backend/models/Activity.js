const mongoose = require('mongoose');

/**
 * Activity documents are written by the extension ingest route.
 *
 * Since 2026-09-08 the default write path merges flushes into one document per
 * 10-minute (userId, projectName, language) window via an atomic $inc upsert
 * (see services/activityBucket.js, routes/extension.js). Legacy per-flush
 * documents coexist. `ACTIVITY_BUCKET_MS=0` restores per-flush inserts.
 *
 * The analytics sub-documents are deliberately WITHOUT `default: 0` so an empty
 * one is never persisted — the ingest route only $incs the non-zero leaves.
 * Every read path already treats a missing sub-document / leaf as zero.
 */
const activitySchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileType: String,
    projectName: String,
    language: String,
    duration: Number,
    linesAdded: {
        type: Number,
        default: 0
    },
    linesRemoved: {
        type: Number,
        default: 0
    },
    terminalAnalytics: {
        totalCommands: Number,
        terminalErrorCount: Number,
        successfulCommands: Number,
        failedCommands: Number,
        successRate: Number,
        buildRuns: Number,
        testRuns: Number,
        successfulBuilds: Number,
        failedBuilds: Number,
        buildSuccessRate: Number,
        debuggingSessions: Number,
        commandUsage: {
            git: Number,
            npm: Number,
            node: Number,
            python: Number,
            docker: Number,
            gcc: Number,
            java: Number,
            pip: Number,
            misc: Number
        },
        gitActivity: {
            commits: Number,
            pushes: Number,
            pulls: Number,
            checkouts: Number,
            merges: Number,
            clones: Number
        },
        repeatedFailedCommands: [{
            command: String,
            count: Number
        }],
        lastCommand: String,
        lastCommandTimestamp: Date
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    editorAnalytics: {
        charsInserted: Number,
        charsDeleted: Number,
        linesInserted: Number,
        linesDeleted: Number,
        churnLines: Number,
        undoCount: Number,
        redoCount: Number,
        saveCount: Number,
        fileSwitches: Number,
        uniqueFiles: Number,
        readMs: Number,
        writeMs: Number,
        largeInsertCount: Number,
        largeInsertChars: Number
    },
    focusAnalytics: {
        focusedMs: Number,
        blurredMs: Number,
        blurEvents: Number,
        flowBlocksMs: [Number],
        longestBlockMs: Number
    },
    gitAnalytics: {
        commits: Number,
        filesChanged: Number,
        uncommittedFiles: Number,
        uncommittedAgeMs: Number
    },
    // Bucketing fields. Present only on bucketed docs; legacy per-flush docs
    // have none of these.
    bucketStart: { type: Date },
    files: { type: [String] },
    flushCount: { type: Number, default: 1 }
}, { timestamps: true });

// The range queries every read path actually does filter on `timestamp`.
activitySchema.index({ userId: 1, timestamp: -1 });
activitySchema.index({ userId: 1, projectName: 1 });
activitySchema.index({ userId: 1, language: 1 });
// Race-safe bucket merge. Partial so the millions of legacy per-flush docs
// (which have no bucketStart) are not subject to the uniqueness constraint.
activitySchema.index(
    { userId: 1, projectName: 1, language: 1, bucketStart: 1 },
    { unique: true, partialFilterExpression: { bucketStart: { $exists: true } } }
);
// Safety net so the collection cannot grow forever. 400 days > the longest
// read window (metrics ?days=365). Tightening this + repointing the all-time
// reads at DailySummary is the documented follow-up (bundled with UserStats).
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
