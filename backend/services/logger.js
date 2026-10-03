'use strict';

/**
 * Structured logging (roadmap item 18, L-3). One JSON object per line, so the
 * host's log search (Render) can filter by field, e.g. every line of one
 * request by `requestId`, or every 5xx by `status`.
 *
 *   log.info('request', { requestId, method, path, status, ms })
 *
 * Levels: debug < info < warn < error. LOG_LEVEL sets the minimum (default
 * info; tests default to warn so test output stays readable). No dependency:
 * at this size a 30-line logger is easier to explain than pino's options.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel() {
  const configured = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured]) return LEVELS[configured];
  return process.env.NODE_ENV === 'test' ? LEVELS.warn : LEVELS.info;
}

function serializeError(err) {
  if (!err || typeof err !== 'object') return err;
  return { name: err.name, message: err.message, code: err.code, stack: err.stack };
}

function write(level, msg, fields) {
  if (LEVELS[level] < minLevel()) return;
  const line = { ts: new Date().toISOString(), level, msg };
  for (const [k, v] of Object.entries(fields || {})) {
    line[k] = v instanceof Error ? serializeError(v) : v;
  }
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

const log = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};

module.exports = { log, LEVELS };
