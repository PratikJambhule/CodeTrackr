'use strict';

/**
 * OAuth `state` store for passport-oauth2 that keeps the nonce in a short-lived
 * httpOnly cookie instead of a server-side session (the app has no session
 * store by design). Closes login CSRF (L-11): the callback is accepted only if
 * it carries the state this browser was given when it started the login.
 *
 * The cookie is SameSite=Lax: Google's redirect back is a top-level GET
 * navigation, which Lax cookies accompany, while a cross-site subrequest does not.
 */
const crypto = require('crypto');

const COOKIE = 'oauth_state';
const MAX_AGE_MS = 10 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/auth',
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

const cookieStateStore = {
  store(req, meta, callback) {
    const state = crypto.randomBytes(16).toString('hex');
    req.res.cookie(COOKIE, state, cookieOptions());
    callback(null, state);
  },

  verify(req, providedState, meta, callback) {
    const expected = req.cookies && req.cookies[COOKIE];
    const { maxAge, ...clear } = cookieOptions(); // eslint-disable-line no-unused-vars
    req.res.clearCookie(COOKIE, clear);
    if (!safeEqual(providedState, expected)) {
      return callback(null, false, { message: 'Invalid authorization request state.' });
    }
    return callback(null, true);
  },
};

module.exports = { cookieStateStore, COOKIE, safeEqual };
