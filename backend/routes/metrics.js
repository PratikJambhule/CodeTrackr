const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { buildMetrics } = require('../services/metricsService');
const { evaluate } = require('../services/rulesEngine');

const MAX_WINDOW_DAYS = 365;

// GET /api/metrics — derived productivity metrics for the signed-in user.
//
// The user is taken from the session only; there is deliberately no :userId
// parameter, so this route cannot leak another user's analytics the way the
// existing /api/analytics/:userId routes can (see IMPROVEMENT_PLAN.md H-1).
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const requestedDays = parseInt(req.query.days, 10);
        const days = Number.isFinite(requestedDays)
            ? Math.min(Math.max(requestedDays, 1), MAX_WINDOW_DAYS)
            : 30;

        const requestedTz = parseInt(req.query.timezone, 10);
        const timezoneOffset = Number.isFinite(requestedTz) ? requestedTz : 0;

        const metrics = await buildMetrics(req.user._id.toString(), { days, timezoneOffset });

        // Rule-based reading of those numbers. Pure and in-process -- it adds no
        // query. A failure here must not cost the caller their metrics, so the
        // panel degrades to empty rather than failing the request.
        let insights = { findings: [], skipped: [], totalFindings: 0 };
        try {
            insights = evaluate(metrics);
        } catch (err) {
            console.error('rulesEngine failed; serving metrics without findings', err);
        }

        res.json({ success: true, metrics, insights });
    } catch (error) {
        console.error('Error building metrics:', error);
        res.status(500).json({ success: false, message: 'Failed to build metrics' });
    }
});

module.exports = router;
