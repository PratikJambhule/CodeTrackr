const mongoose = require('mongoose');

/**
 * One document per (userId, UTC day), produced by services/dailyRollup.js from
 * raw `activities`. Recent data is still served from raw; this exists so the
 * all-time reads (leaderboard, /summary, metrics beyond 90 days) can be
 * repointed here once the raw TTL is tightened — the documented follow-up.
 */
const dailySummarySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    day: { type: String, required: true }, // 'YYYY-MM-DD', UTC
    totalSeconds: { type: Number, default: 0 },
    totalLinesAdded: { type: Number, default: 0 },
    totalLinesRemoved: { type: Number, default: 0 },
    flushCount: { type: Number, default: 0 },
    bucketCount: { type: Number, default: 0 },
    languages: [{ language: String, seconds: Number, _id: false }],
    projects: [String],
    editor: { type: Object, default: {} },
    terminal: { type: Object, default: {} },
    git: { type: Object, default: {} },
    focus: {
        focusedMs: { type: Number, default: 0 },
        blurredMs: { type: Number, default: 0 },
        longestBlockMs: { type: Number, default: 0 },
        deepBlockCount: { type: Number, default: 0 },
        blockCount: { type: Number, default: 0 },
    },
    rolledAt: { type: Date, default: Date.now },
}, { timestamps: true });

dailySummarySchema.index({ userId: 1, day: 1 }, { unique: true });

module.exports = mongoose.models.DailySummary || mongoose.model('DailySummary', dailySummarySchema);
