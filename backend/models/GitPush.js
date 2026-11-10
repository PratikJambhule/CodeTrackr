const mongoose = require('mongoose');

/**
 * One push from GitHub's public events feed (D-71): when GitHub recorded it, and the public repo.
 * Hackathon boards need exact times, which daily counts can't give. No code or commit text.
 * Kept 35 days; deleted on unlink.
 */
const gitPushSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    eventId: { type: String, required: true }, // GitHub's id for the event, so a re-read adds nothing twice
    at: { type: Date, required: true },
    repo: { type: String, default: null },
});

gitPushSchema.index({ userId: 1, eventId: 1 }, { unique: true });
gitPushSchema.index({ userId: 1, at: 1 });
gitPushSchema.index({ at: 1 }, { expireAfterSeconds: 35 * 24 * 3600 });

module.exports = mongoose.model('GitPush', gitPushSchema);
