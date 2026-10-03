const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const IngestReceipt = require('../models/IngestReceipt');
const WindowUsage = require('../models/WindowUsage');
const UserStats = require('../models/UserStats');
const { buildStatsUpdate } = require('../services/userStats');
const { activityUserId } = require('../services/activityUser');
const { spreadAcrossWindows, corroboratedSeconds, creditFromCounter } = require('../services/ingestCredit');
const { verifyApiKey } = require('../middleware/auth');
const {
    normalizeEditorAnalytics,
    normalizeFocusAnalytics,
    normalizeGitAnalytics
} = require('../services/activityNormalizers');
const {
    planActivityWrite,
    hasSignal,
    bucketStartFor
} = require('../services/activityBucket');
const { validateIngestPayload } = require('../services/ingestValidation');
const rateLimit = require('express-rate-limit');
const { hashSecret } = require('../services/apiKeys');

// Per-key ingest quota (roadmap item 5). The app-level /api/extension limiter is
// per IP, which a script on one machine shares with nobody and a campus shares
// with everybody (H-20). This one follows the credential. A healthy extension
// uploads about once every two minutes; 60 a minute leaves room for draining
// a queue after being offline. The key is hashed so it never sits in memory
// as a map key in clear.
const keyQuota = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    skip: () => process.env.NODE_ENV === 'test',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `key:${hashSecret(String(req.headers['x-api-key'] || ''))}`,
});
const MAX_BATCH = 100;

// Default: merge flushes into 10-minute buckets. Set ACTIVITY_BUCKET_MS=0 to
// fall back to one document per flush (Activity.create), byte-for-byte as before.
const ACTIVITY_BUCKET_MS = Number(
    process.env.ACTIVITY_BUCKET_MS !== undefined ? process.env.ACTIVITY_BUCKET_MS : 600000
);

/**
 * Apply a flush at most once (roadmap item 4). With a `flushId`, a receipt is
 * inserted first; a duplicate-key error means this exact upload was already
 * applied (the client retried after a timeout, or a replay), so it is skipped.
 * If applying fails after the receipt was written, the receipt is removed so
 * the client's retry is not wrongly treated as a duplicate. Without a flushId
 * (extensions before 2.5.0) the flush is applied as before.
 */
async function persistOnce(normalized, when, flushId) {
    if (flushId) {
        try {
            await IngestReceipt.create({ userId: normalized.userId, flushId });
        } catch (err) {
            if (err && err.code === 11000) {
                return { status: 200, body: { success: true, duplicate: true } };
            }
            throw err;
        }
    }
    try {
        return await persistFlush(normalized, when);
    } catch (err) {
        if (flushId) {
            await IngestReceipt.deleteOne({ userId: normalized.userId, flushId }).catch(() => {});
        }
        throw err;
    }
}

/** Atomic upsert into a bucket; retries without the insert on a duplicate-key race. */
async function upsertBucket(filter, update, setOnInsert) {
    try {
        return await Activity.findOneAndUpdate(filter, { ...update, $setOnInsert: setOnInsert }, {
            upsert: true, new: true, setDefaultsOnInsert: false
        });
    } catch (err) {
        if (err && err.code === 11000) {
            return Activity.findOneAndUpdate(filter, update, { new: true });
        }
        throw err;
    }
}

/**
 * Claim `seconds` in the user's window counter and return how many are
 * credited (what still fits under 600 s). Atomic, so concurrent uploads
 * cannot both fill one window.
 */
async function claimWindow(userId, bucketStart, seconds) {
    if (seconds <= 0) return 0;
    const filter = { userId, bucketStart };
    let usage;
    try {
        usage = await WindowUsage.findOneAndUpdate(filter, { $inc: { seconds } }, { upsert: true, new: true });
    } catch (err) {
        if (!(err && err.code === 11000)) throw err;
        usage = await WindowUsage.findOneAndUpdate(filter, { $inc: { seconds } }, { new: true });
    }
    return creditFromCounter(seconds, usage.seconds);
}

/** Keep the user's leaderboard running totals current (roadmap item 6). */
async function bumpStats(normalized, credited, when, opts) {
    await UserStats.updateOne({ userId: normalized.userId }, buildStatsUpdate(normalized, credited, when, opts), { upsert: true });
}

/**
 * Persist one already-normalised flush. Returns { status, body }.
 * Shared by /track and /track/batch.
 *
 * Bucket mode credits time through the anti-cheat limits (services/ingestCredit.js):
 * corroborated by focus time, capped at 600 s per user per 10-minute window, and
 * spread across the windows a long upload covers. `duration` stores the CREDITED
 * seconds (what leaderboards rank on); `claimedDuration` keeps what the client
 * sent, so an inflated claim stays visible.
 */
