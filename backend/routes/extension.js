const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
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

// Default: merge flushes into 10-minute buckets. Set ACTIVITY_BUCKET_MS=0 to
// fall back to one document per flush (Activity.create), byte-for-byte as before.
const ACTIVITY_BUCKET_MS = Number(
    process.env.ACTIVITY_BUCKET_MS !== undefined ? process.env.ACTIVITY_BUCKET_MS : 600000
);

/**
 * Persist one already-normalised flush. Returns { status, body }.
 * Shared by /track and /track/batch.
 */
async function persistFlush(normalized, when) {
    const plan = planActivityWrite(normalized, when, ACTIVITY_BUCKET_MS);

    if (plan.mode === 'legacy') {
        const activity = await Activity.create({ ...normalized, timestamp: when });
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

    if (plan.mode === 'merge') {
        const r = await Activity.updateOne(plan.filter, { $inc: plan.inc }, { upsert: false });
        return { status: 202, body: { success: true, merged: r.matchedCount > 0 } };
    }

    // plan.mode === 'bucket'
    const withInsert = { ...plan.update, $setOnInsert: plan.setOnInsert };
    let doc;
    try {
        doc = await Activity.findOneAndUpdate(plan.filter, withInsert, {
            upsert: true, new: true, setDefaultsOnInsert: false
        });
    } catch (err) {
        if (err && err.code === 11000) {
            doc = await Activity.findOneAndUpdate(plan.filter, plan.update, { new: true });
        } else {
            throw err;
        }
    }
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
            }
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
router.post('/track', verifyApiKey, async (req, res, next) => {
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

        // Validate required fields
        if (!fileName || !language || !duration) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: fileName, language, and duration are required'
            });
        }

        // The flush covers an interval that started `duration` seconds ago; the
        // extension stamps `timestamp` with that start so backdated/queued
        // activity is filed under the day it actually happened.
        const parsedTimestamp = timestamp ? new Date(timestamp) : new Date();
        const when = isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp;

        const normalized = {
            userId: req.user._id.toString(),
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

        const { status, body } = await persistFlush(normalized, when);
        res.status(status).json(body);
    } catch (error) {
        return next(error);
    }
});

// POST endpoint for batch activity tracking (multiple activities at once)
router.post('/track/batch', verifyApiKey, async (req, res, next) => {
    try {
        const { activities } = req.body;

        if (!Array.isArray(activities) || activities.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'activities must be a non-empty array'
            });
        }

        // Persist each activity through the same bucketing path as /track.
        // (The shipped extension never calls this endpoint — a simple loop
        // stays obviously correct.)
        let processed = 0;
        for (const activity of activities) {
            const parsed = activity.timestamp ? new Date(activity.timestamp) : new Date();
            const when = isNaN(parsed.getTime()) ? new Date() : parsed;
            const normalized = {
                userId: req.user._id.toString(),
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
            await persistFlush(normalized, when);
            processed += 1;
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
