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