async function persistFlush(normalized, when) {
    if (!ACTIVITY_BUCKET_MS) {
        const activity = await Activity.create({ ...normalized, timestamp: when });
        await bumpStats(normalized, normalized.duration, when);
        return {
            status: 201,
            body: {
                success: true,
                message: 'Activity tracked successfully',
                activity: {
                    id: activity._id,
                    fileName: activity.fileName,
                    language: activity.language,
                    duration: activity.duration,
                    timestamp: activity.timestamp
                }
            }
        };
    }

    const { userId, projectName, language } = normalized;
    const claimed = Number(normalized.duration) || 0;
    const slices = spreadAcrossWindows(when.getTime(),
        corroboratedSeconds(claimed, normalized.focusAnalytics), Date.now(), ACTIVITY_BUCKET_MS);
    const firstStart = slices.length ? slices[0].bucketStart : bucketStartFor(when, ACTIVITY_BUCKET_MS);

    const credits = [];
    for (const slice of slices) {
        credits.push(await claimWindow(userId, slice.bucketStart, slice.seconds));
    }

    // The first window carries every counter (edits, commands, focus...); the
    // later windows of a spread upload receive time only.
    const plan = planActivityWrite({ ...normalized, duration: credits[0] || 0 }, firstStart, ACTIVITY_BUCKET_MS);
    const extraWindows = slices.slice(1).map((slice, i) => ({ slice, credit: credits[i + 1] }))
        .filter((w) => w.credit > 0);

    if (plan.mode === 'merge') {
        // Signal-less flush: only tops up buckets that already exist. Give the
        // window credit back when there was nothing to top up.
        const targets = [{ bucketStart: firstStart, credit: credits[0] || 0 }]
            .concat(extraWindows.map((w) => ({ bucketStart: w.slice.bucketStart, credit: w.credit })));
        let merged = false;
        let topUp = 0;
        for (const t of targets) {
            const r = await Activity.updateOne(
                { userId, projectName, language, bucketStart: t.bucketStart },
                { $inc: { duration: t.credit, flushCount: t.bucketStart === firstStart ? 1 : 0 } },
                { upsert: false });
            if (r.matchedCount > 0) { merged = true; topUp += t.credit; }
            else if (t.credit > 0) {
                await WindowUsage.updateOne({ userId, bucketStart: t.bucketStart }, { $inc: { seconds: -t.credit } });
            }
        }
        if (topUp > 0) await bumpStats(normalized, topUp, when, { timeOnly: true });
        return { status: 202, body: { success: true, merged } };
    }

    plan.update.$inc.claimedDuration = claimed;
    const doc = await upsertBucket(plan.filter, plan.update, plan.setOnInsert);
    for (const { slice, credit } of extraWindows) {
        await upsertBucket(
            { userId, projectName, language, bucketStart: slice.bucketStart },
            { $inc: { duration: credit } },
            // flushCount 0: this document holds spread time, not an upload. Without
            // it, readers that default a missing flushCount to 1 over-count uploads.
            { ...plan.setOnInsert, bucketStart: slice.bucketStart, timestamp: slice.bucketStart, flushCount: 0 });
    }

    const credited = credits.reduce((a, c) => a + c, 0);
    await bumpStats(normalized, credited, when);
    return {
        status: 201,
        body: {
            success: true,
            message: 'Activity bucketed',
            bucket: {
                id: doc._id,
                bucketStart: plan.bucketStart,
                duration: doc.duration,
                flushCount: doc.flushCount
            },
            credited,
            claimed
        }
    };
}

function normalizeTerminalAnalytics(body) {
    const source = body?.terminalAnalytics || body?.analysis || body || {};
    const commandUsage = source.commandUsage || {};
    const gitActivity = source.gitActivity || {};

    return {
        totalCommands: Number(source.totalCommands) || 0,
        terminalErrorCount: Number(source.terminalErrorCount) || 0,
        successfulCommands: Number(source.successfulCommands) || 0,
        failedCommands: Number(source.failedCommands) || 0,
        successRate: Number(source.successRate) || 0,
        buildRuns: Number(source.buildRuns) || 0,
        testRuns: Number(source.testRuns) || 0,
        successfulBuilds: Number(source.successfulBuilds) || 0,
        failedBuilds: Number(source.failedBuilds) || 0,
        buildSuccessRate: Number(source.buildSuccessRate) || 0,
        debuggingSessions: Number(source.debuggingSessions) || 0,
        commandUsage: {
            git: Number(commandUsage.git) || 0,
            npm: Number(commandUsage.npm) || 0,
            node: Number(commandUsage.node) || 0,
            python: Number(commandUsage.python) || 0,
            docker: Number(commandUsage.docker) || 0,
            gcc: Number(commandUsage.gcc) || 0,
            java: Number(commandUsage.java) || 0,
            pip: Number(commandUsage.pip) || 0,
            misc: Number(commandUsage.misc) || 0
        },
        gitActivity: {
            commits: Number(gitActivity.commits) || 0,
            pushes: Number(gitActivity.pushes) || 0,
            pulls: Number(gitActivity.pulls) || 0,
            checkouts: Number(gitActivity.checkouts) || 0,
            merges: Number(gitActivity.merges) || 0,
            clones: Number(gitActivity.clones) || 0
        },
        repeatedFailedCommands: Array.isArray(source.repeatedFailedCommands)
            ? source.repeatedFailedCommands.map(entry => ({
                command: entry?.command || "",
                count: Number(entry?.count) || 0
            }))
            : [],
        lastCommand: source.lastCommand || source.lastTerminalCommand || 'unknown',
        lastCommandTimestamp: source.lastCommandTimestamp
            ? new Date(source.lastCommandTimestamp)
            : null
    };
}

