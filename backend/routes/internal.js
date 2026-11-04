const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { log } = require('../services/logger');
const {
  checkUpcomingDeadlines,
  checkOverdueGoals,
  rollupDaily,
} = require('../services/notificationScheduler');

// Shared-secret gate for the external scheduler. Constant-time compare; 404
// (not 401) so the route isn't discoverable when the secret is unset or wrong.
function requireCronSecret(req, res, next) {
  const expected = process.env.INTERNAL_CRON_SECRET;
  if (!expected) return res.status(404).json({ error: 'Not found' });
  const got = req.get('x-internal-secret') || '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

// POST /api/internal/run-notifications — the hourly deadline sweep.
router.post('/run-notifications', requireCronSecret, async (req, res, next) => {
  try {
    await checkUpcomingDeadlines();
    await checkOverdueGoals();
    res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// POST /api/internal/run-rollup — the nightly DailySummary rollup.
router.post('/run-rollup', requireCronSecret, async (req, res, next) => {
  try {
    const r = await rollupDaily({ apply: true, beforeDays: 2 });
    // Also save settled coding sessions for the work-type model (ML plan B7). Idempotent.
    const s = await require('../services/sessionSnapshot').snapshotAll();
    // Re-read linked LeetCode accounts (D-59) in the background: with a polite pause per
    // account it can outlast the caller's 180 s timeout. Failures are recorded per account.
    require('../services/linkedSync').syncAll()
      .then((l) => log.info('linked accounts sync', l))
      .catch((err) => log.error('linked accounts sync failed', { err }));
    res.json({ ok: true, wrote: r && r.wrote, sessions: s.sessions, linked: 'started' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
