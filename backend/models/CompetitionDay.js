const mongoose = require('mongoose');

/**
 * One person's confirmed activity from one site on one India day (D-70). Feeds the group's weekly
 * board. Counts only: no code, titles or commit text. Rows older than a few weeks are removed.
 */
const competitionDaySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['leetcode', 'codeforces', 'github'], required: true },
    username: { type: String, required: true },
    day: { type: String, required: true }, // YYYY-MM-DD, India time
    problems: { type: Number, default: 0 },
    contests: { type: Number, default: 0 },
    pushes: { type: Number, default: 0 },
});

competitionDaySchema.index({ userId: 1, provider: 1, day: 1 }, { unique: true });
competitionDaySchema.index({ userId: 1, day: 1 });

module.exports = mongoose.model('CompetitionDay', competitionDaySchema);
