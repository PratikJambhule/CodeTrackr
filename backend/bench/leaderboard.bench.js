#!/usr/bin/env node
/**
 * Leaderboard benchmark (roadmap item 14): the old full-collection scan vs the
 * `userstats` running totals, on the same seeded data, through the real app.
 *
 *   node bench/leaderboard.bench.js [rows=1000000] [users=1000] [seconds=20]
 *
 * Runs everything locally: an in-memory MongoDB (WiredTiger cache capped at
 * 1 GB), the real app.js on a random port, autocannon with 10 connections.
 * Same machine for client, server and database, so treat the numbers as a
 * like-for-like comparison of the two code paths, not as production latency.
 */
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const autocannon = require('autocannon');

const ROWS = Number(process.argv[2] || 1_000_000);
const USERS = Number(process.argv[3] || 1000);
const SECONDS = Number(process.argv[4] || 20);

function fire(url, cookie) {
  return new Promise((resolve, reject) => {
    autocannon({ url, connections: 10, duration: SECONDS, headers: { cookie } }, (err, r) => (err ? reject(err) : resolve(r)));
  });
}

// autocannon reports p50/p90/p97.5/p99 (no p95), so those are what we quote.
const summary = (r) => ({
  requests: r.requests.total,
  rps: Math.round(r.requests.average * 10) / 10,
  p50ms: r.latency.p50,
  p90ms: r.latency.p90,
  p97_5ms: r.latency.p97_5,
  p99ms: r.latency.p99,
  maxMs: r.latency.max,
  non2xx: r.non2xx,
});

(async () => {
  const mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '1'] } });
  Object.assign(process.env, {
    NODE_ENV: 'test', // skips the rate limiters, which would otherwise answer 429 to the load generator
    MONGO_URI: mongod.getUri('bench'), MONGO_TLS: 'false', JWT_SECRET: 'bench',
    GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_CALLBACK_URL: 'http://localhost/cb',
  });
  const app = require(path.join(__dirname, '..', 'app.js'));
  const mongoose = require('mongoose');
  await mongoose.connection.asPromise();
  const User = require('../models/user');
  const Activity = require('../models/Activity');
  const UserStats = require('../models/UserStats');
  const { rebuildAll } = require('../services/userStats');
  await Promise.all([Activity, User, UserStats].map((m) => m.syncIndexes()));

  console.log(`seeding ${USERS} users and ${ROWS.toLocaleString()} activity rows...`);
  const users = await User.insertMany(Array.from({ length: USERS }, (_, i) => ({
    googleId: `g${i}`, name: `User ${i}`, email: `u${i}@bench.test`,
  })));
  const t0 = Date.now();
  const BATCH = 20_000;
  const langs = ['typescript', 'python', 'java', 'cpp'];
  for (let done = 0; done < ROWS; done += BATCH) {
    const docs = [];
    for (let i = done; i < Math.min(ROWS, done + BATCH); i++) {
      const u = users[i % USERS];
      docs.push({
        userId: u._id, projectName: `p${i % 7}`, language: langs[i % 4], fileName: 'f.ts',
        duration: 60 + (i % 540), linesAdded: i % 13, linesRemoved: i % 5,
        timestamp: new Date(Date.now() - (i % 300) * 864e5 / 10), flushCount: 1,
        gitAnalytics: { commits: i % 9 === 0 ? 1 : 0 },
      });
    }
    await Activity.collection.insertMany(docs, { ordered: false });
    if ((done / BATCH) % 10 === 0) process.stdout.write(`  ${(done + docs.length).toLocaleString()}\r`);
  }
  console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const jwt = require('jsonwebtoken');
  const cookie = `token=${jwt.sign({ id: users[0].id }, 'bench', { expiresIn: '1h' })}`;
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/leaderboard`;

  console.log('\n[1/2] full scan (userstats empty)...');
  const scan = await fire(url, cookie);
  console.log('[2/2] building userstats, then the running-totals path...');
  const r0 = Date.now();
  await rebuildAll({ apply: true });
  const rebuildMs = Date.now() - r0;
  const stats = await fire(url, cookie);

  const out = {
    date: new Date().toISOString().slice(0, 10),
    rows: ROWS, users: USERS, seconds: SECONDS, connections: 10,
    machine: `${require('os').cpus().length} logical cores, ${(require('os').totalmem() / 2 ** 30).toFixed(1)} GB RAM, ${process.platform}`,
    scan: summary(scan), userstats: summary(stats), rebuildMs,
  };
  console.log(JSON.stringify(out, null, 2));
  require('fs').writeFileSync(path.join(__dirname, `leaderboard-${out.date}-${ROWS}.json`), JSON.stringify(out, null, 2));

  await new Promise((resolve) => server.close(resolve)); // let in-flight requests finish
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
