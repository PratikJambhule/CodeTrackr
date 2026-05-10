const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const { verifyApiKey } = require('../middleware/auth');

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
router.post('/track', verifyApiKey, async (req, res) => {
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

        // Create new activity record
        const activity = await Activity.create({
            userId: req.user._id.toString(),
            fileName,
            fileType: fileType || 'unknown',
            projectName: projectName || 'Unknown Project',
            language,
            duration: Number(duration),
            linesAdded: Number(linesAdded) || 0,
            linesRemoved: Number(linesRemoved) || 0,
            terminalAnalytics: terminalPayload,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
            date: new Date().toISOString().split('T')[0]
        });

        res.status(201).json({
            success: true,
            message: 'Activity tracked successfully',
            activity: {
                id: activity._id,
                fileName: activity.fileName,
                language: activity.language,
                duration: activity.duration,
                timestamp: activity.timestamp
            }
        });
    } catch (error) {
        console.error('Track activity error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to track activity',
            error: error.message
        });
    }
});

// POST endpoint for batch activity tracking (multiple activities at once)
router.post('/track/batch', verifyApiKey, async (req, res) => {
    try {
        const { activities } = req.body;

        if (!Array.isArray(activities) || activities.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'activities must be a non-empty array'
            });
        }

        // Validate and prepare activities
        const preparedActivities = activities.map(activity => ({
            userId: req.user._id,
            fileName: activity.fileName,
            fileType: activity.fileType || 'unknown',
            projectName: activity.projectName || 'Unknown Project',
            language: activity.language,
            duration: Number(activity.duration),
            linesAdded: Number(activity.linesAdded) || 0,
            linesRemoved: Number(activity.linesRemoved) || 0,
            terminalAnalytics: normalizeTerminalAnalytics(activity),
            timestamp: activity.timestamp ? new Date(activity.timestamp) : new Date(),
            date: new Date().toISOString().split('T')[0]
        }));

        // Insert all activities
        const insertedActivities = await Activity.insertMany(preparedActivities);

        res.status(201).json({
            success: true,
            message: `${insertedActivities.length} activities tracked successfully`,
            count: insertedActivities.length
        });
    } catch (error) {
        console.error('Batch track activity error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to track activities',
            error: error.message
        });
    }
});

// GET endpoint to verify API key (for extension setup)
router.get('/verify', verifyApiKey, async (req, res) => {
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
