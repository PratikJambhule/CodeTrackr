/**
 * Group password hashing.
 *
 * Uses Node's built-in crypto.scrypt — no native dependency, which keeps the
 * Vercel serverless build simple and lets these tests run without npm install.
 *
 * Stored format: scrypt$<saltHex>$<hashHex>
 *
 * Legacy groups stored passwords in plaintext. verifyPassword accepts a
 * plaintext match so existing members are not locked out; routes/groups.js
 * upgrades the stored value on the next successful join.
 */

const crypto = require('crypto');

const PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(plain, salt) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(plain, salt, KEY_LENGTH, (err, derived) => {
            if (err) reject(err);
            else resolve(derived);
        });
    });
}

function isHashed(stored) {
    return typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);
}

async function hashPassword(plain) {
    if (typeof plain !== 'string' || plain.length === 0) {
        throw new Error('password must be a non-empty string');
    }
    const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
    const derived = await scrypt(plain, salt);
    return `${PREFIX}$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(plain, stored) {
    if (typeof plain !== 'string' || typeof stored !== 'string' || stored.length === 0) {
        return false;
    }

    if (!isHashed(stored)) {
        // Legacy plaintext. Length-safe constant-time comparison.
        const a = Buffer.from(plain);
        const b = Buffer.from(stored);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    const [, salt, hashHex] = stored.split('$');
    if (!salt || !hashHex) return false;

    const derived = await scrypt(plain, salt);
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword, isHashed };
