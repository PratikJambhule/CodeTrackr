'use strict';

/**
 * Codeforces by handle (D-60): the official public API, no key. Three calls per sync: user.info
 * (rating, rank), user.rating (contest history) and user.status (submissions, with each problem's
 * tags and difficulty). Codeforces allows about one call every 2 seconds, so calls from this
 * process are spaced out here.
 */
const { LinkError } = require('./leetcode');
const ratingOutlook = require('./ratingOutlook');
const { codeforcesDays } = require('./competition');
const { log } = require('./logger');

const API = 'https://codeforces.com/api/';
const HANDLE = /^[A-Za-z0-9_.-]{3,24}$/;
const TIMEOUT_MS = 20000;
const PAUSE_MS = 2100;
const MAX_SUBMISSIONS = 5000;
const BANDS = [['under 1200', 0, 1199], ['1200–1599', 1200, 1599], ['1600–1999', 1600, 1999], ['2000+', 2000, Infinity]];

let lastCall = 0;
async function call(method, params, fetchImpl, pauseMs) {
  const wait = lastCall + pauseMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  let res;
  try {
    res = await fetchImpl(`${API}${method}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new LinkError(502, 'Could not reach Codeforces. Try again later.');
  }
  const body = await res.json().catch(() => null);
  if (body && body.status === 'OK') return body.result;
  if (body && /not found/i.test(body.comment || '')) throw new LinkError(404, 'No Codeforces user with that handle.');
  throw new LinkError(502, `Codeforces answered ${res.status}. Try again later.`);
}

/** The rating outlook (D-63); a model problem must never break the sync, so it degrades to none. */
function safeOutlook(ratingHistory, submissions, now) {
  try {
    return ratingOutlook.outlook(ratingHistory, submissions, now);
  } catch (err) {
    log.warn('rating outlook failed', { err: err.message });
    return { eligible: false, reason: 'not available right now' };
  }
}

/** Pure: the three API answers → the summary we store. */
function parseProfile(info, ratingHistory, submissions, { now = Date.now() } = {}) {
  const solved = new Map();
  for (const s of submissions) {
    if (s.verdict !== 'OK') continue;
    const key = `${s.problem.contestId}${s.problem.index}`;
    if (!solved.has(key) || solved.get(key).t > s.creationTimeSeconds) {
      solved.set(key, { t: s.creationTimeSeconds, key, contestId: s.problem.contestId, index: s.problem.index, name: s.problem.name, rating: s.problem.rating || null, tags: s.problem.tags || [] });
    }
  }
  const list = [...solved.values()];
  const tagCount = new Map();
  for (const p of list) for (const t of p.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const since = now / 1000 - 30 * 86400;

  // Per topic: problems tried vs solved, so a topic you attempt often but rarely get accepted stands out.
  const tried = new Map();
  for (const s of submissions) {
    const key = `${s.problem.contestId}${s.problem.index}`;
    for (const t of s.problem.tags || []) {
      if (!tried.has(t)) tried.set(t, new Set());
      tried.get(t).add(key);
    }
  }
  const tagStats = [...tried].map(([name, keys]) => {
    const ok = tagCount.get(name) || 0;
    return { name, tried: keys.size, solved: ok, acRate: keys.size ? Math.round((ok / keys.size) * 100) / 100 : 0 };
  }).sort((a, b) => b.solved - a.solved || a.name.localeCompare(b.name));

  // Difficulty progress: per month (last 12), how many solved and how hard (problem rating).
  const monthKey = (t) => new Date(t * 1000).toISOString().slice(0, 7);
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const monthly = months.map((month) => {
    const inMonth = list.filter((p) => monthKey(p.t) === month);
    const rated = inMonth.filter((p) => p.rating).map((p) => p.rating);
    return { month, solved: inMonth.length, avgRating: rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : null, maxRating: rated.length ? Math.max(...rated) : null };
  });

  // Problems solved per week, last 12 weeks (week = 7 days ending now).
  const weekly = Array.from({ length: 12 }, (_, i) => {
    const end = now / 1000 - (11 - i) * 7 * 86400;
    return { weekEnd: new Date(end * 1000).toISOString().slice(0, 10), solved: list.filter((p) => p.t > end - 7 * 86400 && p.t <= end).length };
  });

  // Of the last 4 weeks' solves, how many were above the current rating (+100): the strongest practice
  // signal for rating growth in our study of ~37k Codeforces users (ml/README).
  const recent = list.filter((p) => p.t >= now / 1000 - 28 * 86400 && p.rating);
  const above = info.rating ? recent.filter((p) => p.rating >= info.rating + 100).length : 0;

  const ledger = codeforcesDays(list, ratingHistory, now);
  return {
    username: info.handle,
    ledger,
    summary: {
      rating: info.rating ?? null,
      maxRating: info.maxRating ?? null,
      rank: info.rank || null,
      contests: ratingHistory.length,
      solvedAll: list.length,
      byDifficulty: BANDS.map(([label, lo, hi]) => ({ label, count: list.filter((p) => p.rating && p.rating >= lo && p.rating <= hi).length })),
      topics: [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([name, count]) => ({ name, solved: count })),
      activeDays30: new Set(submissions.filter((s) => s.creationTimeSeconds >= since).map((s) => Math.floor(s.creationTimeSeconds / 86400))).size,
      ratingHistory: ratingHistory.slice(-200).map((r) => ({ t: r.ratingUpdateTimeSeconds, rating: r.newRating })),
      tagStats,
      monthly,
      weekly,
      hard28d: { solvedRated: recent.length, aboveRating: above },
      outlook: safeOutlook(ratingHistory, submissions, now),
      recentSolves: list.sort((a, b) => b.t - a.t).slice(0, 5)
        .map((p) => ({ title: p.name, contestId: p.contestId, index: p.index, rating: p.rating, tags: p.tags, solvedAt: new Date(p.t * 1000) })),
    },
  };
}

async function fetchProfile(handle, { fetchImpl = fetch, now, pauseMs = PAUSE_MS } = {}) {
  if (!HANDLE.test(handle || '')) throw new LinkError(400, 'That does not look like a Codeforces handle.');
  const [info] = await call('user.info', { handles: handle }, fetchImpl, pauseMs);
  const history = await call('user.rating', { handle }, fetchImpl, pauseMs);
  const subs = await call('user.status', { handle, from: 1, count: MAX_SUBMISSIONS }, fetchImpl, pauseMs);
  return parseProfile(info, history, subs, { now });
}

/** Public first name, last name and organization, where a person puts their verification code (D-62). */
async function fetchNameFields(handle, { fetchImpl = fetch, pauseMs = PAUSE_MS } = {}) {
  if (!HANDLE.test(handle || '')) throw new LinkError(400, 'That does not look like a Codeforces handle.');
  const [info] = await call('user.info', { handles: handle }, fetchImpl, pauseMs);
  return [info.firstName, info.lastName, info.organization].filter(Boolean).join(' ');
}

module.exports = { fetchProfile, fetchNameFields, parseProfile, HANDLE };
