'use strict';

/**
 * Optional error reporting (Sentry). Nothing is sent anywhere unless SENTRY_DSN
 * is set; errors are always in the JSON logs either way.
 *
 * Hooked into the logger, so EVERY log.error is reported: errors through the
 * central handler, routes that catch their own errors, background jobs and
 * process-level crashes. warn/info (401, 429, ...) are normal traffic and are
 * not sent. Only allow-listed fields go to the third party (no user ids, no
 * emails, no bodies).
 */
const { setErrorSink } = require('./logger');

const SAFE_FIELDS = ['method', 'path', 'status'];
let client = null;

function setClient(c) { client = c || null; }
function enabled() { return Boolean(client); }

function report(msg, fields = {}) {
  if (!client) return;
  const err = fields.err instanceof Error ? fields.err : null;
  client.withScope((scope) => {
    if (fields.requestId) scope.setTag('requestId', fields.requestId);
    scope.setExtra('msg', msg);
    for (const k of SAFE_FIELDS) if (fields[k] !== undefined) scope.setExtra(k, fields[k]);
    if (err) client.captureException(err);
    else client.captureMessage(msg, 'error');
  });
}

/** Start Sentry when SENTRY_DSN is set. Safe to call more than once. */
function init(env = process.env) {
  if (client || !env.SENTRY_DSN) return enabled();
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV || 'development', sendDefaultPii: false });
    client = Sentry;
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', msg: 'SENTRY_DSN is set but @sentry/node could not start', err: err.message })}\n`);
  }
  return enabled();
}

/** Wait (bounded) for queued reports to send, e.g. before exiting after a crash. */
async function flush(ms = 2000) {
  if (client && typeof client.flush === 'function') {
    try { await client.flush(ms); } catch { /* exiting anyway */ }
  }
}

setErrorSink(report);

module.exports = { init, report, flush, setClient, enabled };
