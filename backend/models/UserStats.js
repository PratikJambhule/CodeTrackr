const mongoose = require('mongoose');

/**
 * One row per user: all-time running totals, $inc'ed by ingest on every
 * credited write (services/userStats.js). The leaderboard reads these rows,
 * sorted, instead of aggregating the whole `activities` collection (H-7).
 * `userId` is an ObjectId ref so the leaderboard can populate names.
 */
const userStatsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totalSeconds: { type: Number, default: 0 },
    linesAdded: { type: Number, default: 0 },
    linesRemoved: { type: Number, default: 0 },
    codeChanges: { type: Number, default: 0 },
    commits: { type: Number, default: 0 },
    flushes: { type: Number, default: 0 },
    totalCommands: { type: Number, default: 0 },
    failedCommands: { type: Number, default: 0 },
    buildRuns: { type: Number, default: 0 },
    failedBuilds: { type: Number, default: 0 },
    projects: { type: [String], default: [] },
    lastActiveAt: Date,
}, { timestamps: true });

// The three orderings the leaderboard needs: rank by time, and the field
// maxima its relative scores divide by.
userStatsSchema.index({ totalSeconds: -1 });
userStatsSchema.index({ commits: -1 });
userStatsSchema.index({ codeChanges: -1 });

module.exports = mongoose.models.UserStats || mongoose.model('UserStats', userStatsSchema);
