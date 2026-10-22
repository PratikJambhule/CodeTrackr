const mongoose = require('mongoose');

/**
 * One coding session, saved (ML plan slice 1a, task B7). Sessions are worked out from the 10-minute
 * buckets by services/sessionize.js; this keeps a copy of each session's features and its labels so
 * the work-type model can be trained later without re-deriving old data.
 *
 * Saved nightly for sessions that ended more than 24 h ago (services/sessionSnapshot.js), or right
 * away when the user labels one. Counts and names only, like the buckets.
 */
const sessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationSec: { type: Number, default: 0 },
    writingSec: { type: Number, default: 0 },
    readingSec: { type: Number, default: 0 },
    runningSec: { type: Number, default: 0 },
    projects: [String],
    languages: [String],
    featureVersion: { type: Number },
    features: { type: mongoose.Schema.Types.Mixed },
    // The guess: rules v1 today; a model only once one passes the ship gate on real labels.
    workType: {
        type: { type: String },
        group: { type: String },
        by: { type: String, enum: ['rules', 'model'] },
        probability: { type: Number },
        reason: { type: String },
    },
    // What the user confirmed in the status-bar picker for most of the session (strongest label).
    pickerLabel: { type: { type: String }, group: { type: String }, share: { type: Number } },
    // What the user said on the website. source 'blind' = asked without seeing a guess (the only
    // answers used to MEASURE accuracy); 'shown' = they confirmed or changed a guess they saw.
    userLabel: {
        type: { type: String },
        source: { type: String, enum: ['blind', 'shown'] },
        agreedWithGuess: { type: Boolean },
        at: { type: Date },
    },
    // Fixed per session (hash of user + start): 1 in 5 sessions is asked blind.
    prompt: { type: String, enum: ['blind', 'guess'] },
    snapshotAt: { type: Date },
}, { timestamps: true });

sessionSchema.index({ userId: 1, startAt: 1 }, { unique: true });

module.exports = mongoose.model('Session', sessionSchema);
