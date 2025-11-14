const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { isAuthenticated } = require('../middleware/auth');

// Get user profile with API key
router.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-__v');
        
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
                apiKey: user.apiKey,
                isFirstLogin: user.isFirstLogin,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
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

        // Generate new API key
        user.generateApiKey();
        await user.save();

        res.json({
            success: true,
            message: 'API key regenerated successfully',
            apiKey: user.apiKey
        });
    } catch (error) {
        console.error('Regenerate API key error:', error);
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
        console.error('Complete onboarding error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to complete onboarding' 
        });
    }
});

module.exports = router;
