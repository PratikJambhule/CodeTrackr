const mongoose = require('mongoose');
const Activity = require('../models/Activity');

const DRY_RUN = process.env.DRY_RUN === 'true';

const defaultTerminalAnalytics = {
  totalCommands: 0,
  terminalErrorCount: 0,
  successfulCommands: 0,
  failedCommands: 0,
  successRate: 0,
  buildRuns: 0,
  testRuns: 0,
  successfulBuilds: 0,
  failedBuilds: 0,
  buildSuccessRate: 0,
  debuggingSessions: 0,
  commandUsage: {
    git: 0,
    npm: 0,
    node: 0,
    python: 0,
    docker: 0,
    gcc: 0,
    java: 0,
    pip: 0,
    misc: 0,
  },
  gitActivity: {
    commits: 0,
    pushes: 0,
    pulls: 0,
    checkouts: 0,
    merges: 0,
    clones: 0,
  },
  repeatedFailedCommands: [],
  lastCommand: 'unknown',
  lastCommandTimestamp: null,
};

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    family: 4,
    tls: true,
  });

  const filter = {
    $or: [
      { terminalAnalytics: { $exists: false } },
      { terminalAnalytics: null },
      { terminalAnalytics: {} },
    ],
  };

  const update = {
    $set: { terminalAnalytics: defaultTerminalAnalytics },
    $unset: {
      analysis: "",
      errorCount: "",
      terminalGitCommitCount: "",
      activeTerminalCount: "",
      terminalCommandCount: "",
    },
  };

  if (DRY_RUN) {
    const count = await Activity.countDocuments(filter);
    console.log(`[DRY RUN] Documents to update: ${count}`);
  } else {
    const result = await Activity.updateMany(filter, update);
    console.log(`Updated ${result.modifiedCount} document(s).`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
