'use strict';

/**
 * Device-code sign-in for the extension (roadmap item 13), modelled on the
 * OAuth 2.0 Device Authorization Grant (RFC 8628). Pure helpers; the routes
 * are in routes/device.js.
 *
 *   1. extension  POST /api/device/code        -> { deviceCode (secret), userCode "WXYZ-2345", verificationUri }
 *   2. user       opens the dashboard /device page while signed in, sees the code, approves it
 *   3. extension  POST /api/device/token        (polls) -> 428 pending ... 200 { apiKey }
 *
 * The extension never sees the user's password or session, and the key it gets
 * is a per-device key (DeviceToken) that can be revoked on its own.
 */
const crypto = require('crypto');

// No 0/O, 1/I/L: people type this code from one screen into another.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_S = 5;

function generateUserCode() {
  let out = '';
  for (let i = 0; i < 8; i++) out += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Canonical form of a typed code, or null when it cannot be one. */
function normalizeUserCode(input) {
  if (typeof input !== 'string') return null;
  const raw = input.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== 8) return null;
  for (const ch of raw) if (!USER_CODE_ALPHABET.includes(ch)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** The name shown for a device on the approval page and in Profile. */
function clientLabel(input) {
  const clean = String(input || '').replace(/[^A-Za-z0-9 ()._-]/g, '').trim().slice(0, 60);
  return clean || 'VS Code';
}

module.exports = { generateUserCode, normalizeUserCode, clientLabel, USER_CODE_ALPHABET, CODE_TTL_MS, POLL_INTERVAL_S };
