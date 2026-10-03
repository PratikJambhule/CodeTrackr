#!/usr/bin/env node
/**
 * Run the whole backend locally with NO external accounts: the real app.js on
 * an in-memory MongoDB, AUTH_BYPASS on (refused in production), and two demo
 * users with activity and a shared group. Pair it with `npm run dev` in
 * frontend/ and open http://localhost:5173.
 *
 *   npm run dev:local        (from backend/)
 *
 * Data disappears when the process stops. Never point this at a real database.
 */
const path = require('path');
const BACKEND = path.join(__dirname, '..');
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mongod = await MongoMemoryServer.create();
  Object.assign(process.env, {
    NODE_ENV: 'development',
    MONGO_URI: mongod.getUri('codetrackr-dev'),
    MONGO_TLS: 'false',
    JWT_SECRET: 'local-dev-secret',
    GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x',
    GOOGLE_CALLBACK_URL: 'http://localhost:5050/auth/google/callback',
    FRONTEND_URL: 'http://localhost:5173',
    AUTH_BYPASS: 'true',
  });
  const app = require(path.join(BACKEND, 'app.js'));
  const mongoose = require('mongoose');
  await mongoose.connection.asPromise();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const User = require(path.join(BACKEND, 'models/user'));
  const request = require('supertest');
  const me = await User.create({ googleId: 'g-me', name: 'Soham (local)', email: 'me@example.test', isFirstLogin: false });
  const rival = await User.create({ googleId: 'g-rival', name: 'Rival', email: 'rival@example.test' });
  me.issueApiKey(); await me.save();
  rival.issueApiKey(); await rival.save();

  const W = Math.floor((Date.now() - 20 * 3600e3) / 600000) * 600000; // 20 h ago (ingest accepts <= 24 h)
  // AUTH_BYPASS ignores the key; x-test-user-id picks the user instead.
  const up = (user, minutesAfterW, duration, extra = {}) => request(app).post('/api/extension/track').set('x-api-key', 'bypass').set('x-test-user-id', String(user._id)).send({
    fileName: 'index.ts', language: 'typescript', projectName: 'demo', duration,
    timestamp: new Date(W + minutesAfterW * 60000).toISOString(),
    editorAnalytics: { charsInserted: 500, linesInserted: 30, saveCount: 3 },
    focusAnalytics: { focusedMs: duration * 1000 },
    terminalAnalytics: { totalCommands: 6, failedCommands: 2, buildRuns: 2, failedBuilds: 1 },
    gitAnalytics: { commits: 1 }, ...extra,
  });
  await up(me, 0, 3600);
  await up(rival, 900, 1800);
  await up(me, 960, 600);
  const g = await require(path.join(BACKEND, 'models/Group')).create({ name: 'Contest Week', description: 'Local demo group', visibility: 'public', createdBy: me._id });
  const GM = require(path.join(BACKEND, 'models/GroupMember'));
  await GM.create({ groupId: g._id, userId: me._id });
  await GM.create({ groupId: g._id, userId: rival._id });

  app.listen(5050, () => console.log('DEV API on http://localhost:5050 (AUTH_BYPASS, in-memory DB)'));
})().catch((e) => { console.error(e); process.exit(1); });
