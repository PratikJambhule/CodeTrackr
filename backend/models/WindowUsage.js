const mongoose = require('mongoose');

/**
 * Seconds CLAIMED by one user in one 10-minute window, across all projects
 * and languages (roadmap item 5 / H-21). Ingest $incs this atomically and
 * credits only what still fits under 600 s (services/ingestCredit.js). Rows
 * expire 2 days after their window: ingest refuses timestamps older than
 * 24 h, so an expired window can never be written to again.
 */
const windowUsageSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    bucketStart: { type: Date, required: true },
    seconds: { type: Number, default: 0 },
});

windowUsageSchema.index({ userId: 1, bucketStart: 1 }, { unique: true });
windowUsageSchema.index({ bucketStart: 1 }, { expireAfterSeconds: 60 * 60 * 48 });

module.exports = mongoose.models.WindowUsage || mongoose.model('WindowUsage', windowUsageSchema);
