'use strict';

/**
 * Linked LeetCode (D-59) and Codeforces (D-60) accounts: link, unlink, the nightly sync and the
 * profile view.
 *
 * A failed fetch never breaks anything: the account keeps its last good summary and records
 * `lastError`, and the next night tries again. Linked numbers are shown only to their owner.
 */
const crypto = require('crypto');
const LinkedAccount = require('../models/LinkedAccount');
const LcSolve = require('../models/LcSolve');
const leetcode = require('./leetcode');
const codeforces = require('./codeforces');
const { log } = require('./logger');

const PROVIDERS = ['leetcode', 'codeforces'];
const PAUSE_MS = 1500; // between people in the nightly sync: stay a light, polite client

/**
 * Fetch one profile and store it. Codeforces gives everything in one summary; LeetCode shows only
 * the last 20 accepted problems, so each new one is kept as a row with its difficulty and topics.
 */
async function pull(userId, provider, username, deps = {}) {
  const now = deps.now || Date.now();
  if (provider === 'codeforces') {
    const c = await codeforces.fetchProfile(username, { fetchImpl: deps.fetchImpl, now, pauseMs: deps.cfPauseMs });
    const last = (c.summary.weekly || [])[11];
    c.summary.solved7d = last ? last.solved : 0;
    return save(userId, provider, c.username, c.summary, now);
  }
  const p = await leetcode.fetchProfile(username, { fetchImpl: deps.fetchImpl, now });
  const known = new Set((await LcSolve.find({ userId, titleSlug: { $in: p.recent.map((r) => r.titleSlug) } }, { titleSlug: 1 }).lean()).map((s) => s.titleSlug));
  const fresh = p.recent.filter((s) => !known.has(s.titleSlug));
  // Up to 20 problem lookups on a first link: 5 at a time (one by one took ~9.5 s).
  for (let i = 0; i < fresh.length; i += 5) {
    await Promise.all(fresh.slice(i, i + 5).map(async (s) => {
      let meta = { difficulty: null, topics: [] };
      try { meta = await leetcode.fetchProblem(s.titleSlug, { fetchImpl: deps.fetchImpl }); } catch { /* topics are a nice-to-have */ }
      await LcSolve.updateOne({ userId, titleSlug: s.titleSlug },
        { $setOnInsert: { title: s.title, solvedAt: s.solvedAt, difficulty: meta.difficulty, topics: meta.topics } }, { upsert: true });
    }));
  }
  // Only accepted problems we have seen (LeetCode shows the last 20), so this can undercount a busy week.
  p.summary.solved7d = await LcSolve.countDocuments({ userId, solvedAt: { $gte: new Date(now - 7 * 864e5) } });
  return save(userId, provider, p.username, p.summary, now);
}

function save(userId, provider, username, summary, now) {
  return LinkedAccount.findOneAndUpdate(
    { userId, provider },
    { $set: { username, summary, lastSyncAt: new Date(now), lastError: null }, $setOnInsert: { linkedAt: new Date(now) } },
    { upsert: true, new: true },
  ).lean();
}

/** Link (or change) a username. Fails with the provider's reason, and stores nothing on failure. */
async function link(userId, provider, username, deps) {
  if (!PROVIDERS.includes(provider)) throw new leetcode.LinkError(404, 'Unknown account type.');
  const clean = String(username || '').trim().replace(/^@/, '');
  const old = await LinkedAccount.findOne({ userId, provider }).lean();
  if (old && old.username.toLowerCase() !== clean.toLowerCase()) {
    // A different person's data must not mix with the old one's; check the new name exists first.
    if (provider === 'leetcode') {
      await leetcode.fetchProfile(clean, { fetchImpl: deps && deps.fetchImpl });
      await removeData(userId, provider);
    }
  }
  const account = await pull(userId, provider, clean, deps);
  if (old && old.username.toLowerCase() !== clean.toLowerCase() && (old.verifiedAt || old.verifyCode)) {
    // A new name has to be verified again.
    await LinkedAccount.updateOne({ userId, provider }, { $unset: { verifiedAt: 1, verifyCode: 1 } });
  }
  return account;
}

/** Start verification: a short code the person puts in their public profile (D-62). */
async function startVerify(userId, provider) {
  const code = `ct-${crypto.randomBytes(4).toString('hex')}`;
  const r = await LinkedAccount.updateOne({ userId, provider }, { $set: { verifyCode: code } });
  if (!r.matchedCount) throw new leetcode.LinkError(404, 'Link the account first.');
  return code;
}

