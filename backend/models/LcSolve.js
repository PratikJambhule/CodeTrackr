const mongoose = require('mongoose');

/**
 * One LeetCode problem a person solved (first accepted submission we saw). LeetCode shows only the
 * last ~20 accepted problems by username, so the nightly sync stores each new one and the history
 * grows from the day the account is linked. Training data for "what to practise next" (D-59).
 */
const lcSolveSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    titleSlug: { type: String, required: true },
    title: String,
    solvedAt: { type: Date, required: true },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard', null], default: null },
    topics: { type: [String], default: [] },
});

lcSolveSchema.index({ userId: 1, titleSlug: 1 }, { unique: true });
lcSolveSchema.index({ userId: 1, solvedAt: -1 });

module.exports = mongoose.models.LcSolve || mongoose.model('LcSolve', lcSolveSchema);
