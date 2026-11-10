const mongoose = require('mongoose');

const YEAR_SECONDS = 365 * 24 * 60 * 60;

// What admins did in a group: who changed what, and when. Kept for one year.
const groupAuditLogSchema = new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    detail: { type: String, default: null },
    at: { type: Date, default: Date.now }
});

groupAuditLogSchema.index({ groupId: 1, at: -1, _id: -1 });
groupAuditLogSchema.index({ at: 1 }, { expireAfterSeconds: YEAR_SECONDS });

module.exports = mongoose.model('GroupAuditLog', groupAuditLogSchema);