// POST endpoint for VS Code extension to send coding activity
router.post('/track', keyQuota, verifyApiKey, async (req, res, next) => {
    try {
        const {
            fileName,
            fileType,
            projectName,
            language,
            duration,
            linesAdded,
            linesRemoved,
            timestamp,
            terminalAnalytics,
            analysis
        } = req.body;

        const terminalPayload = normalizeTerminalAnalytics({
            terminalAnalytics,
            analysis,
            ...req.body
        });

        // Bounds-check the payload: duration in (0, 3600], string length caps,
        // timestamp within [now-24h, now+60s]. Replaces the old truthiness check
        // that accepted `duration: 1e12`, negatives and a far-backdated timestamp.
        const v = validateIngestPayload(req.body);
        if (!v.ok) {
            return res.status(400).json({
                success: false,
                message: 'Invalid activity payload',
                details: v.errors
            });
        }

        // The flush covers an interval that started `duration` seconds ago; the
        // extension stamps `timestamp` with that start so backdated/queued
        // activity is filed under the day it actually happened.
        const parsedTimestamp = timestamp ? new Date(timestamp) : new Date();
        const when = isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp;

        const normalized = {
            userId: activityUserId(req.user._id),
            fileName,
            fileType: fileType || 'unknown',
            projectName: projectName || 'Unknown Project',
            language,
            duration: Number(duration),
            linesAdded: Number(linesAdded) || 0,
            linesRemoved: Number(linesRemoved) || 0,
            terminalAnalytics: terminalPayload,
            editorAnalytics: normalizeEditorAnalytics(req.body),
            focusAnalytics: normalizeFocusAnalytics(req.body),
            gitAnalytics: normalizeGitAnalytics(req.body)
        };

        const { status, body } = await persistOnce(normalized, when, v.value.flushId);
        res.status(status).json(body);
    } catch (error) {
        return next(error);
    }
});

// POST endpoint for batch activity tracking (multiple activities at once)
router.post('/track/batch', keyQuota, verifyApiKey, async (req, res, next) => {
    try {
        const { activities } = req.body;

        if (!Array.isArray(activities) || activities.length === 0 || activities.length > MAX_BATCH) {
            return res.status(400).json({
                success: false,
                message: `activities must be an array of 1..${MAX_BATCH} items`
            });
        }

        // Same bounds check as /track, per element. The batch is all-or-nothing.
        for (let i = 0; i < activities.length; i++) {
            const v = validateIngestPayload(activities[i]);
            if (!v.ok) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid activity at index ${i}`,
                    details: v.errors
                });
            }
        }

        // Persist each activity through the same bucketing path as /track.
        // (The shipped extension never calls this endpoint — a simple loop
        // stays obviously correct.)
        let processed = 0;
        for (const activity of activities) {
            const parsed = activity.timestamp ? new Date(activity.timestamp) : new Date();
            const when = isNaN(parsed.getTime()) ? new Date() : parsed;
            const normalized = {
                userId: activityUserId(req.user._id),
                fileName: activity.fileName,
                fileType: activity.fileType || 'unknown',
                projectName: activity.projectName || 'Unknown Project',
                language: activity.language,
                duration: Number(activity.duration),
                linesAdded: Number(activity.linesAdded) || 0,
                linesRemoved: Number(activity.linesRemoved) || 0,
                terminalAnalytics: normalizeTerminalAnalytics(activity),
                editorAnalytics: normalizeEditorAnalytics(activity),
                focusAnalytics: normalizeFocusAnalytics(activity),
                gitAnalytics: normalizeGitAnalytics(activity)
            };
            const r = await persistOnce(normalized, when, activity.flushId || null);
            if (!r.body.duplicate) processed += 1;
        }

        res.status(201).json({
            success: true,
            message: `${processed} activities processed successfully`,
            count: processed
        });
    } catch (error) {
        return next(error);
    }
});

// GET endpoint to verify API key (for extension setup)
router.get('/verify', verifyApiKey, async (req, res, next) => {
    res.json({
        success: true,
        message: 'API key is valid',
        user: {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email
        }
    });
});

module.exports = router;
module.exports.planActivityWrite = planActivityWrite;
module.exports.hasSignal = hasSignal;
module.exports.bucketStartFor = bucketStartFor;
