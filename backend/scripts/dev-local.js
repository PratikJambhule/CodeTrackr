#!/usr/bin/env node
/**
 * Run the whole backend locally with NO external accounts: the real app.js on
 * an in-memory MongoDB, AUTH_BYPASS on (refused in production), and demo data
 * rich enough for every page of the website:
 *   - you ("Soham (local)"): about ten months of activity across four projects
 *     (year heatmap, streaks, hours of day, languages, failing builds), goals
 *     and notifications;
 *   - five friends with three weeks of activity;
 *   - groups: "CSE Squad" (private, password `squad`, you are admin), "Contest
 *     Week" (public), and two you have not joined, to discover.
 * Pair it with `npm run dev` in frontend/ and open http://localhost:5173.
 *
 *   node scripts/dev-local.js        (from backend/; avoid `npm run` on Windows,
 *                                     where stopping it can orphan the server)
 *
 * Data disappears when the process stops. Never point this at a real database.
 */
const path = require('path');
const BACKEND = path.join(__dirname, '..');
const { MongoMemoryServer } = require('mongodb-memory-server');

const TEN_MIN = 600000;
const DAY = 864e5;

// Deterministic randomness, so every run shows the same demo.
let seed = 20261004;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (weighted) => {
  let r = rnd() * weighted.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of weighted) { if ((r -= w) <= 0) return v; }
  return weighted[0][0];
};

const PROJECTS = {
  codetrackr: [['typescript', 7], ['javascript', 2], ['json', 1]],
  'dsa-sheet': [['python', 6], ['cpp', 4]],
  'os-assignment': [['c', 8], ['makefile', 2]],
  portfolio: [['typescriptreact', 6], ['css', 4]],
};
const FILES = { typescript: 'app.ts', javascript: 'index.js', json: 'package.json', python: 'solution.py', cpp: 'main.cpp', c: 'shell.c', makefile: 'Makefile', typescriptreact: 'App.tsx', css: 'styles.css' };

/** Activity buckets for one coding session starting at `start` (ms, on the 10-min grid). */
function session(userId, start, minutes, project, now) {
  const docs = [];
  for (let t = start, left = minutes; left > 0 && t < now - TEN_MIN; t += TEN_MIN, left -= 10) {
    const language = pick(PROJECTS[project]);
    const duration = Math.min(10, left) * 60;
    const failing = rnd() < 0.12;
    const doc = {
      userId, fileName: FILES[language], files: [FILES[language]], language, projectName: project,
      duration, claimedDuration: duration, timestamp: new Date(t), bucketStart: new Date(t), flushCount: 1,
      linesAdded: Math.round(rnd() * 40), linesRemoved: Math.round(rnd() * 15),
      editorAnalytics: { charsInserted: Math.round(rnd() * 900), saveCount: Math.round(rnd() * 5), readMs: duration * 300, writeMs: duration * 600 },
      focusAnalytics: { focusedMs: duration * 1000, longestBlockMs: duration * 1000 },
      terminalAnalytics: {
        totalCommands: Math.round(rnd() * 5), failedCommands: failing ? 1 + Math.round(rnd()) : 0,
        successfulCommands: Math.round(rnd() * 4), buildRuns: rnd() < 0.3 ? 1 : 0, failedBuilds: failing && rnd() < 0.5 ? 1 : 0,
        successfulBuilds: rnd() < 0.25 ? 1 : 0, testRuns: rnd() < 0.2 ? 1 : 0, debuggingSessions: rnd() < 0.05 ? 1 : 0,
        commandUsage: { git: Math.round(rnd() * 2), npm: project === 'codetrackr' || project === 'portfolio' ? Math.round(rnd() * 3) : 0, python: project === 'dsa-sheet' ? Math.round(rnd() * 3) : 0, gcc: project === 'os-assignment' ? Math.round(rnd() * 3) : 0 },
        gitActivity: { commits: 0, pushes: rnd() < 0.1 ? 1 : 0, pulls: rnd() < 0.05 ? 1 : 0 },
        repeatedFailedCommands: failing && rnd() < 0.4
          ? [{ command: project === 'os-assignment' ? 'make test' : project === 'dsa-sheet' ? 'python solution.py < input.txt' : 'npm run build', count: 2 }]
          : [],
      },
      gitAnalytics: { commits: rnd() < 0.18 ? 1 : 0 },
    };
    docs.push(doc);
  }
  return docs;
}

