'use strict';

/**
 * Linked LeetCode (D-59) and Codeforces (D-60) accounts: link, unlink, the hourly sync and the
 * profile view.
 *
 * A failed fetch never breaks anything: the account keeps its last good summary and records
 * `lastError`, and the next hour tries again. Linked numbers are shown only to their owner.
 */
const crypto = require('crypto');
const LinkedAccount = require('../models/LinkedAccount');
const LcSolve = require('../models/LcSolve');
const leetcode = require('./leetcode');
const codeforces = require('./codeforces');
const github = require('./github');
const ledger = require('./competitionLedger');
const { log } = require('./logger');

const PROVIDERS = ['leetcode', 'codeforces', 'github'];
const PRACTICE_PROVIDERS = ['leetcode', 'codeforces']; // the sites with solved problems
const PAUSE_MS = 1500; // between people in the sync: stay a light, polite client
const FRESH_MS = 45 * 60 * 1000; // two schedulers can both fire in one hour; an account refreshes once

/**
 * Fetch one profile and store it. Codeforces gives everything in one summary; LeetCode shows only
 * the last 20 accepted problems, so each new one is kept as a row with its difficulty and topics.
 */
async function pull(userId, provider, username, deps = {}) {
  const now = deps.now || Date.now();
  if (provider === 'github') {
    const g = await github.fetchProfile(username, { fetchImpl: deps.fetchImpl, now });
    const saved = await save(userId, provider, g.username, g.summary, now);
    await ledger.safely('github', () => ledger.writeDays(userId, provider, g.username, g.ledger, { keepHighest: true }));
    await ledger.safely('github pushes', () => ledger.writePushes(userId, g.username, g.pushes || []));
    return saved;
  }
  if (provider === 'codeforces') {
    const c = await codeforces.fetchProfile(username, { fetchImpl: deps.fetchImpl, now, pauseMs: deps.cfPauseMs });
    const last = (c.summary.weekly || [])[11];
    c.summary.solved7d = last ? last.solved : 0;
    const saved = await save(userId, provider, c.username, c.summary, now);
    await ledger.safely('codeforces', () => ledger.writeDays(userId, provider, c.username, c.ledger));
    return saved;
  }
  const before = await LinkedAccount.findOne({ userId, provider, username }, { 'summary.rating': 1 }).lean();
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
  const saved = await save(userId, provider, p.username, p.summary, now);
  await ledger.safely('leetcode', () => ledger.writeLeetcode(userId, p.username, before && before.summary && before.summary.rating, p.summary.rating, now));
  return saved;
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
  await ledger.safely('rename', () => ledger.removeOtherNames(userId, provider, account.username)); // a new name starts clean
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

const PROFILE_TEXT = {
  leetcode: (name, deps) => leetcode.fetchAbout(name, { fetchImpl: deps.fetchImpl }),
  codeforces: (name, deps) => codeforces.fetchNameFields(name, { fetchImpl: deps.fetchImpl, pauseMs: deps.cfPauseMs }),
  github: (name, deps) => github.fetchBio(name, { fetchImpl: deps.fetchImpl }),
};
const WHERE = {
  leetcode: 'your LeetCode "About" text',
  codeforces: 'your Codeforces first name, last name or organization',
  github: 'your GitHub bio',
};

/** Finish verification: the code must be in the public profile now. */
async function verify(userId, provider, deps = {}) {
  const a = await LinkedAccount.findOne({ userId, provider }).lean();
  if (!a) throw new leetcode.LinkError(404, 'Link the account first.');
  if (a.verifiedAt) return a;
  if (!a.verifyCode) throw new leetcode.LinkError(400, 'Ask for a code first.');
  const text = await PROFILE_TEXT[provider](a.username, deps);
  if (!text.includes(a.verifyCode)) {
    throw new leetcode.LinkError(409, `${a.verifyCode} is not in ${WHERE[provider]} yet. Save it there, then try again.`);
  }
  await LinkedAccount.updateOne({ _id: a._id }, { $set: { verifiedAt: new Date() }, $unset: { verifyCode: 1 } });
  return LinkedAccount.findById(a._id).lean();
}

/**
 * Practice rows for boards (D-62): verified accounts only. One row per person with at least one
 * verified account: problems solved in the last 7 days on both sites, totals and ratings.
 */
async function boardRows(userIds) {
  const accounts = await LinkedAccount.find({ userId: { $in: userIds }, provider: { $in: PRACTICE_PROVIDERS }, verifiedAt: { $ne: null } }).lean();
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
async function removeData(userId, provider) {
  await ledger.removeProvider(userId, provider);
  if (provider === 'leetcode') await LcSolve.deleteMany({ userId });
}

/**
 * Re-read every linked account. Returns { synced, failed, skipped }.
 * `freshMs` leaves alone accounts refreshed that recently. Once GitHub says we are over its limit,
 * the remaining GitHub accounts wait for the next run instead of spending more refused requests.
 */
async function syncAll(deps = {}) {
  const query = deps.freshMs ? { $or: [{ lastSyncAt: null }, { lastSyncAt: { $lt: new Date((deps.now || Date.now()) - deps.freshMs) } }] } : {};
  const accounts = await LinkedAccount.find(query).sort({ lastSyncAt: 1 }).lean();
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let githubLimited = false;
  for (const a of accounts) {
    if (githubLimited && a.provider === 'github') {
      skipped++;
      continue;
    }
    try {
      await pull(a.userId, a.provider, a.username, deps);
      synced++;
    } catch (err) {
      failed++;
      if (a.provider === 'github' && err.status === 503) githubLimited = true;
      await LinkedAccount.updateOne({ _id: a._id }, { $set: { lastError: err.message } });
      log.warn('linked account sync failed', { provider: a.provider, err: err.message });
    }
    if (deps.pauseMs !== 0) await new Promise((r) => setTimeout(r, deps.pauseMs || PAUSE_MS));
  }
  return { synced, failed, skipped };
}

let syncRunning = false;

/** The hourly job: starts in the background, and never overlaps itself. Returns false if one is running. */
function syncInBackground() {
  if (syncRunning) return false;
  syncRunning = true;
  syncAll({ freshMs: FRESH_MS })
    .then((r) => log.info('linked accounts sync', r))
    .catch((err) => log.error('linked accounts sync failed', { err }))
    .finally(() => { syncRunning = false; });
  return true;
}

/** The profile view: each linked account with its summary (and LeetCode's stored solves). */
async function view(userId) {
  const accounts = await LinkedAccount.find({ userId }).lean();
  const out = { leetcode: null, codeforces: null, github: null };
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

module.exports = { link, unlink, syncAll, syncInBackground, FRESH_MS, view, pull, startVerify, verify, boardRows, PROVIDERS };
