'use strict';

/**
 * Who a rate limit counts against (H-20).
 *
 * Per-IP limits fail twice for this app: a whole campus on one Wi-Fi shares an
 * IP, and since the website forwards /api through Vercel (H-19 fix), Render sees
 * Vercel's IPs, not the visitor's. So browser-facing limits key on the signed-in
 * user or their session, and fall back to the IP only when there is neither.
 *
 * Pure; unit-tested in tests/rateLimitKeys.test.js.
 */
const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');

const ipKey = (req) => `ip:${ipKeyGenerator(String(req.ip || ''))}`;

/** For routes that run after isAuthenticated: one budget per user. */
function userKey(req) {
  const id = req.user && (req.user._id || req.user.id);
  return id ? `user:${String(id)}` : ipKey(req);
}

/**
 * For limiters that run before authentication: one budget per login session,
 * keyed by a hash of the JWT cookie (the token itself never becomes a map key).
 */
function sessionKey(req) {
  const token = req.cookies && req.cookies.token;
  if (!token) return ipKey(req);
  return `sess:${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}`;
}

module.exports = { userKey, sessionKey };