/** `days` days of sessions for one person, ending now. */
function history(userId, days, now, { codeChance, evening = 0.7, intensity = 1 }) {
  const docs = [];
  const todayStart = Math.floor(now / DAY) * DAY; // UTC midnight; fine for demo data
  for (let d = days - 1; d >= 0; d--) {
    const recent = d < 30 ? 0.15 : 0;
    if (rnd() > codeChance + recent) continue;
    const sessions = 1 + Math.floor(rnd() * 2.4);
    for (let s = 0; s < sessions; s++) {
      // India evening (20:00-01:00 IST = 14:30-19:30 UTC) or late morning (10:00-12:00 IST).
      const hourUtc = rnd() < evening ? 14.5 + rnd() * 5 : 4.5 + rnd() * 2;
      const start = Math.floor((todayStart - d * DAY + hourUtc * 3600e3) / TEN_MIN) * TEN_MIN;
      const minutes = Math.round((30 + rnd() * 120) * intensity / 10) * 10;
      const project = pick([['codetrackr', 4], ['dsa-sheet', 3], ['os-assignment', 1.5], ['portfolio', 1.5]]);
      docs.push(...session(userId, start, minutes, project, now));
    }
  }
  return docs;
}

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

  const model = (name) => require(path.join(BACKEND, 'models', name));
  const User = model('user');
  const Activity = model('Activity');
  const Group = model('Group');
  const GroupMember = model('GroupMember');
  const Goal = model('Goal');
  const Notification = model('Notification');
  const { hashPassword } = require(path.join(BACKEND, 'services/passwordHash'));
  const { rebuildAll } = require(path.join(BACKEND, 'services/userStats'));

  const now = Date.now();
  const mk = async (name, extra = {}) => {
    const u = await User.create({ googleId: `g-${name.toLowerCase()}`, name, email: `${name.toLowerCase()}@example.test`, isFirstLogin: false, ...extra });
    u.issueApiKey();
    await u.save();
    return u;
  };
  // AUTH_BYPASS signs the website in as the user with the most activity: you.
  const me = await mk('Soham (local)');
  const friends = {};
  for (const name of ['Diya', 'Rohan', 'Aarav', 'Sneha', 'Kabir']) friends[name] = await mk(name);

  const docs = [...history(me._id, 300, now, { codeChance: 0.62 })];
  const profiles = { Diya: 0.8, Rohan: 0.75, Aarav: 0.7, Sneha: 0.6, Kabir: 0.45 };
  for (const [name, chance] of Object.entries(profiles)) {
    docs.push(...history(friends[name]._id, 21, now, { codeChance: chance, evening: 0.6, intensity: 0.9 + rnd() * 0.5 }));
  }
  // De-duplicate (user, project, language, bucket) so the unique bucket index accepts every row.
  const seen = new Set();
  const unique = docs.filter((d) => {
    const k = `${d.userId}|${d.projectName}|${d.language}|${d.bucketStart.getTime()}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  await Activity.insertMany(unique, { ordered: false });
  await rebuildAll({ apply: true });

  const group = async (name, description, creator, members, password) => {
    const g = await Group.create({
      name, description, createdBy: creator._id,
      visibility: password ? 'private' : 'public',
      password: password ? await hashPassword(password) : null,
    });
    for (const m of members) await GroupMember.create({ groupId: g._id, userId: m._id });
    return g;
  };
  const all = Object.values(friends);
  await group('CSE Squad', 'Third-year CSE friends. Weekly race, loser buys chai.', me, [me, ...all], 'squad');
  await group('Contest Week', 'One-week sprint before placements.', me, [me, friends.Diya, friends.Rohan]);
  await group('Night Owls', 'For people who code after midnight.', friends.Kabir, [friends.Kabir, friends.Aarav]);
  await group('Placement Prep', 'DSA every day until December.', friends.Sneha, [friends.Sneha], 'prep');

  const at = (days) => new Date(now + days * DAY);
  const portfolio = await Goal.create({ userId: me._id, title: 'Ship portfolio v2', description: 'New projects section and dark mode.', targetHours: 8, techStack: 'portfolio', deadline: at(3), createdAt: at(-12) });
  await Goal.create({ userId: me._id, title: 'Finish the DSA sheet', description: 'Arrays to graphs, one topic a day.', targetHours: 20, techStack: 'python', deadline: at(10), createdAt: at(-20) });
  const rust = await Goal.create({ userId: me._id, title: 'OS shell assignment', description: 'Pipes, redirection and job control.', targetHours: 6, techStack: 'c', deadline: at(-4), createdAt: at(-30), status: 'completed', completedAt: at(-5) });
  await Notification.create({ userId: me._id, goalId: portfolio._id, type: 'deadline_reminder', title: 'Deadline in 3 days', message: '“Ship portfolio v2” is due in 3 days.' });
  await Notification.create({ userId: me._id, goalId: rust._id, type: 'goal_completed', title: 'Goal completed', message: 'You completed “OS shell assignment”.', read: true });

  app.listen(5050, () => console.log(`DEV API on http://localhost:5050 (AUTH_BYPASS, in-memory DB, ${unique.length} activity buckets)`));
})().catch((e) => { console.error(e); process.exit(1); });
