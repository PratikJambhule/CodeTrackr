const mongoose = require('mongoose');
const { generateKey, hint } = require('../services/apiKeys');

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
    // LEGACY plaintext key (pre 2026-10-03). Never written any more; a row that
    // still has one is converted to legacyApiKeyHash on its next use or by
    // scripts/migrate-hash-api-keys.js. Kept only so existing installs keep working.
    apiKey: {
        type: String,
        unique: true,
        sparse: true,
        select: false
    },
    // SHA-256 of a legacy 64-hex key, so already-configured extensions keep working.
    legacyApiKeyHash: { type: String, unique: true, sparse: true, select: false },
    // Current keys: ct_<apiKeyId>_<secret>. Only the id and SHA-256(secret) are stored.
    apiKeyId: { type: String, unique: true, sparse: true },
    apiKeyHash: { type: String, select: false },
    apiKeyLast4: String,
    apiKeyCreatedAt: Date,
    lastLogin: {
        type: Date,
        default: Date.now
    },
    isFirstLogin: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

/**
 * Issue a new key and revoke every older one (new-format and legacy). Returns
 * the full key — the only moment it exists in clear. Caller must save().
 */
userSchema.methods.issueApiKey = function() {
    const key = generateKey();
    this.apiKeyId = key.id;
    this.apiKeyHash = key.hash;
    this.apiKeyLast4 = key.last4;
    this.apiKeyCreatedAt = new Date();
    this.apiKey = undefined;
    this.legacyApiKeyHash = undefined;
    return key.token;
};

userSchema.methods.apiKeyHint = function() {
    if (this.apiKeyId) return hint(this.apiKeyId, this.apiKeyLast4);
    return null;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
