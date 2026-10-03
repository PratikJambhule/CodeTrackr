const mongoose = require('mongoose');

/**
 * One row per accepted extension upload that carried a `flushId` (roadmap
 * item 4). The unique (userId, flushId) index is what makes a resend a no-op:
 * the second insert fails with a duplicate-key error and the upload is not
 * applied again. Rows expire after 48 h, which is longer than the 24 h window
 * in which ingest accepts a timestamp at all, so any upload old enough to
 * have lost its receipt is rejected by validation anyway.
 */
const ingestReceiptSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    flushId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 48 },
});

ingestReceiptSchema.index({ userId: 1, flushId: 1 }, { unique: true });

module.exports = mongoose.models.IngestReceipt || mongoose.model('IngestReceipt', ingestReceiptSchema);
