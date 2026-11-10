const mongoose = require('mongoose');

// A link that lets people join a group. The token is stored only as a hash and shown once.
const groupInviteSchema = new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    maxUses: { type: Number, required: true },
    uses: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

// Expired invites delete themselves.
groupInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('GroupInvite', groupInviteSchema);
