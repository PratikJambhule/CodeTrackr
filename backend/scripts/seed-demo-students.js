#!/usr/bin/env node
/**
 * Add 100 DEMO students (invented Mumbai names), about 1, 2, 3 or 4 hours of coding each
 * (give or take under 30 minutes) over 3 weeks, to the database the
 * MONGO_URI points at, so the leaderboard, groups and dashboards look like a busy class.
 *
 * DEMO DATA ONLY: these people do not exist. Every demo account has a googleId starting with
 * `demo-student-` and an @demo.codetrackr.test email; `--remove` deletes them and everything they
 * own (activity, totals, saved sessions, group memberships, the demo group). Do not quote numbers
 * that include them as real usage.
 *
 *   node scripts/seed-demo-students.js                         dry run: what would be written
 *   node scripts/seed-demo-students.js --apply                 write it
 *   node scripts/seed-demo-students.js --apply --add-member you@gmail.com,friend@gmail.com
 *                                                              also put these real accounts in the
 *                                                              demo group "Mumbai Coders"
 *   node scripts/seed-demo-students.js --remove                dry run of the removal
 *   node scripts/seed-demo-students.js --remove --apply        delete all demo data
 *   node scripts/seed-demo-students.js --remove --keep 40 --apply
 *                                                              keep students 1-40, delete the rest
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { encodeFileKey } = require('../services/timeParts');

const MARKER = 'demo-student-';
const EMAIL_DOMAIN = 'demo.codetrackr.test';
const GROUP_NAME = 'Mumbai Coders';
const DAYS = 21;       // activity spread over the last three weeks
const TEN_MIN = 600000;
const DAY = 864e5;

const NAMES = [
  'Aditya Patil', 'Sakshi Deshmukh', 'Omkar Jadhav', 'Pranali Shinde', 'Tanmay Kulkarni',
  'Riya Shah', 'Yash Mehta', 'Neha Joshi', 'Siddhesh Pawar', 'Shruti Naik',
  'Harsh Gupta', 'Mansi Sawant', 'Vedant Chavan', 'Kshitij More', 'Aishwarya Gaikwad',
  'Rohit Kadam', 'Pooja Iyer', 'Nikhil Nair', 'Tejas Bhosale', 'Anushka Rane',
  'Kunal Thakur', 'Isha Desai', 'Atharva Salunkhe', 'Simran Kaur', 'Varun Rao',
  'Ishita Parab', 'Sahil Khan', 'Dhruv Mistry', 'Gauri Patkar', 'Ayush Pandey',
  'Mihir Sathe', 'Rutuja Ghag', 'Parth Lokhande', 'Komal Wagh', 'Chinmay Apte',
  'Sneha Mhatre', 'Abhishek Yadav', 'Prachi Kamble', 'Rahul Shetty', 'Tanvi Dalvi',
  'Soham Karnik', 'Payal Solanki', 'Nishant Dubey', 'Vaishnavi Kale', 'Jay Bhanushali',
  'Aarti Pillai', 'Om Ghadge', 'Rucha Bapat', 'Shreyas Mane', 'Kriti Agarwal',
  'Ninad Sapre', 'Bhakti Pednekar', 'Hrishikesh Lad', 'Diksha Tiwari', 'Akash Jain',
  'Sayali Gawde', 'Aman Sheikh', 'Mrunal Karande', 'Pratham Vora', 'Jui Phadke',
  'Saurabh Kamath', 'Rasika Salvi', 'Meet Chheda', 'Ketaki Bhave', 'Raj Malhotra',
  'Yogesh Tambe', 'Nidhi Kotian', 'Aniket Sonawane', 'Hetal Parekh', 'Rohan Fernandes',
  'Ankita Jagtap', 'Vivek Rawal', 'Pallavi Ingle', 'Darshan Shirke', 'Monika Thorat',
  'Ganesh Nikam', 'Swara Oak', 'Kaustubh Phatak', 'Pooja Narvekar', 'Amey Joglekar',
  'Shweta Waghmare', 'Kartik Hegde', 'Devika Menon', 'Rishi Kapoor', 'Ritika Bansal',
  'Akshay Ghorpade', 'Namrata Kelkar', 'Sanket Dhuri', 'Pranav Bhide', 'Madhura Gokhale',
  'Hemant Rathod', 'Tanya Dsouza', 'Sumit Mahajan', 'Avani Purohit', 'Jayesh Koli',
  'Neel Sawardekar', 'Charmi Thakkar', 'Abhijeet Gurav', 'Rashmi Borkar', 'Lokesh Shetye',
];

// project -> [language, files, kind of work]
const PROJECTS = {
  'dsa-practice': [['cpp', ['two_sum.cpp', 'dijkstra.cpp', 'knapsack.cpp'], 'dsa'], ['python', ['merge_intervals.py', 'lru_cache.py'], 'dsa']],
  'college-mini-project': [['java', ['Main.java', 'Library.java'], 'project'], ['sql', ['schema.sql'], 'project']],
  'portfolio-site': [['typescriptreact', ['App.tsx', 'Navbar.tsx'], 'project'], ['css', ['styles.css'], 'project']],
  'hackathon-app': [['javascript', ['server.js', 'routes.js'], 'project'], ['json', ['package.json'], 'setup']],
  'ml-assignment': [['python', ['train.py', 'notebook_utils.py'], 'project'], ['markdown', ['README.md'], 'learning']],
  'react-course': [['javascript', ['App.jsx', 'Counter.jsx'], 'learning']],
};
const PROJECT_NAMES = Object.keys(PROJECTS);

/** Deterministic random numbers, so the same seed always plans the same data. */
function generator(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** One 10-minute bucket of activity for a student (fields as extension 2.6.0 uploads them). */
function bucket(rnd, student, t, project) {
  const options = PROJECTS[project];
  const [language, files, kind] = options[Math.floor(rnd() * options.length)];
  const fileName = files[Math.floor(rnd() * files.length)];
  const duration = 360 + Math.round(rnd() * 4) * 60; // 6-10 active minutes
  const writing = Math.round(duration * (kind === 'learning' ? 0.15 : 0.35 + rnd() * 0.3));
  const running = Math.round((duration - writing) * (kind === 'dsa' ? 0.3 : 0.1));
  const reading = duration - writing - running;
  const lines = kind === 'learning' || kind === 'setup' ? Math.round(rnd() * 5) : Math.round(rnd() * 45);
  const removed = Math.round(lines * rnd() * 0.4);
  const compiles = kind === 'dsa' ? Math.round(rnd() * 3) : 0;
  const builds = kind === 'project' && rnd() < 0.3 ? 1 : 0;
  const tests = kind === 'project' && rnd() < 0.2 ? 1 : 0;
  const installs = kind === 'setup' ? 1 + Math.round(rnd() * 2) : 0;
  const runs = Math.round(rnd() * 2);
  const failedCompile = compiles && rnd() < 0.3 ? 1 : 0;
  const failedBuild = builds && rnd() < 0.25 ? 1 : 0;
  const failedTest = tests && rnd() < 0.35 ? 1 : 0;
  const git = rnd() < 0.15 ? 1 : 0;
  const total = compiles + builds + tests + installs + runs + git;
  const failed = failedCompile + failedBuild + failedTest;
  return {
    student,
    fileName, files: [fileName], language, projectName: project,
    duration, claimedDuration: duration, timestamp: new Date(t), bucketStart: new Date(t), flushCount: 1,
    linesAdded: lines, linesRemoved: removed,
    writingSec: writing, readingSec: reading, runningSec: running,
    fileTime: { [encodeFileKey(fileName)]: { seconds: duration, writing, reading, running, language } },
    editorAnalytics: { charsInserted: lines * 28, saveCount: Math.round(rnd() * 4), readMs: reading * 1000, writeMs: writing * 1000, linesInserted: lines, linesDeleted: removed },
    focusAnalytics: { focusedMs: duration * 1000, longestBlockMs: duration * 1000 },
    terminalAnalytics: {
      totalCommands: total, failedCommands: failed, successfulCommands: total - failed,
      buildRuns: builds + compiles, failedBuilds: failedBuild + failedCompile, successfulBuilds: builds + compiles - failedBuild - failedCompile,
      testRuns: tests,
      commandKinds: { compile: compiles, build: builds, test: tests, install: installs, run: runs, git,
        failed: { compile: failedCompile, build: failedBuild, test: failedTest } },
    },
    gitAnalytics: { commits: kind === 'project' && rnd() < 0.18 ? 1 : 0 },
  };
}

/**
 * Pure: the students and their activity buckets, ending at `now`. Each student has their own habit:
 * how often they code, how long, and morning or evening (India time).
 */
function plan({ now = Date.now(), seed = 20261102 } = {}) {
  const rnd = generator(seed);
  const students = NAMES.map((name, i) => ({
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${EMAIL_DOMAIN}`,
    googleId: `${MARKER}${String(i + 1).padStart(2, '0')}`,
  }));
  const docs = [];
  const todayStart = Math.floor(now / DAY) * DAY;
  const hours = [];
  students.forEach((_, i) => {
    // About 1, 2, 3 or 4 hours each, give or take under 30 minutes. A session's last bucket can stop
    // up to 10 minutes short of the target, so the target itself sits 20 min below to 29 min above.
    const base = 1 + Math.floor(rnd() * 4);
    const target = base * 3600 + (-20 + rnd() * 49) * 60;
    hours.push(base);
    const evening = rnd() < 0.7;
    const mine = [...PROJECT_NAMES].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 2));
    const seen = new Set();
    let total = 0;
    // A few sessions of 30-90 minutes on random days, until the person reaches their total.
    for (let tries = 0; total < target && tries < 200; tries++) {
      const d = Math.floor(rnd() * DAYS);
      // evening 19:00-00:30 IST = 13:30-19:00 UTC; morning 09:30-12:30 IST = 04:00-07:00 UTC
      const hourUtc = evening ? 13.5 + rnd() * 5.5 : 4 + rnd() * 3;
      const start = Math.floor((todayStart - d * DAY + hourUtc * 3600e3) / TEN_MIN) * TEN_MIN;
      const minutes = 30 + Math.floor(rnd() * 7) * 10;
      const project = mine[Math.floor(rnd() * mine.length)];
      for (let t = start; t < start + minutes * 60e3 && t < now - TEN_MIN; t += TEN_MIN) {
        const doc = bucket(rnd, i, t, project);
        if (total + doc.duration > target) break;
        const key = `${doc.projectName}|${doc.language}|${t}`; // the unique bucket index
        if (!seen.has(key)) { seen.add(key); docs.push(doc); total += doc.duration; }
      }
    }
  });
  return { students, docs, hours };
}

/** All-time totals per student, as services/userStats.js keeps them for the leaderboard. */
function totals(docs) {
  const by = new Map();
  for (const d of docs) {
    const t = by.get(d.student) || { totalSeconds: 0, linesAdded: 0, linesRemoved: 0, commits: 0, flushes: 0,
      totalCommands: 0, failedCommands: 0, buildRuns: 0, failedBuilds: 0, projects: new Set(), lastActiveAt: null };
    t.totalSeconds += d.duration; t.linesAdded += d.linesAdded; t.linesRemoved += d.linesRemoved;
    t.commits += d.gitAnalytics.commits; t.flushes += 1;
    t.totalCommands += d.terminalAnalytics.totalCommands; t.failedCommands += d.terminalAnalytics.failedCommands;
    t.buildRuns += d.terminalAnalytics.buildRuns; t.failedBuilds += d.terminalAnalytics.failedBuilds;
    t.projects.add(d.projectName);
    if (!t.lastActiveAt || d.timestamp > t.lastActiveAt) t.lastActiveAt = d.timestamp;
    by.set(d.student, t);
  }
  for (const t of by.values()) { t.codeChanges = t.linesAdded + t.linesRemoved; t.projects = [...t.projects]; }
  return by;
}

async function seed({ apply, addMembers }) {
  const User = require('../models/user');
  const Activity = require('../models/Activity');
  const UserStats = require('../models/UserStats');
  const Group = require('../models/Group');
  const GroupMember = require('../models/GroupMember');

  const existing = await User.countDocuments({ googleId: { $regex: `^${MARKER}` } });
  if (existing) throw new Error(`${existing} demo students already exist. Run --remove --apply first.`);
  const extra = addMembers.length ? await User.find({ email: { $in: addMembers } }, { name: 1, email: 1 }).lean() : [];
  const missing = addMembers.filter((e) => !extra.some((u) => u.email === e));
  if (missing.length) throw new Error(`No account with email: ${missing.join(', ')}`);

  const { students, docs } = plan();
  const sums = totals(docs);
  console.log(`\nStudents: ${students.length}   activity buckets: ${docs.length}   days: ${DAYS}`);
  [...sums.entries()].sort((a, b) => b[1].totalSeconds - a[1].totalSeconds).slice(0, 5)
    .forEach(([i, t]) => console.log(`  ${students[i].name.padEnd(20)} ${(t.totalSeconds / 3600).toFixed(1)} h`));
  console.log(`  …\nGroup "${GROUP_NAME}" (public): all ${students.length} students${extra.length ? ` + ${extra.map((u) => u.email).join(', ')}` : ''}`);
  if (!apply) return;

  const users = [];
  for (const s of students) users.push(await User.create({ ...s, isFirstLogin: false }));
  for (let from = 0; from < docs.length; from += 1000) {
    await Activity.insertMany(docs.slice(from, from + 1000).map(({ student, ...d }) => ({ ...d, userId: users[student]._id })), { ordered: false });
  }
  for (const [i, t] of sums) await UserStats.updateOne({ userId: users[i]._id }, { $set: t }, { upsert: true });
  const group = await Group.create({ name: GROUP_NAME, description: 'Mumbai engineering students racing on coding hours. (Demo group)', visibility: 'public', createdBy: users[0]._id });
  for (const u of [...users, ...extra]) await GroupMember.create({ groupId: group._id, userId: u._id });
}

/** `keep` = N keeps demo students 1..N (and their group) and removes the rest. */
async function remove({ apply, keep = 0 }) {
  const User = require('../models/user');
  const models = ['Activity', 'UserStats', 'Session', 'WindowUsage', 'IngestReceipt', 'Notification', 'Goal']
    .map((n) => require(`../models/${n}`));
  const GroupMember = require('../models/GroupMember');
  const Group = require('../models/Group');

  const all = await User.find({ googleId: { $regex: `^${MARKER}` } }, { _id: 1, googleId: 1 }).lean();
  const users = all.filter((u) => Number(u.googleId.slice(MARKER.length)) > keep);
  if (keep) console.log(`\nKeeping demo students 1-${keep} (${all.length - users.length} found); removing the rest.`);
  const ids = users.map((u) => u._id);
  const anyForm = { $in: [...ids, ...ids.map(String)] }; // activities may hold either form
  const groups = await Group.find({ createdBy: { $in: ids } }, { _id: 1 }).lean();
  const groupIds = groups.map((g) => g._id);
  console.log(`\nDemo students: ${users.length}   their groups: ${groups.length}`);
  for (const M of models) console.log(`  ${M.collection.name.padEnd(16)} ${await M.countDocuments({ userId: anyForm })}`);
  if (!apply) return;
  for (const M of models) await M.deleteMany({ userId: anyForm });
  await GroupMember.deleteMany({ $or: [{ userId: { $in: ids } }, { groupId: { $in: groupIds } }] });
  await Group.deleteMany({ _id: { $in: groupIds } });
  await User.deleteMany({ _id: { $in: ids } });
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const i = args.indexOf('--add-member');
    const addMembers = i >= 0 ? String(args[i + 1] || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) : [];
    if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000, autoIndex: false, autoCreate: false }); // never build indexes or collections
    const k = args.indexOf('--keep');
    const keep = k >= 0 ? Number.parseInt(args[k + 1], 10) : 0;
    if (k >= 0 && !(keep > 0)) throw new Error('--keep needs a number, e.g. --keep 40');
    if (args.includes('--remove')) await remove({ apply, keep });
    else await seed({ apply, addMembers });
    console.log(apply ? '\nAPPLIED.\n' : '\nDRY RUN: nothing written. Add --apply to write.\n');
    await mongoose.disconnect();
  })().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { plan, totals, NAMES, MARKER, EMAIL_DOMAIN };
