const mongoose = require('mongoose');

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
        totalCommands: { type: Number, default: 0 },
        terminalErrorCount: { type: Number, default: 0 },
        successfulCommands: { type: Number, default: 0 },
        failedCommands: { type: Number, default: 0 },
        successRate: { type: Number, default: 0 },
        buildRuns: { type: Number, default: 0 },
        testRuns: { type: Number, default: 0 },
        successfulBuilds: { type: Number, default: 0 },
        failedBuilds: { type: Number, default: 0 },
        buildSuccessRate: { type: Number, default: 0 },
        debuggingSessions: { type: Number, default: 0 },
        commandUsage: {
            git: { type: Number, default: 0 },
            npm: { type: Number, default: 0 },
            node: { type: Number, default: 0 },
            python: { type: Number, default: 0 },
            docker: { type: Number, default: 0 },
            gcc: { type: Number, default: 0 },
            java: { type: Number, default: 0 },
            pip: { type: Number, default: 0 },
            misc: { type: Number, default: 0 }
        },
        gitActivity: {
            commits: { type: Number, default: 0 },
            pushes: { type: Number, default: 0 },
            pulls: { type: Number, default: 0 },
            checkouts: { type: Number, default: 0 },
            merges: { type: Number, default: 0 },
            clones: { type: Number, default: 0 }
        },
        repeatedFailedCommands: [{
            command: { type: String, default: "" },
            count: { type: Number, default: 0 }
        }],
        lastCommand: { type: String, default: "unknown" },
        lastCommandTimestamp: { type: Date, default: null }
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    date: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Index for efficient queries
activitySchema.index({ userId: 1, date: -1 });
activitySchema.index({ userId: 1, projectName: 1 });
activitySchema.index({ userId: 1, language: 1 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
