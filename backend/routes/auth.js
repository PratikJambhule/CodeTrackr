const express = require('express');
const { log } = require('../services/logger');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// Route to start Google authentication
router.get('/google', (req, res, next) => {
    passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

// Google auth callback
// failureRedirect must be absolute: a relative '/login' resolved against the
// API host and showed "Cannot GET /login" when a user cancelled (M-26).
router.get('/google/callback', (req, res, next) => passport.authenticate('google', {
    failureRedirect: `${frontendUrl()}/login?error=signin`, session: false
})(req, res, next), (req, res) => {
    // Log the id only: the user document carries API-key fields.
    log.info('oauth sign-in', { requestId: req.id, user: String(req.user.id), firstLogin: Boolean(req.user.isFirstLogin) });

    // Successful authentication, create a JWT with more user info
    const payload = { 
        id: req.user.id, 
        name: req.user.name,
        email: req.user.email,
        isFirstLogin: req.user.isFirstLogin
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    // Cookie options for production
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    };

    // Send the token in a cookie and redirect
    res.cookie('token', token, cookieOptions);
    
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ user: decoded });
    } catch (err) {
        res.status(401).json({ user: null });
    }
});

// Logout route
router.post('/logout', (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('token', {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
    });
    res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
