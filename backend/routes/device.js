const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const DeviceAuth = require('../models/DeviceAuth');
const DeviceToken = require('../models/DeviceToken');
const { isAuthenticated } = require('../middleware/auth');
const { generateKey, hashSecret } = require('../services/apiKeys');
const {
    generateUserCode, normalizeUserCode, clientLabel, CODE_TTL_MS, POLL_INTERVAL_S,
} = require('../services/deviceAuth');

/**
 * Device-code sign-in for the extension (roadmap item 13). See
 * services/deviceAuth.js for the flow. Error bodies follow RFC 8628 names
 * (authorization_pending, expired_token) so the client logic reads like the spec.
 */

const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// The two unauthenticated endpoints. Polling every 5 s for 10 minutes is 120
// requests, so 60 a minute per IP leaves room for a few devices behind one NAT.
const deviceLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    skip: () => process.env.NODE_ENV === 'test',
    standardHeaders: true,
    legacyHeaders: false,
});

// 1. The extension asks for a code.
router.post('/code', deviceLimiter, async (req, res, next) => {
    try {
        const deviceCode = crypto.randomBytes(32).toString('base64url');
        let userCode;
        for (let attempt = 0; attempt < 5; attempt++) {
            userCode = generateUserCode();
            try {
                await DeviceAuth.create({
                    deviceCodeHash: hashSecret(deviceCode),
                    userCode,
                    clientName: clientLabel(req.body && req.body.clientName),
                    expiresAt: new Date(Date.now() + CODE_TTL_MS),
                });
                break;
            } catch (err) {
                if (!(err && err.code === 11000) || attempt === 4) throw err; // user-code collision: draw again
            }
        }
        const base = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.status(201).json({
            deviceCode,
            userCode,
            verificationUri: `${base}/device`,
            verificationUriComplete: `${base}/device?code=${encodeURIComponent(userCode)}`,
            expiresIn: CODE_TTL_MS / 1000,
            interval: POLL_INTERVAL_S,
        });
    } catch (error) {
        return next(error);
    }
});

// 2a. The signed-in user looks a code up before approving (shows the device name).
router.get('/pending/:userCode', isAuthenticated, async (req, res, next) => {
    try {
        const userCode = normalizeUserCode(req.params.userCode);
        const auth = userCode && await DeviceAuth.findOne({ userCode, status: 'pending', expiresAt: { $gt: new Date() } });
        if (!auth) return res.status(404).json({ message: 'That code is not valid or has expired' });
        res.json({ userCode: auth.userCode, clientName: auth.clientName, expiresAt: auth.expiresAt });
    } catch (error) {
        return next(error);
    }
});

// 2b. The signed-in user approves it.
router.post('/approve', isAuthenticated, async (req, res, next) => {
    try {
        const userCode = normalizeUserCode(req.body && req.body.userCode);
        if (!userCode) return res.status(400).json({ message: 'Enter the 8-character code shown in VS Code' });
        const auth = await DeviceAuth.findOneAndUpdate(
            { userCode, status: 'pending', expiresAt: { $gt: new Date() } },
            { $set: { status: 'approved', userId: req.user._id } },
            { new: true },
        );
        if (!auth) return res.status(404).json({ message: 'That code is not valid or has expired' });
        res.json({ success: true, clientName: auth.clientName });
    } catch (error) {
        return next(error);
    }
});

// 3. The extension polls for its key.
router.post('/token', deviceLimiter, async (req, res, next) => {
    try {
        const deviceCode = req.body && req.body.deviceCode;
        if (typeof deviceCode !== 'string' || deviceCode.length < 20) {
            return res.status(400).json({ error: 'invalid_request' });
        }
        const deviceCodeHash = hashSecret(deviceCode);
        // Consume atomically: two polls racing cannot both receive a key.
        const auth = await DeviceAuth.findOneAndDelete({ deviceCodeHash, status: 'approved', expiresAt: { $gt: new Date() } });
        if (!auth) {
            const pending = await DeviceAuth.exists({ deviceCodeHash, status: 'pending', expiresAt: { $gt: new Date() } });
            return pending
                ? res.status(428).json({ error: 'authorization_pending' })
                : res.status(410).json({ error: 'expired_token' });
        }
        const key = generateKey();
        await DeviceToken.create({
            userId: auth.userId,
            keyId: key.id,
            hash: key.hash,
            last4: key.last4,
            clientName: auth.clientName,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        });
        res.json({ apiKey: key.token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) });
    } catch (error) {
        return next(error);
    }
});

// Profile: list and revoke this user's device keys.
router.get('/tokens', isAuthenticated, async (req, res, next) => {
    try {
        const tokens = await DeviceToken.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        res.json(tokens.map((t) => ({
            id: t._id,
            clientName: t.clientName,
            hint: `ct_${t.keyId}_…${t.last4 || ''}`,
            createdAt: t.createdAt,
            lastUsedAt: t.lastUsedAt || null,
            expiresAt: t.expiresAt,
        })));
    } catch (error) {
        return next(error);
    }
});

router.delete('/tokens/:id', isAuthenticated, async (req, res, next) => {
    try {
        const removed = await DeviceToken.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!removed) return res.status(404).json({ message: 'Device not found' });
        res.json({ success: true });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
