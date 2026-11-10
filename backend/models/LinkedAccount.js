const mongoose = require('mongoose');

/**
 * A LeetCode (D-59) or Codeforces (D-60) username a person linked on their profile. We read only public data
 * by username; nothing here is a credential. `summary` holds the latest counts from the nightly
 * sync (services/linkedSync.js), so the profile card is one read.
 *
 * Linked numbers are shown only to their owner until the account is VERIFIED (D-62): the person
 * puts `verifyCode` in their public profile and we read it back. Only verified accounts appear on
 * group boards and the leaderboard, so nobody can borrow someone else's profile.
 */
const linkedAccountSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['leetcode', 'codeforces', 'github'], required: true },
    username: { type: String, required: true },
    linkedAt: { type: Date, default: Date.now },
    lastSyncAt: Date,
    lastError: String,
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    verifyCode: String,
    verifiedAt: Date,
});

linkedAccountSchema.index({ userId: 1, provider: 1 }, { unique: true });
linkedAccountSchema.index({ verifiedAt: 1 });

module.exports = mongoose.models.LinkedAccount || mongoose.model('LinkedAccount', linkedAccountSchema);
