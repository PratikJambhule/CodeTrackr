#!/usr/bin/env node
/**
 * Real usage, not installs (roadmap item 16). READ-ONLY: it only counts.
 *
 *   node scripts/usage-report.js            # uses MONGO_URI from backend/.env
 *
 * Prints accounts, weekly and monthly active users (users whose extension
 * uploaded activity in the last 7 / 30 days), daily actives for the last 7
 * days, and groups with 2+ members. "Active" means the editor sent data, not
 * that someone opened the website, so it is the honest number for a resume.
 * The output contains counts only, never names or emails.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { USER_KEY } = require('../services/activityUser');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const activities = db.collection('activities');
  const day = 864e5;
  const now = Date.now();

  const distinctUsersSince = async (ms) => (await activities.aggregate([
    { $match: { timestamp: { $gte: new Date(now - ms) } } },
    { $group: { _id: USER_KEY } },
    { $count: 'n' },
  ]).toArray())[0]?.n || 0;

  const daily = await activities.aggregate([
    { $match: { timestamp: { $gte: new Date(now - 7 * day) } } },
    { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, u: USER_KEY } } },
    { $group: { _id: '$_id.d', users: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  const groupsWithFriends = (await db.collection('groupmembers').aggregate([
    { $group: { _id: '$groupId', members: { $sum: 1 } } },
    { $match: { members: { $gte: 2 } } },
    { $count: 'n' },
  ]).toArray())[0]?.n || 0;

  const report = {
    date: new Date().toISOString().slice(0, 10),
    accounts: await db.collection('users').countDocuments(),
    weeklyActiveUsers: await distinctUsersSince(7 * day),
    monthlyActiveUsers: await distinctUsersSince(30 * day),
    dailyActiveUsersLast7Days: daily.map((d) => ({ day: d._id, users: d.users })),
    groupsWithTwoOrMoreMembers: groupsWithFriends,
  };
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
