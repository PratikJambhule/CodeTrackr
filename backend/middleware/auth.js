const User = require('../models/user');

const isAuthenticated = (req, res, next) => {
    if (req.user) { // Passport attaches the user to the request object
        return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
};

// Middleware to verify API key from extension
const verifyApiKey = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        
        if (!apiKey) {
            return res.status(401).json({ 
                success: false, 
                message: 'API key is required. Please provide x-api-key header.' 
            });
        }

        const user = await User.findOne({ apiKey });
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid API key. Please check your credentials.' 
            });
        }

        // Attach user to request
        req.user = user;
        next();
    } catch (error) {
        console.error('API key verification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Authentication failed' 
        });
    }
};

module.exports = { isAuthenticated, verifyApiKey };

