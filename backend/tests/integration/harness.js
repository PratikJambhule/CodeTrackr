'use strict';

/**
 * Integration-test harness: a real Express app against a real (in-memory)
 * MongoDB. Each suite calls start() once and stop() at the end.
 *
 * The env must be set BEFORE app.js is required, because app.js reads it at
 * import time (JWT_SECRET guard, passport config, mongoose.connect).
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;
let app;
let mongoose;

async function start() {
  mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGO_URI: mongod.getUri('codetrackr-test'),
    MONGO_TLS: 'false',
    JWT_SECRET: 'integration-test-secret',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:5050/auth/google/callback',
    FRONTEND_URL: 'http://localhost:5173',
  });
  delete process.env.AUTH_BYPASS;

  app = require('../../app');
  mongoose = require('mongoose');
  await mongoose.connection.asPromise();
  // Build every declared index (unique bucket key, idempotency TTL, ...) so the
  // tests exercise the same constraints production has.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return app;
}

async function reset() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

async function stop() {
  await mongoose.disconnect();
  await mongod.stop();
}

/** Create a user and return { user, apiKey, cookie } ready for requests. */
async function makeUser(name = 'Test User') {
  const jwt = require('jsonwebtoken');
  const User = require('../../models/user');
  const suffix = Math.random().toString(36).slice(2, 10);
  const user = await User.create({
    googleId: `g-${suffix}`,
    name,
    email: `${suffix}@example.test`,
  });
  const apiKey = user.issueApiKey();
  await user.save();
  const token = jwt.sign({ id: user.id, name: user.name }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user, apiKey, cookie: `token=${token}` };
}

/** Tiny runner in the same style as the unit suites: PASS/FAIL lines + exit code. */
async function run(title, tests) {
  console.log(`\n${title}`);
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await reset();
      await fn();
      passed += 1;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n        ') : err}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}

module.exports = { start, stop, reset, makeUser, run };
