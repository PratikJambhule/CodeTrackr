const express = require('express');
const { log } = require('../services/logger');
const router = express.Router();
const User = require('../models/user');
const { isAuthenticated } = require('../middleware/auth');

// Get user profile with API key
router.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-__v +legacyApiKeyHash +apiKey');
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                profilePictureUrl: user.profilePictureUrl,
                // The key itself is never returned after creation: only its
                // SHA-256 is stored. The hint identifies which key is active.
                hasApiKey: Boolean(user.apiKeyId),
                apiKeyHint: user.apiKeyHint(),
                apiKeyCreatedAt: user.apiKeyCreatedAt,
                // An old-format key may still be configured in an extension.
                legacyApiKey: !user.apiKeyId && Boolean(user.legacyApiKeyHash || user.apiKey),
                isFirstLogin: user.isFirstLogin,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        log.error('get profile failed', { requestId: req.id, err: error });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch profile' 
        });
    }
});

// Regenerate API key
router.post('/regenerate-api-key', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Issue a new key; every older key (new-format or legacy) stops working.
        const apiKey = user.issueApiKey();
        await user.save();

        res.json({
            success: true,
            message: 'API key regenerated successfully',
            apiKey,
            apiKeyHint: user.apiKeyHint()
        });
    } catch (error) {
        log.error('regenerate api key failed', { requestId: req.id, err: error });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to regenerate API key' 
        });
    }
});

// Mark first login as complete
router.post('/complete-onboarding', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        user.isFirstLogin = false;
        await user.save();

        res.json({
            success: true,
            message: 'Onboarding completed'
        });
    } catch (error) {
        log.error('complete onboarding failed', { requestId: req.id, err: error });
        res.status(500).json({
            success: false,
            message: 'Failed to complete onboarding'
        });
    }
});

// Linked LeetCode (D-59) and Codeforces (D-60) accounts. Shown only to their owner.
const rateLimit = require('express-rate-limit');
const { sessionKey } = require('../services/rateLimitKeys');
const linkedSync = require('../services/linkedSync');
const { LinkError } = require('../services/leetcode');
const { practiceAnalytics } = require('../services/practiceAnalytics');

// Linking calls LeetCode or Codeforces right away: a small cap keeps one person from hammering them.
const linkLimit = rateLimit({
    windowMs: 60 * 60 * 1000, max: 20, keyGenerator: sessionKey,
    standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test',
});

const providerOk = (req, res) => {
    if (linkedSync.PROVIDERS.includes(req.params.provider)) return true;
    res.status(404).json({ success: false, message: 'Unknown account type.' });
    return false;
};

// GET /api/user/links — the linked accounts with their latest summary.
router.get('/links', isAuthenticated, async (req, res, next) => {
    try {
        res.json({ success: true, links: await linkedSync.view(req.user.id) });
    } catch (err) {
        return next(err);
    }
});

// GET /api/user/practice — practice analytics over the linked accounts (D-61).
router.get('/practice', isAuthenticated, async (req, res, next) => {
    try {
        res.json({ success: true, practice: practiceAnalytics(await linkedSync.view(req.user.id)) });
    } catch (err) {
        return next(err);
    }
});

// PUT /api/user/links/:provider { username } — link or change, then sync at once.
router.put('/links/:provider', isAuthenticated, linkLimit, async (req, res, next) => {
    if (!providerOk(req, res)) return;
    try {
        await linkedSync.link(req.user.id, req.params.provider, req.body && req.body.username);
        res.json({ success: true, links: await linkedSync.view(req.user.id) });
    } catch (err) {
        if (err instanceof LinkError) return res.status(err.status).json({ success: false, message: err.publicMessage });
        return next(err);
    }
});

// POST /api/user/links/:provider/verify-code — a code to put in the public profile (D-62).
router.post('/links/:provider/verify-code', isAuthenticated, linkLimit, async (req, res, next) => {
    if (!providerOk(req, res)) return;
    try {
        res.json({ success: true, code: await linkedSync.startVerify(req.user.id, req.params.provider) });
    } catch (err) {
        if (err instanceof LinkError) return res.status(err.status).json({ success: false, message: err.publicMessage });
        return next(err);
    }
});

// POST /api/user/links/:provider/verify — check the code is in the public profile now.
router.post('/links/:provider/verify', isAuthenticated, linkLimit, async (req, res, next) => {
    if (!providerOk(req, res)) return;
    try {
        await linkedSync.verify(req.user.id, req.params.provider);
        res.json({ success: true, links: await linkedSync.view(req.user.id) });
    } catch (err) {
        if (err instanceof LinkError) return res.status(err.status).json({ success: false, message: err.publicMessage });
        return next(err);
    }
});

// DELETE /api/user/links/:provider — unlink and delete everything pulled for it.
router.delete('/links/:provider', isAuthenticated, async (req, res, next) => {
    if (!providerOk(req, res)) return;
    try {
        await linkedSync.unlink(req.user.id, req.params.provider);
        res.json({ success: true, links: await linkedSync.view(req.user.id) });
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
