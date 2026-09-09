const jwt = require('jsonwebtoken');
const { isBypassAllowed } = require('../services/authorization');
const User = require('../models/user');
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
        console.warn('⚠️  AUTH_BYPASS is ON — all authentication is disabled. Never use this in production.');
    }
    if (!allowed && process.env.AUTH_BYPASS === 'true') {
        console.error('❌ AUTH_BYPASS was requested but refused because NODE_ENV=production.');
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
        { $group: { _id: '$userId', count: { $sum: 1 } } },
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

    user.generateApiKey();
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
        console.error('Auth check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to authenticate user'
        });
    }
};

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

        const user = await User.findOne({ apiKey });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid API key'
            });
        }

        req.user = user;
        return next();
    } catch (error) {
        console.error('API key check error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to authenticate API key'
        });
    }
};

module.exports = { isAuthenticated, verifyApiKey };

