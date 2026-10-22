const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const Session = require('../models/Session');
const { sessionsFor, sessionFields, promptFor, SETTLE_MS } = require('../services/sessionSnapshot');
const { WORK_TYPES, NOT_ENOUGH, groupOf } = require('../services/workType');
const { typeAnalytics } = require('../services/typeAnalytics');

/**
 * Coding sessions and their labels (ML plan tasks B8 + W2).
 *
 * Identity comes from the login cookie only: there is no :userId, so nobody can read or label another
 * person's sessions (the same pattern as routes/metrics.js).
 *
 *   GET /api/sessions?days=30   your sessions, newest first, with the guess and any labels.
 *                               For a session asked BLIND that has no answer yet, the guess is
 *                               withheld, so the answer can measure accuracy honestly.
 *   GET /api/sessions/by-type?days=30&timezone=-330
 *                               the numbers behind the DSA / Project work / Learning & setup tabs
 *                               (services/typeAnalytics.js, D-55)
 *   PUT /api/sessions/label     { startAt, workType }  saves your answer for the session at startAt.
 */

const MAX_DAYS = 60;
const DAY_MS = 24 * 3600 * 1000;

function view(s, doc, userId) {
    const startMs = s.startMs;
    const prompt = (doc && doc.prompt) || promptFor(userId, startMs);
    const userLabel = doc && doc.userLabel && doc.userLabel.type ? doc.userLabel : null;
    // Every session with real activity is asked about, "not sure" ones most of all (plan §6).
    const answerable = !!(s.workType && s.workType.type !== NOT_ENOUGH);
    const hideGuess = answerable && prompt === 'blind' && !userLabel;
    return {
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(s.endMs).toISOString(),
        minutes: Math.round(s.durationSec / 60),
        writingSec: Math.round(s.writingSec || 0),
        readingSec: Math.round(s.readingSec || 0),
        runningSec: Math.round(s.runningSec || 0),
        projects: s.projects,
        languages: s.languages,
        // not_enough / not_sure are not asked about; a blind prompt hides the guess until answered
        workType: hideGuess ? null : s.workType,
        prompt: answerable ? prompt : 'none',
        pickerLabel: s.pickerLabel || null,
        userLabel: userLabel ? { type: userLabel.type, group: groupOf(userLabel.type), source: userLabel.source } : null,
    };
}

const daysOf = (req) => Math.min(MAX_DAYS, Math.max(1, Number.parseInt(req.query.days, 10) || 30));

/** Your sessions in the last `days` days, oldest first, each with its saved labels (or null). */
async function sessionsWithDocs(userId, days) {
    const now = Date.now();
    const sessions = await sessionsFor(userId, now - days * DAY_MS, now);
    const docs = await Session.find({ userId, startAt: { $in: sessions.map((s) => new Date(s.startMs)) } })
        .select('startAt prompt userLabel').lean();
    const byStart = new Map(docs.map((d) => [d.startAt.getTime(), d]));
    return sessions.map((s) => ({ s, doc: byStart.get(s.startMs) || null }));
}

router.get('/', isAuthenticated, async (req, res, next) => {
    try {
        const days = daysOf(req);
        const userId = String(req.user._id);
        const rows = await sessionsWithDocs(req.user._id, days);
        res.json({
            days,
            sessions: rows.reverse().map(({ s, doc }) => view(s, doc, userId)),
        });
    } catch (err) {
        return next(err);
    }
});

router.get('/by-type', isAuthenticated, async (req, res, next) => {
    try {
        const days = daysOf(req);
        const userId = String(req.user._id);
        const tz = Number.parseInt(req.query.timezone, 10);
        const timezoneOffset = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz : 0;
        const rows = await sessionsWithDocs(req.user._id, days);
        const entries = rows.map(({ s, doc }) => ({ s, doc, prompt: (doc && doc.prompt) || promptFor(userId, s.startMs) }));
        res.json({ days, ...typeAnalytics(entries, { timezoneOffset }) });
    } catch (err) {
        return next(err);
    }
});

router.put('/label', isAuthenticated, async (req, res, next) => {
    try {
        const { workType } = req.body || {};
        const startMs = Date.parse(req.body && req.body.startAt);
        if (!WORK_TYPES.includes(workType)) {
            return res.status(400).json({ message: `workType must be one of ${WORK_TYPES.join(', ')}` });
        }
        if (!Number.isFinite(startMs) || startMs > Date.now() || startMs < Date.now() - MAX_DAYS * DAY_MS) {
            return res.status(400).json({ message: 'startAt must be a session start in the last 60 days' });
        }
        const [s] = (await sessionsFor(req.user._id, startMs, startMs + 1)).filter((x) => x.startMs === startMs);
        if (!s) return res.status(404).json({ message: 'No session of yours starts at that time' });

        const userId = String(req.user._id);
        const existing = await Session.findOne({ userId: req.user._id, startAt: new Date(startMs) }).select('prompt').lean();
        const prompt = (existing && existing.prompt) || promptFor(userId, startMs);
        const userLabel = {
            type: workType,
            source: prompt === 'blind' ? 'blind' : 'shown',
            agreedWithGuess: prompt === 'blind' ? undefined : s.workType.type === workType,
            at: new Date(),
        };
        // Save a copy of the session now (a recent one is not in the nightly snapshot yet).
        const settled = s.endMs <= Date.now() - SETTLE_MS;
        await Session.updateOne(
            { userId: req.user._id, startAt: new Date(startMs) },
            { $set: { ...sessionFields(s), userLabel, ...(settled ? { snapshotAt: new Date() } : {}) },
              $setOnInsert: { prompt } },
            { upsert: true },
        );
        res.json({ ok: true, startAt: new Date(startMs).toISOString(),
            userLabel: { type: workType, group: groupOf(workType), source: userLabel.source },
            guess: s.workType });
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
