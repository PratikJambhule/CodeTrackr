'use strict';

/**
 * Extension API keys, stored hashed (roadmap item 3).
 *
 * Format: ct_<id>_<secret>
 *   id     16 hex chars, stored in clear and indexed — it is a lookup handle, not a secret
 *   secret 32 random bytes, base64url (43 chars) — only its SHA-256 is stored
 *
 * Why SHA-256 and not scrypt/bcrypt: a slow KDF protects LOW-entropy secrets
 * (passwords) from guessing. A 256-bit random secret cannot be guessed, so a
 * fast hash is enough and keeps the per-request check cheap. This is the same
 * choice GitHub and Stripe make for API tokens.
 *
 * Pure: no database, no express. Unit-tested in tests/apiKeys.test.js.
 */
const crypto = require('crypto');

const KEY_RE = /^ct_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function generateKey() {
  const id = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  return { id, secret, token: `ct_${id}_${secret}`, hash: hashSecret(secret), last4: secret.slice(-4) };
}

/** { id, secret } for a new-format key, else null (legacy key or junk). */
function parseKey(token) {
  const m = KEY_RE.exec(typeof token === 'string' ? token.trim() : '');
  return m ? { id: m[1], secret: m[2] } : null;
}

/** Constant-time comparison of a presented secret against a stored hash. */
function verifySecret(secret, storedHash) {
  if (!secret || typeof storedHash !== 'string' || storedHash.length !== 64) return false;
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** What the UI may show after creation: enough to recognise the key, useless to an attacker. */
function hint(id, last4) {
  return id ? `ct_${id}_…${last4 || ''}` : null;
}

module.exports = { generateKey, parseKey, hashSecret, verifySecret, hint, KEY_RE };
