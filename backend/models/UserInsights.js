const mongoose = require('mongoose');

/**
 * One document per user holding their 90-day metric baselines.
 *
 * A metric on its own ("deep work 40%") is uninterpretable — the useful signal
 * is "40%, down from your usual 55%". Recomputing a 90-day baseline on every
 * page load would repeat the mistake M-1 already represents, so it is cached
 * here and refreshed lazily, at most once a day, on read.
 *
 * Deliberately NOT driven by a cron job: the cache is self-healing (a stale or
 * missing document is recomputed by the next request), so there is nothing to
 * schedule and nothing to backfill. The nightly `dailysummaries` rollup exists
 * for a different purpose and is not required by this.
 */
const userInsightsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },

    /** Metric name -> the user's own 90-day value. Sparse by design: a metric
     *  with insufficient history is simply absent rather than stored as 0. */
    baseline: { type: Object, default: {} },

    /** Window the baseline was computed over, for honest labelling. */
    baselineDays: { type: Number, default: 90 },
    activeDays: { type: Number, default: 0 },

    computedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.models.UserInsights
    || mongoose.model('UserInsights', userInsightsSchema);
