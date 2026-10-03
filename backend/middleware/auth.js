const jwt = require('jsonwebtoken');
const { log } = require('../services/logger');
const { isBypassAllowed } = require('../services/authorization');
const User = require('../models/user');
const { parseKey, hashSecret, verifySecret } = require('../services/apiKeys');
const DeviceToken = require('../models/DeviceToken');
const Activity = require('../models/Activity');

let bypassWarningLogged = false;

/**
 * AUTH_BYPASS turns off authentication entirely and attaches the most active
 * real user. Refused outright in production regardless of the env var.
 */
function bypassEnabled() {
    const allowed = isBypassAllowed(process.env);
    if (allowed && !bypassWarningLogged) {
        bypassWarningLogged = true;
        log.warn('AUTH_BYPASS is ON: all authentication is disabled. Never use this in production.');
    }
    if (!allowed && process.env.AUTH_BYPASS === 'true') {
        log.error('AUTH_BYPASS was requested but refused because NODE_ENV=production');
    }
    return allowed;
}

// For testing mode, bypass all auth and attach a usable user context.
const resolveTestingUser = async (req) => {
    // If another middleware has already attached a user, keep it.
    if (req.user) {
        return req.user;
    }

    const headerUserId = req.headers['x-test-user-id'];
    if (headerUserId) {
        const byId = await User.findById(headerUserId);
        if (byId) {
            return byId;
        }
    }

    // Prefer the user with the most tracked activity so dashboards show existing data.
    const topActivityUser = await Activity.aggregate([
        { $group: { _id: { $toString: '$userId' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
    ]);

    let user = null;
    if (topActivityUser.length > 0 && topActivityUser[0]._id) {
        try {
            user = await User.findById(topActivityUser[0]._id);
        } catch {
            user = null;
        }
    }

    // Fall back to any existing user if activity-linked user can't be resolved.
    if (!user) {
        user = await User.findOne().sort({ createdAt: 1 });
    }

    if (user) {
        return user;
    }

    // Create a deterministic local test user if database is empty.
    const suffix = Date.now().toString();
    user = await User.create({
        googleId: `test-user-${suffix}`,
        name: 'Test User',
        email: `test.user.${suffix}@local.codetrackr`,
        profilePictureUrl: '',
        isFirstLogin: false,
        lastLogin: new Date()
    });

    user.issueApiKey();
    await user.save();
    return user;
};

const resolveJwtUser = async (req) => {
    const token = req.cookies?.token;
    if (!token) {
        return null;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?.id) {
            return null;
        }
        return await User.findById(decoded.id);
    } catch (error) {
        return null;
    }
};

const isAuthenticated = async (req, res, next) => {
    try {
        if (bypassEnabled()) {
            req.user = await resolveTestingUser(req);
            return next();
        }

        const jwtUser = await resolveJwtUser(req);
        if (!jwtUser) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        req.user = jwtUser;
        return next();
    } catch (error) {
        log.error('auth check failed', { requestId: req.id, err: error });
        return res.status(500).json({
            success: false,
            message: 'Failed to authenticate user'
        });
    }
};

/**
 * Resolve an extension key to its user, or null.
 *  - ct_<id>_<secret>: look up by id, compare SHA-256(secret) in constant time.
 *  - legacy 64-hex key: look up by its SHA-256. A row still holding the key in
 *    plaintext (not yet migrated) is accepted once and converted on the spot,
 *    the same opportunistic upgrade used for group passwords (H-9).
 */
async function findUserByApiKey(token) {
    const parsed = parseKey(token);
    if (parsed) {
        const user = await User.findOne({ apiKeyId: parsed.id }).select('+apiKeyHash');
        if (user) return verifySecret(parsed.secret, user.apiKeyHash) ? user : null;

        // A per-device key from the device sign-in (roadmap item 13).
        const device = await DeviceToken.findOne({ keyId: parsed.id }).select('+hash');
        if (!device || device.expiresAt <= new Date() || !verifySecret(parsed.secret, device.hash)) return null;
        if (!device.lastUsedAt || Date.now() - device.lastUsedAt.getTime() > 60 * 60 * 1000) {
            await DeviceToken.updateOne({ _id: device._id }, { $set: { lastUsedAt: new Date() } }); // at most hourly
        }
        return User.findById(device.userId);
    }

    const legacyHash = hashSecret(token);
    const hashed = await User.findOne({ legacyApiKeyHash: legacyHash });
    if (hashed) return hashed;

    const plain = await User.findOne({ apiKey: token }).select('+apiKey');
    if (!plain) return null;
    plain.legacyApiKeyHash = legacyHash;
    plain.apiKey = undefined;
    await plain.save();
    return plain;
}

// API key validation is intentionally bypassed in testing mode.
const verifyApiKey = async (req, res, next) => {
    try {
        if (bypassEnabled()) {
            req.user = await resolveTestingUser(req);
            return next();
        }

        const apiKeyHeader = req.headers['x-api-key'];
        const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader.trim() : '';

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                message: 'API key is required'
            });
        }

        const user = await findUserByApiKey(apiKey);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid API key'
            });
        }

        req.user = user;
        return next();
    } catch (error) {
        log.error('api key check failed', { requestId: req.id, err: error });
        return res.status(500).json({
            success: false,
            message: 'Failed to authenticate API key'
        });
    }
};

module.exports = { isAuthenticated, verifyApiKey, findUserByApiKey };

