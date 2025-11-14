const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Route to start Google authentication
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google auth callback
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    // Successful authentication, create a JWT with more user info
    const payload = { 
        id: req.user.id, 
        name: req.user.name,
        email: req.user.email,
        isFirstLogin: req.user.isFirstLogin
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1d' });

    // Send the token in a cookie and redirect
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    
    // Redirect to onboarding if first login, otherwise dashboard
    const redirectUrl = req.user.isFirstLogin 
        ? (process.env.FRONTEND_URL || 'http://localhost:5173') + '/onboarding'
        : (process.env.FRONTEND_URL || 'http://localhost:5173') + '/dashboard';
    
    res.redirect(redirectUrl);
});

// Route to check current user status
router.get('/current-user', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ user: null });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        res.json({ user: decoded });
    } catch (err) {
        res.status(401).json({ user: null });
    }
});

// Logout route
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