/** Finish verification: the code must be in the public profile now. */
async function verify(userId, provider, deps = {}) {
  const a = await LinkedAccount.findOne({ userId, provider }).lean();
  if (!a) throw new leetcode.LinkError(404, 'Link the account first.');
  if (a.verifiedAt) return a;
  if (!a.verifyCode) throw new leetcode.LinkError(400, 'Ask for a code first.');
  const text = provider === 'codeforces'
    ? await codeforces.fetchNameFields(a.username, { fetchImpl: deps.fetchImpl, pauseMs: deps.cfPauseMs })
    : await leetcode.fetchAbout(a.username, { fetchImpl: deps.fetchImpl });
  if (!text.includes(a.verifyCode)) {
    throw new leetcode.LinkError(409, provider === 'codeforces'
      ? `${a.verifyCode} is not in your Codeforces first name, last name or organization yet. Save it there, then try again.`
      : `${a.verifyCode} is not in your LeetCode "About" text yet. Save it there, then try again.`);
  }
  await LinkedAccount.updateOne({ _id: a._id }, { $set: { verifiedAt: new Date() }, $unset: { verifyCode: 1 } });
  return LinkedAccount.findById(a._id).lean();
}

/**
 * Practice rows for boards (D-62): verified accounts only. One row per person with at least one
 * verified account: problems solved in the last 7 days on both sites, totals and ratings.
 */
async function boardRows(userIds) {
  const accounts = await LinkedAccount.find({ userId: { $in: userIds }, verifiedAt: { $ne: null } }).lean();
  const by = new Map();
  for (const a of accounts) {
    const key = String(a.userId);
    if (!by.has(key)) by.set(key, { userId: key, solved7d: 0, solvedTotal: 0, leetcode: null, codeforces: null });
    const row = by.get(key);
    const s = a.summary || {};
    if (a.provider === 'leetcode') {
      row.leetcode = { username: a.username, solved: (s.solved && s.solved.all) || 0, solved7d: s.solved7d || 0, rating: s.rating ?? null };
    } else {
      row.codeforces = { username: a.username, solved: s.solvedAll || 0, solved7d: s.solved7d || 0, rating: s.rating ?? null, rank: s.rank || null };
    }
    row.solved7d = (row.leetcode ? row.leetcode.solved7d : 0) + (row.codeforces ? row.codeforces.solved7d : 0);
    row.solvedTotal = (row.leetcode ? row.leetcode.solved : 0) + (row.codeforces ? row.codeforces.solved : 0);
  }
  return [...by.values()].sort((x, y) => y.solved7d - x.solved7d || y.solvedTotal - x.solvedTotal);
}

/** Unlink: delete the account and everything pulled for it. */
async function unlink(userId, provider) {
  await removeData(userId, provider);
  await LinkedAccount.deleteOne({ userId, provider });
}

/** Pulled rows outside the account itself: only LeetCode keeps any (Codeforces lives in `summary`). */
function removeData(userId, provider) {
  return provider === 'leetcode' ? LcSolve.deleteMany({ userId }) : Promise.resolve();
}

/** Nightly: re-read every linked account. Returns { synced, failed }. */
async function syncAll(deps = {}) {
  const accounts = await LinkedAccount.find({}).lean();
  let synced = 0;
  let failed = 0;
  for (const a of accounts) {
    try {
      await pull(a.userId, a.provider, a.username, deps);
      synced++;
    } catch (err) {
      failed++;
      await LinkedAccount.updateOne({ _id: a._id }, { $set: { lastError: err.message } });
      log.warn('linked account sync failed', { provider: a.provider, err: err.message });
    }
    if (deps.pauseMs !== 0) await new Promise((r) => setTimeout(r, deps.pauseMs || PAUSE_MS));
  }
  return { synced, failed };
}

/** The profile view: each linked account with its summary (and LeetCode's stored solves). */
async function view(userId) {
  const accounts = await LinkedAccount.find({ userId }).lean();
  const out = { leetcode: null, codeforces: null };
  for (const a of accounts) {
    out[a.provider] = { username: a.username, linkedAt: a.linkedAt, lastSyncAt: a.lastSyncAt, lastError: a.lastError || null, summary: a.summary || {},
      verified: Boolean(a.verifiedAt), verifyCode: a.verifyCode || null };
  }
  if (out.leetcode) {
    out.leetcode.recentSolves = (await LcSolve.find({ userId }).sort({ solvedAt: -1 }).limit(10).lean())
      .map((s) => ({ title: s.title, titleSlug: s.titleSlug, solvedAt: s.solvedAt, difficulty: s.difficulty, topics: s.topics }));
  }
  return out;
}

module.exports = { link, unlink, syncAll, view, pull, startVerify, verify, boardRows, PROVIDERS };
