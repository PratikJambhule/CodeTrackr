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

module.exports = router;
