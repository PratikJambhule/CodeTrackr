'use strict';

// Error reporting (Sentry) gaps: every log.error must reach the reporter, not only
// errors that pass through the central error handler. Uses a fake client, so no
// network and no SENTRY_DSN needed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.LOG_LEVEL = 'error';
const { log } = require('../services/logger');
const reporter = require('../services/errorReporter');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

function fakeClient() {
  const sent = [];
  return {
    sent,
    withScope(cb) {
      const scope = { tags: {}, extras: {}, setTag(k, v) { this.tags[k] = v; }, setExtra(k, v) { this.extras[k] = v; }, setLevel() {} };
      cb(scope);
      sent.push({ scope, ...this._pending });
    },
    captureException(err) { this._pending = { kind: 'exception', err }; },
    captureMessage(msg) { this._pending = { kind: 'message', msg }; },
    flush: async () => true,
  };
}

// Silence the JSON lines the logger writes to stderr during these tests.
const realWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = () => true;

test('without a client (no SENTRY_DSN) log.error still works and sends nothing', () => {
  reporter.setClient(null);
  assert.strictEqual(reporter.enabled(), false);
  log.error('boom', { err: new Error('x') });
});

test('log.error with an Error is sent as an exception, tagged with the request id', () => {
  const c = fakeClient();
  reporter.setClient(c);
  const err = new Error('profile lookup failed');
  log.error('get profile failed', { requestId: 'abc123def456', err });
  assert.strictEqual(c.sent.length, 1);
  assert.strictEqual(c.sent[0].kind, 'exception');
  assert.strictEqual(c.sent[0].err, err);
  assert.strictEqual(c.sent[0].scope.tags.requestId, 'abc123def456');
  assert.strictEqual(c.sent[0].scope.extras.msg, 'get profile failed');
});

test('log.error without an Error (e.g. a refused AUTH_BYPASS) is sent as a message', () => {
  const c = fakeClient();
  reporter.setClient(c);
  log.error('AUTH_BYPASS was requested but refused');
  assert.strictEqual(c.sent.length, 1);
  assert.strictEqual(c.sent[0].kind, 'message');
  assert.strictEqual(c.sent[0].msg, 'AUTH_BYPASS was requested but refused');
});

test('a background job error (no request id) is still sent', () => {
  const c = fakeClient();
  reporter.setClient(c);
  log.error('deadline sweep failed', { err: new Error('db down') });
  assert.strictEqual(c.sent.length, 1);
  assert.strictEqual(c.sent[0].scope.tags.requestId, undefined);
});

test('warn and info are never sent (a 401 or 429 is normal traffic, not a bug)', () => {
  const c = fakeClient();
  reporter.setClient(c);
  log.warn('request failed', { status: 401 });
  log.info('request', { status: 200 });
  assert.strictEqual(c.sent.length, 0);
});

test('the per-request access line for a 5xx is not reported (the cause already was: no duplicates)', () => {
  const c = fakeClient();
  reporter.setClient(c);
  log.access('error', 'request', { requestId: 'r1', status: 500 });
  assert.strictEqual(c.sent.length, 0);
});

test('a reporter that throws never breaks logging or the request', () => {
  reporter.setClient({ withScope() { throw new Error('sentry down'); } });
  log.error('still logs', { err: new Error('x') });
});

test('only allow-listed fields are attached (no user ids or bodies sent to a third party)', () => {
  const c = fakeClient();
  reporter.setClient(c);
  log.error('x', { requestId: 'r1', method: 'GET', path: '/api/user/profile', user: 'u1', email: 'a@b.c', err: new Error('e') });
  const extras = c.sent[0].scope.extras;
  assert.strictEqual(extras.path, '/api/user/profile');
  assert.strictEqual(extras.method, 'GET');
  assert.strictEqual(extras.user, undefined);
  assert.strictEqual(extras.email, undefined);
});

test('app.js reports crashes outside requests (unhandled rejection, uncaught exception)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(src, /process\.on\(\s*['"]unhandledRejection['"]/);
  assert.match(src, /process\.on\(\s*['"]uncaughtException['"]/);
  assert.match(src, /errorReporter/);
  assert.doesNotMatch(src, /require\(['"]@sentry\/node['"]\)/, 'Sentry is set up in one place: services/errorReporter.js');
});

reporter.setClient(null);
process.stderr.write = realWrite;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
