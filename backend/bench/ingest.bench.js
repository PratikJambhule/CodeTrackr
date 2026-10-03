#!/usr/bin/env node
/**
 * Ingest benchmark (roadmap item 15): what bucketing costs and saves.
 *
 *   node bench/ingest.bench.js            # runs both modes in child processes
 *
 * Two measurements per mode (ACTIVITY_BUCKET_MS=600000 "bucketed" vs 0 "legacy",
 * one document per upload):
 *   1. throughput  autocannon, 10 connections, 15 s, POST /api/extension/track
 *   2. storage     replay a realistic day for 20 users: one upload every 2 min
 *                  (the extension's cadence since 2.3.0) and every 30 s (before
 *                  2.3.0), then count documents and collection bytes.
 * Local in-memory MongoDB, same machine: compare the modes, not absolute numbers.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const MODE = process.env.BENCH_MODE;

if (!MODE) {
  const results = {};
  for (const mode of ['legacy', 'bucketed']) {
    const out = execFileSync(process.execPath, [__filename], {
      env: { ...process.env, BENCH_MODE: mode }, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'], // progress lines from the child show up live
    }).toString();
    results[mode] = JSON.parse(out.slice(out.indexOf('{"mode"')));
  }
  const date = new Date().toISOString().slice(0, 10);
  const report = { date, machine: `${require('os').cpus().length} logical cores, ${process.platform}`, ...results };
  console.log(JSON.stringify(report, null, 2));
  require('fs').writeFileSync(path.join(__dirname, `ingest-${date}.json`), JSON.stringify(report, null, 2));
  process.exit(0);
}

(async () => {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const autocannon = require('autocannon');
  const request = require('supertest');
  const mongod = await MongoMemoryServer.create({ instance: { args: ['--wiredTigerCacheSizeGB', '0.5'] } });
  Object.assign(process.env, {
    NODE_ENV: 'test', MONGO_URI: mongod.getUri('ingest'), MONGO_TLS: 'false', JWT_SECRET: 'bench',
    GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', GOOGLE_CALLBACK_URL: 'http://localhost/cb',
    ACTIVITY_BUCKET_MS: MODE === 'bucketed' ? '600000' : '0',
  });
  // Silence per-request logging so it does not dominate the measurement.
  console.log = () => {};
  const app = require(path.join(__dirname, '..', 'app.js'));
  const mongoose = require('mongoose');
  await mongoose.connection.asPromise();
  const Activity = require('../models/Activity');
  const User = require('../models/user');
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const makeUser = async (i) => {
    const u = await User.create({ googleId: `g${i}`, name: `U${i}`, email: `u${i}@b.test` });
    const key = u.issueApiKey();
    await u.save();
    return key;
  };
  const body = (ts, duration) => ({
    fileName: 'index.ts', language: 'typescript', projectName: 'demo', duration,
    timestamp: new Date(ts).toISOString(),
    editorAnalytics: { charsInserted: 300, linesInserted: 12, saveCount: 1 },
    focusAnalytics: { focusedMs: duration * 1000 },
    terminalAnalytics: { totalCommands: 2, failedCommands: 1 },
  });

  // One listening server for everything: supertest(app) would start a fresh
  // ephemeral server per request, which made the first version of this run
  // for over 40 minutes on Windows.
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // 1. throughput
  const key = await makeUser('load');
  const load = await new Promise((resolve, reject) => autocannon({
    url: `http://127.0.0.1:${port}/api/extension/track`,
    method: 'POST', connections: 10, duration: 15,
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body(Date.now() - 3600e3, 60)),
  }, (e, r) => (e ? reject(e) : resolve(r))));
  process.stderr.write(`[${MODE}] throughput done
`);

  // 2. storage for a realistic day
  const storage = {};
  for (const [label, everySec] of [['every2min', 120], ['every30s', 30]]) {
    await Activity.deleteMany({});
    await mongoose.connection.collection('windowusages').deleteMany({});
    const users = [];
    for (let i = 0; i < 10; i++) users.push(await makeUser(`${label}-${i}`));
    const start = Date.now() - 20 * 3600e3;
    let uploads = 0;
    // Users in parallel; each user's uploads in order, as one extension would send them.
    await Promise.all(users.map(async (k) => {
      for (let t = 0; t < 8 * 3600; t += everySec) { // an 8-hour coding day
        const r = await request(base).post('/api/extension/track').set('x-api-key', k).send(body(start + t * 1000, everySec));
        if (r.status >= 300) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.body)}`);
        uploads += 1;
      }
    }));
    process.stderr.write(`[${MODE}] storage ${label} done
`);
    const stats = await mongoose.connection.db.command({ collStats: 'activities' });
    storage[label] = { uploads, documents: await Activity.countDocuments(), bytes: stats.size, indexBytes: stats.totalIndexSize };
  }

  process.stdout.write(JSON.stringify({
    mode: MODE,
    throughput: {
      requests: load.requests.total, rps: Math.round(load.requests.average), p50ms: load.latency.p50,
      p90ms: load.latency.p90, p99ms: load.latency.p99, non2xx: load.non2xx,
    },
    storage,
  }));
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack)); process.exit(1); });
