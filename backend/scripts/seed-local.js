#!/usr/bin/env node
/**
 * Seed a LOCAL MongoDB (the `mongo` container in docker-compose.yml) with demo
 * data: two users, some recent activity and a shared group. Runs once: if any
 * user exists it does nothing, so data you create survives restarts.
 *
 *   node scripts/seed-local.js        (docker compose runs this before the API starts)
 *
 * Safety: refuses to run unless MONGO_URI points at a local host (mongo,
 * localhost, 127.0.0.1), so it can never write demo data into Atlas.
 * Uses production dependencies only, because the Docker image has no dev deps.
 */
const mongoose = require('mongoose');

const LOCAL_HOSTS = ['mongo', 'localhost', '127.0.0.1'];

(async () => {
  const uri = process.env.MONGO_URI || '';
  const host = (uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^:/,]+)/) || [])[1];
  if (!host || !LOCAL_HOSTS.includes(host)) {
    console.error(`seed-local: refusing to seed "${host || 'unknown host'}" — only a local MongoDB is allowed.`);
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const User = require('../models/user');
  const Activity = require('../models/Activity');
  const Group = require('../models/Group');
  const GroupMember = require('../models/GroupMember');
  const { rebuildAll } = require('../services/userStats');
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));

  if (await User.estimatedDocumentCount() > 0) {
    console.log('seed-local: database already has users — leaving it as it is.');
    await mongoose.disconnect();
    return;
  }

  const me = await User.create({ googleId: 'local-me', name: 'Soham (local)', email: 'me@example.test', isFirstLogin: false });
  const rival = await User.create({ googleId: 'local-rival', name: 'Rival', email: 'rival@example.test', isFirstLogin: false });
  me.issueApiKey(); await me.save();
  rival.issueApiKey(); await rival.save();

  // Ten-minute buckets over the last day, shaped like real ingest output.
  const W = 600000;
  const start = Math.floor((Date.now() - 20 * 3600e3) / W) * W;
  const bucket = (user, minutesAfterStart, seconds, extra = {}) => {
    const t = new Date(start + minutesAfterStart * 60000);
    return {
      userId: user._id, projectName: 'demo', language: 'typescript', fileName: 'index.ts',
      bucketStart: t, timestamp: t, files: ['index.ts'], flushCount: 3,
      duration: seconds, claimedDuration: seconds, linesAdded: 30, linesRemoved: 5,
      editorAnalytics: { charsInserted: 500, linesInserted: 30, saveCount: 3 },
      focusAnalytics: { focusedMs: seconds * 1000 },
      terminalAnalytics: { totalCommands: 6, successfulCommands: 4, failedCommands: 2, buildRuns: 2, successfulBuilds: 1, failedBuilds: 1 },
      gitAnalytics: { commits: 1 },
      ...extra,
    };
  };
  const docs = [];
  for (let m = 0; m < 60; m += 10) docs.push(bucket(me, m, 600));
  for (let m = 900; m < 930; m += 10) docs.push(bucket(rival, m, 600, { language: 'python' }));
  docs.push(bucket(me, 960, 600));
  await Activity.insertMany(docs);

  const group = await Group.create({ name: 'Contest Week', description: 'Local demo group', visibility: 'public', createdBy: me._id });
  await GroupMember.create({ groupId: group._id, userId: me._id });
  await GroupMember.create({ groupId: group._id, userId: rival._id });

  await rebuildAll({ apply: true });
  console.log(`seed-local: added 2 users, ${docs.length} activity buckets and 1 group.`);
  await mongoose.disconnect();
})().catch((err) => { console.error('seed-local failed:', err.message); process.exit(1); });
