'use strict';

/**
 * LeetCode by username (D-59). LeetCode has no official API; this reads the same public GraphQL
 * endpoint its profile page uses (shapes checked on 2026-11-03). It can change without notice, so
 * every caller treats a failure as "try again tomorrow", never as an app error.
 *
 * Only public profile data: solved counts, solved per topic, the daily calendar, the last 20
 * accepted problems and the contest rating. No login, no submission code.
 */

const ENDPOINT = 'https://leetcode.com/graphql';
const USERNAME = /^[A-Za-z0-9_-]{1,40}$/;
const TIMEOUT_MS = 10000;

const PROFILE_QUERY = `query profile($u: String!) {
  matchedUser(username: $u) {
    username
    submitStats { acSubmissionNum { difficulty count } }
    tagProblemCounts {
      advanced { tagName problemsSolved }
      intermediate { tagName problemsSolved }
      fundamental { tagName problemsSolved }
    }
    submissionCalendar
  }
  recentAcSubmissionList(username: $u, limit: 20) { title titleSlug timestamp }
  userContestRanking(username: $u) { rating }
}`;

const PROBLEM_QUERY = `query problem($s: String!) { question(titleSlug: $s) { difficulty topicTags { name } } }`;
const ABOUT_QUERY = `query about($u: String!) { matchedUser(username: $u) { profile { aboutMe } } }`;

/** An expected failure with a message written for the person linking: safe to show them. */
class LinkError extends Error {
  constructor(status, message) { super(message); this.status = status; this.publicMessage = message; }
}

async function post(query, variables, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', referer: 'https://leetcode.com' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new LinkError(502, 'Could not reach LeetCode. Try again later.');
  }
  if (!res.ok) throw new LinkError(502, `LeetCode answered ${res.status}. Try again later.`);
  return res.json();
}

/** Pure: the profile response → the summary we store. Throws 404 for an unknown username. */
function parseProfile(body, { now = Date.now() } = {}) {
  const data = (body && body.data) || {};
  const user = data.matchedUser;
  if (!user) throw new LinkError(404, 'No LeetCode user with that name.');

  const solved = { all: 0, easy: 0, medium: 0, hard: 0 };
  for (const row of (user.submitStats && user.submitStats.acSubmissionNum) || []) {
    const key = String(row.difficulty || '').toLowerCase();
    if (key in solved) solved[key] = Number(row.count) || 0;
  }

  const tags = user.tagProblemCounts || {};
  const topics = ['fundamental', 'intermediate', 'advanced']
    .flatMap((level) => tags[level] || [])
    .filter((t) => t.problemsSolved > 0)
    .map((t) => ({ name: t.tagName, solved: t.problemsSolved }))
    .sort((a, b) => b.solved - a.solved || a.name.localeCompare(b.name));

  // submissionCalendar is a JSON string: { "<unix seconds at UTC midnight>": submissions }.
  let calendar = {};
  try { calendar = JSON.parse(user.submissionCalendar || '{}'); } catch { calendar = {}; }
  const since = (now - 30 * 864e5) / 1000;
  const activeDays30 = Object.entries(calendar).filter(([day, n]) => Number(day) >= since && n > 0).length;
  // The calendar counts submissions (not solves) per UTC day. Weekly totals for 12 weeks, and the
  // current streak of days with any submission, ending today or yesterday.
  const active = new Set(Object.entries(calendar).filter(([, n]) => n > 0).map(([day]) => Math.floor(Number(day) / 86400)));
  const today = Math.floor(now / 864e5);
  const weekly = Array.from({ length: 12 }, (_, i) => {
    const endDay = today - (11 - i) * 7;
    let submissions = 0;
    for (const [day, n] of Object.entries(calendar)) {
      const d = Math.floor(Number(day) / 86400);
      if (d > endDay - 7 && d <= endDay) submissions += Number(n) || 0;
    }
    return { weekEnd: new Date(endDay * 864e5).toISOString().slice(0, 10), submissions };
  });
  let streak = 0;
  for (let d = active.has(today) ? today : today - 1; active.has(d); d--) streak++;

  const recent = (data.recentAcSubmissionList || []).map((s) => ({
    title: s.title, titleSlug: s.titleSlug, solvedAt: new Date(Number(s.timestamp) * 1000),
  }));
  const rating = data.userContestRanking && Number.isFinite(data.userContestRanking.rating)
    ? Math.round(data.userContestRanking.rating) : null;

  return { username: user.username, summary: { solved, topics, activeDays30, rating, weekly, streak }, recent };
}

/** Pure: a problem response → { difficulty, topics }. */
function parseProblem(body) {
  const q = body && body.data && body.data.question;
  if (!q) return { difficulty: null, topics: [] };
  return { difficulty: q.difficulty || null, topics: (q.topicTags || []).map((t) => t.name) };
}

async function fetchProfile(username, { fetchImpl = fetch, now } = {}) {
  if (!USERNAME.test(username || '')) throw new LinkError(400, 'That does not look like a LeetCode username.');
  return parseProfile(await post(PROFILE_QUERY, { u: username }, fetchImpl), { now });
}

// Problem difficulty and topics never change; cache them for the life of the process.
const problemCache = new Map();
async function fetchProblem(titleSlug, { fetchImpl = fetch } = {}) {
  if (problemCache.has(titleSlug)) return problemCache.get(titleSlug);
  const p = parseProblem(await post(PROBLEM_QUERY, { s: titleSlug }, fetchImpl));
  problemCache.set(titleSlug, p);
  return p;
}

/** The profile's public "About" text, where a person puts their verification code (D-62). */
async function fetchAbout(username, { fetchImpl = fetch } = {}) {
  if (!USERNAME.test(username || '')) throw new LinkError(400, 'That does not look like a LeetCode username.');
  const body = await post(ABOUT_QUERY, { u: username }, fetchImpl);
  const user = body && body.data && body.data.matchedUser;
  if (!user) throw new LinkError(404, 'No LeetCode user with that name.');
  return (user.profile && user.profile.aboutMe) || '';
}

module.exports = { fetchProfile, fetchProblem, fetchAbout, parseProfile, parseProblem, LinkError, USERNAME };
