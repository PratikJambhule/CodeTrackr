'use strict';

/**
 * Saving coding sessions and their labels (ML plan slice 1a, tasks B7 + B8; label priority M4).
 *
 *   sessionFields(session)        the stored copy of a sessionize() session, with the model's
 *                                 shadow guess (D-56)
 *   promptFor(userId, startMs)    pure: 'blind' for 1 in 5 sessions, fixed per session
 *   trainingLabel(doc)            pure: the label to train on, by priority picker > blind > shown
 *   sessionsFor(userId, range)    reads a user's buckets and returns sessionize() sessions
 *   snapshotUser / snapshotAll    upsert sessions that ended over 24 h ago (idempotent; labels kept)
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const Session = require('../models/Session');
const { sessionize } = require('./sessionize');
const { SESSION_PROJECTION } = require('./metricsService');
const { matchActivityUser } = require('./activityUser');
const { shadowGuess } = require('./workTypeModel');

const DAY_MS = 24 * 3600 * 1000;
const SETTLE_MS = DAY_MS;      // a session is saved once it ended more than 24 h ago
const BLIND_ONE_IN = 5;        // 20% of sessions are asked without showing a guess

function sessionFields(s) {
    return {
        startAt: new Date(s.startMs),
        endAt: new Date(s.endMs),
        durationSec: Math.round(s.durationSec),
        writingSec: Math.round(s.writingSec || 0),
        readingSec: Math.round(s.readingSec || 0),
        runningSec: Math.round(s.runningSec || 0),
        projects: s.projects || [],
        languages: s.languages || [],
        featureVersion: s.featureVersion,
        features: s.workFeatures,
        workType: s.workType,
        pickerLabel: s.pickerLabel || null,
        modelGuess: shadowGuess(s), // shadow mode (D-56): saved, never shown
    };
}

/** Stable and unpredictable from outside: the same session always gets the same kind of prompt. */
function promptFor(userId, startMs) {
    const h = crypto.createHash('sha256').update(`${userId}:${startMs}`).digest();
    return h.readUInt32BE(0) % BLIND_ONE_IN === 0 ? 'blind' : 'guess';
}

/** The label used for training, with where it came from (plan M4: picker > blind > shown). */
function trainingLabel(doc) {
    if (doc && doc.pickerLabel && doc.pickerLabel.type) return { type: doc.pickerLabel.type, source: 'picker' };
    if (doc && doc.userLabel && doc.userLabel.type) return { type: doc.userLabel.type, source: doc.userLabel.source };
    return null;
}

/** The user's sessions that overlap [fromMs, toMs]. Reads 12 h either side so edge sessions are whole. */
async function sessionsFor(userId, fromMs, toMs) {
    const docs = await Activity.find({
        userId: matchActivityUser(String(userId)),
        timestamp: { $gte: new Date(fromMs - DAY_MS / 2), $lt: new Date(toMs + DAY_MS / 2) },
    }, SESSION_PROJECTION).sort({ timestamp: 1 }).lean();
    return sessionize(docs).filter((s) => s.endMs > fromMs && s.startMs < toMs);
}

/** Save one user's settled sessions in [since, now - 24 h]. Labels already given are never touched. */
async function snapshotUser(userId, { since, now = Date.now() } = {}) {
    const until = now - SETTLE_MS;
    const sessions = (await sessionsFor(userId, since, until)).filter((s) => s.endMs <= until && s.startMs >= since);
    for (const s of sessions) {
        await Session.updateOne(
            { userId, startAt: new Date(s.startMs) },
            { $set: { ...sessionFields(s), snapshotAt: new Date(now) },
              $setOnInsert: { prompt: promptFor(String(userId), s.startMs) } },
            { upsert: true },
        );
    }
    return sessions.length;
}

/** Nightly: every user with activity in the last `days` days. Returns { users, sessions }. */
async function snapshotAll({ days = 3, now = Date.now() } = {}) {
    const since = now - days * DAY_MS;
    const ids = await Activity.distinct('userId', { timestamp: { $gte: new Date(since), $lt: new Date(now - SETTLE_MS) } });
    const users = [...new Set(ids.map(String))].filter((id) => mongoose.isValidObjectId(id));
    let sessions = 0;
    for (const id of users) sessions += await snapshotUser(new mongoose.Types.ObjectId(id), { since, now });
    return { users: users.length, sessions };
}

module.exports = { sessionFields, promptFor, trainingLabel, sessionsFor, snapshotUser, snapshotAll, BLIND_ONE_IN, SETTLE_MS };
