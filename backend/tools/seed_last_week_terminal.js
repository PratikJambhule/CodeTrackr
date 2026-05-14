const mongoose = require('mongoose');
const Activity = require('../models/Activity');

const USER_ID = '690f41571b5c7a44e327908e';
const PROJECT_NAME = 'CodeTrackr';
const START_DATE_UTC = new Date(Date.UTC(2026, 4, 8)); // 2026-05-08
const END_DATE_UTC = new Date(Date.UTC(2026, 4, 13)); // 2026-05-13
const RECORDS_PER_DAY = 5;

const fileSamples = [
  { fileName: 'analytics.js', fileType: '.js', language: 'JavaScript' },
  { fileName: 'extension.ts', fileType: '.ts', language: 'TypeScript' },
  { fileName: 'Dashboard.tsx', fileType: '.tsx', language: 'TypeScript' },
  { fileName: 'Activity.js', fileType: '.js', language: 'JavaScript' },
  { fileName: 'auth.js', fileType: '.js', language: 'JavaScript' },
  { fileName: 'groups.js', fileType: '.js', language: 'JavaScript' },
  { fileName: 'App.tsx', fileType: '.tsx', language: 'TypeScript' }
];

const commandSamples = ['npm run build', 'npm test', 'git status', 'git commit', 'node app.js', 'npm run dev'];

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];

const allocateCommands = (total) => {
  const buckets = {
    git: 0,
    npm: 0,
    node: 0,
    python: 0,
    docker: 0,
    gcc: 0,
    java: 0,
    pip: 0,
    misc: 0
  };

  const keys = Object.keys(buckets);
  for (let i = 0; i < total; i++) {
    const key = pick(keys);
    buckets[key] += 1;
  }
  return buckets;
};

const buildTerminalAnalytics = () => {
  const totalCommands = randInt(8, 48);
  const failedCommands = randInt(0, Math.min(10, totalCommands));
  const successfulCommands = totalCommands - failedCommands;
  const buildRuns = randInt(0, 4);
  const failedBuilds = randInt(0, Math.min(2, buildRuns));
  const successfulBuilds = buildRuns - failedBuilds;
  const testRuns = randInt(0, 4);
  const debuggingSessions = randInt(0, 2);

  const commandUsage = allocateCommands(totalCommands);
  const gitActivity = {
    commits: randInt(0, 4),
    pushes: randInt(0, 2),
    pulls: randInt(0, 2),
    checkouts: randInt(0, 2),
    merges: randInt(0, 1),
    clones: randInt(0, 1)
  };

  const successRate = totalCommands > 0
    ? Math.round((successfulCommands / totalCommands) * 100)
    : 0;
  const buildSuccessRate = buildRuns > 0
    ? Math.round((successfulBuilds / buildRuns) * 100)
    : 0;

  const repeatedFailedCommands = failedCommands > 0
    ? [{ command: pick(commandSamples), count: randInt(1, failedCommands) }]
    : [];

  return {
    totalCommands,
    terminalErrorCount: failedCommands,
    successfulCommands,
    failedCommands,
    successRate,
    buildRuns,
    testRuns,
    successfulBuilds,
    failedBuilds,
    buildSuccessRate,
    debuggingSessions,
    commandUsage,
    gitActivity,
    repeatedFailedCommands,
    lastCommand: pick(commandSamples),
    lastCommandTimestamp: new Date()
  };
};

const buildActivitiesForDate = (baseDate) => {
  const docs = [];
  for (let i = 0; i < RECORDS_PER_DAY; i++) {
    const sample = pick(fileSamples);
    const timestamp = new Date(baseDate.getTime() + randInt(9, 20) * 3600000 + randInt(0, 59) * 60000);
    const duration = randInt(300, 5400);

    docs.push({
      userId: USER_ID,
      fileName: sample.fileName,
      fileType: sample.fileType,
      projectName: PROJECT_NAME,
      language: sample.language,
      duration,
      linesAdded: randInt(0, 240),
      linesRemoved: randInt(0, 80),
      terminalAnalytics: buildTerminalAnalytics(),
      timestamp,
      date: new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()))
    });
  }
  return docs;
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error('Missing MONGO_URI. Set it before running this script.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    family: 4,
    tls: true
  });

  const docs = [];
  for (let day = new Date(START_DATE_UTC); day <= END_DATE_UTC; day.setUTCDate(day.getUTCDate() + 1)) {
    docs.push(...buildActivitiesForDate(new Date(day)));
  }

  const result = await Activity.insertMany(docs);
  console.log(`Inserted ${result.length} activity records for ${USER_ID}.`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
