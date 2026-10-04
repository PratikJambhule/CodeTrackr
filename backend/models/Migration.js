const mongoose = require('mongoose');

/**
 * One row per one-off data job that has finished, keyed by name
 * (e.g. 'userstats-backfill'). Code that depends on a job's result checks for
 * its row instead of guessing from the data (D-39).
 */
const migrationSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    completedAt: { type: Date, required: true },
    details: { type: Object, default: {} },
}, { versionKey: false });

module.exports = mongoose.models.Migration || mongoose.model('Migration', migrationSchema);
