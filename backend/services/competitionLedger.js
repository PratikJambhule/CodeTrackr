'use strict';

/** Writes the daily ledger after each account refresh, and builds a group's weekly board from it (D-70). */
const CompetitionDay = require('../models/CompetitionDay');
const LinkedAccount = require('../models/LinkedAccount');
const LcSolve = require('../models/LcSolve');
const GitPush = require('../models/GitPush');
const { buildBoard, dayKey, leetcodeDays, KEEP_WEEKS } = require('./competition');
const { log } = require('./logger');

/**
 * Store one site's days, and drop days too old to be shown. GitHub uses $max: its feed forgets
 * old events, so a re-read must never lower a day. The others re-read what they hold, so $set is exact.
 */
async function writeDays(userId, provider, username, days, { keepHighest = false, now = Date.now() } = {}) {
  const ops = Object.entries(days).map(([day, fields]) => ({
    updateOne: {
      filter: { userId, provider, day },
      update: { $set: { username, ...(keepHighest ? {} : fields) }, ...(keepHighest ? { $max: fields } : {}) },
      upsert: true,
    },
  }));
  if (ops.length) await CompetitionDay.bulkWrite(ops, { ordered: false });
  await CompetitionDay.deleteMany({ userId, provider, day: { $lt: dayKey(now - KEEP_WEEKS * 7 * 864e5) } });
}

/** A LeetCode contest shows only as a changed rating, so it lands on the day we notice the change. */
async function writeLeetcode(userId, username, oldRating, newRating, now) {
  const since = new Date(now - KEEP_WEEKS * 7 * 864e5);
  const solves = await LcSolve.find({ userId, solvedAt: { $gte: since } }, { solvedAt: 1 }).lean();
  await writeDays(userId, 'leetcode', username, leetcodeDays(solves), { now });
  if (oldRating != null && newRating != null && oldRating !== newRating) {
    await CompetitionDay.updateOne(
      { userId, provider: 'leetcode', day: dayKey(now) },
      { $set: { username }, $inc: { contests: 1 } },
      { upsert: true },
    );
  }
}

/** A ledger problem must never break the refresh itself. */
async function safely(what, fn) {
  try {
    await fn();
  } catch (err) {
    log.warn('competition ledger write failed', { what, err: err.message });
  }
}

/** Each GitHub push with its time, for hackathon boards (D-71). Already-stored pushes are left alone. */
async function writePushes(userId, username, pushes) {
  const ops = pushes.map((p) => ({
    updateOne: { filter: { userId, eventId: p.id }, update: { $setOnInsert: { username, at: new Date(p.at), repo: p.repo } }, upsert: true },
  }));
  if (ops.length) await GitPush.bulkWrite(ops, { ordered: false });
}

async function removeProvider(userId, provider) {
  await CompetitionDay.deleteMany({ userId, provider });
  if (provider === 'github') await GitPush.deleteMany({ userId });
}

async function removeOtherNames(userId, provider, username) {
  await CompetitionDay.deleteMany({ userId, provider, username: { $ne: username } });
  if (provider === 'github') await GitPush.deleteMany({ userId, username: { $ne: username } });
}

/** A group's weekly board. Only verified accounts count, and only under their current username. */
async function boardFor({ members, now = Date.now() }) {
  const ids = members.map((m) => m.id);
  const accounts = await LinkedAccount.find({ userId: { $in: ids }, verifiedAt: { $ne: null } }, { userId: 1, provider: 1, username: 1 }).lean();
  const allowed = new Set(accounts.map((a) => `${a.userId}:${a.provider}:${a.username}`));
  const rankedIds = new Set(accounts.map((a) => String(a.userId)));
  const since = dayKey(now - KEEP_WEEKS * 7 * 864e5);
  const rows = (await CompetitionDay.find({ userId: { $in: [...rankedIds] }, day: { $gte: since } }).lean())
    .filter((r) => allowed.has(`${r.userId}:${r.provider}:${r.username}`));
  const board = buildBoard({ members: members.filter((m) => rankedIds.has(m.id)), rows, now });
  return { ...board, unranked: members.filter((m) => !rankedIds.has(m.id)) };
}

module.exports = { writeDays, writeLeetcode, writePushes, safely, removeProvider, removeOtherNames, boardFor };
