const mongoose = require('mongoose');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    googleId: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    profilePictureUrl: {
        type: String
    },
    apiKey: {
        type: String,
        unique: true,
        sparse: true
    },
    lastLogin: {
        type: Date,
        default: Date.now
    },
    isFirstLogin: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Method to generate API key
userSchema.methods.generateApiKey = function() {
    this.apiKey = crypto.randomBytes(32).toString('hex');
    return this.apiKey;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
