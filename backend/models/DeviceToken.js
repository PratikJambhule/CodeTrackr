const mongoose = require('mongoose');

/**
 * A per-device extension key issued by the device sign-in (roadmap item 13).
 * Same ct_<keyId>_<secret> format and hashing as the profile key
 * (services/apiKeys.js), but one per device, so a lost laptop's key can be
 * revoked without touching the others, and each expires after a year.
 */
const deviceTokenSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    keyId: { type: String, required: true, unique: true },
    hash: { type: String, required: true, select: false },
    last4: String,
    clientName: { type: String, default: 'VS Code' },
    scope: { type: [String], default: ['ingest'] },
    lastUsedAt: Date,
    expiresAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);
