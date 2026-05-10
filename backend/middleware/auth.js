const User = require('../models/user');
const Activity = require('../models/Activity');

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

const isAuthenticated = async (req, res, next) => {
    try {
        req.user = await resolveTestingUser(req);
        next();
    } catch (error) {
        console.error('Auth bypass user resolution error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to initialize test user context' 
        });
    }
};

// API key validation is intentionally bypassed in testing mode.
const verifyApiKey = async (req, res, next) => {
    return isAuthenticated(req, res, next);
};

module.exports = { isAuthenticated, verifyApiKey };

