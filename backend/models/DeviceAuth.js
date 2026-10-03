const mongoose = require('mongoose');

/**
 * A pending device sign-in (roadmap item 13). Created when the extension asks
 * for a code, approved by the signed-in user on the /device page, consumed
 * (deleted) when the extension collects its key. Expires on its own after 10
 * minutes. Only a SHA-256 of the device code is stored: the device code is the
 * extension's secret for collecting the key.
 */
const deviceAuthSchema = new mongoose.Schema({
    deviceCodeHash: { type: String, required: true, unique: true },
    userCode: { type: String, required: true, unique: true },
    clientName: { type: String, default: 'VS Code' },
    status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
});

deviceAuthSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.DeviceAuth || mongoose.model('DeviceAuth', deviceAuthSchema);
