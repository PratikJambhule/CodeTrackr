'use strict';

const crypto = require('crypto');
const { log } = require('../services/logger');

/**
 * Give every request an id, return it as `X-Request-Id`, and write one access
 * log line when the response finishes (roadmap item 18). The central error
 * handler reports the same id in its JSON body, so a user's "error id: abc123"
 * leads straight to the request's log lines.
 *
 * A caller-supplied `X-Request-Id` (e.g. from a proxy) is reused when it looks
 * safe; anything else is replaced, so the header cannot inject into logs.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomBytes(6).toString('hex');
  res.set('X-Request-Id', req.id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log[level]('request', {
      requestId: req.id,
      method: req.method,
      path: req.baseUrl + req.path, // no query string: it can carry codes and ids
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      user: req.user ? String(req.user._id) : undefined,
    });
  });
  next();
}

module.exports = { requestId };
