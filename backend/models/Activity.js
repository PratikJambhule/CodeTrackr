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
    // Mixed during the String -> ObjectId migration (roadmap item 10): new
    // writes store an ObjectId, legacy documents hold the hex string, and
    // services/activityUser.js matches both. Mixed stops Mongoose casting one
    // form into the other. Becomes ObjectId once the migration has run.
    userId: {
        type: mongoose.Schema.Types.Mixed,
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
        // Counts per kind of command (extension 2.6.0+). Older uploads have none.
        commandKinds: {
            install: Number,
            run: Number,
            compile: Number,
            build: Number,
            test: Number,
            git: Number,
            docker: Number,
            other: Number,
            failed: {
                install: Number,
                run: Number,
                compile: Number,
                build: Number,
                test: Number,
                git: Number,
                docker: Number,
                other: Number,
            }
        },
        // `command` holds a KIND ("compile", "test"…), never command text: ingest reduces any
        // text to its kind (services/commandKinds.js). The field name is kept for the website.
        repeatedFailedCommands: [{
            command: String,
            count: Number
        }],
        lastCommand: String, // a kind, or 'unknown'
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
    flushCount: { type: Number, default: 1 },
    // Seconds the client CLAIMED for uploads in this bucket, before the anti-cheat
    // limits (focus corroboration, 600 s window cap). `duration` holds what was
    // credited. A large gap between the two is the signal of an inflated client.
    claimedDuration: { type: Number },
    // Payload v3 (extension 2.6.0): the credited duration split by kind, and per file. Older
    // uploads have none of these. fileTime keys are file base names with "." "$" "%" escaped
    // (services/timeParts.js encodeFileKey): { seconds, writing, reading, running,
    // linesInserted, linesDeleted, language }.
    writingSec: { type: Number },
    readingSec: { type: Number },
    runningSec: { type: Number },
    fileTime: { type: mongoose.Schema.Types.Mixed },
    // Payload v3 signals (extension 2.6.0): counts and yes/no flags only, never names or paths.
    // runs: programs started without the debugger; debug: real debugging only.
    runs: {
        terminal: { type: Number }, task: { type: Number },
        debugNoDebug: { type: Number }, codeRunner: { type: Number },
    },
    debug: { sessions: { type: Number }, breakpointStops: { type: Number }, steps: { type: Number } },
    reading: { scrollEvents: { type: Number }, navigations: { type: Number }, filesOpenedNotEdited: { type: Number } },
    filesCreated: { type: Number },
    filesDeleted: { type: Number },
    // Plan B4: what the user said they were doing. userMode = the latest answer; modeSec = seconds
    // CONFIRMED per mode (picked or confirmed in that coding session). Labels come from modeSec.
    userMode: { mode: { type: String }, confirmed: { type: Boolean } },
    modeSec: {
        dsa: { type: Number }, project: { type: Number }, debugging: { type: Number },
        learning: { type: Number }, setup: { type: Number },
    },
    // The project's kind, latest upload wins. sourceFilesBucket is a size range, never a list.
    workspace: {
        sourceFilesBucket: { type: String },
        hasPackageJson: { type: Boolean }, hasRequirements: { type: Boolean }, hasGit: { type: Boolean },
        ownCommits: { type: Boolean }, clonedRecently: { type: Boolean },
    },
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
