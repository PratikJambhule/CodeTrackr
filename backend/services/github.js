'use strict';

/**
 * GitHub by username (plan slice 2, D-67): the public profile and public events feed.
 *
 * Only public activity is visible this way, and GitHub keeps roughly the last 300 events or 30 days.
 * GitHub stamps `created_at` itself, so changing a commit's date can't move an event.
 * We keep counts, times and public repo names. Never commit messages, branch names or code.
 *
 * Without GITHUB_TOKEN, GitHub allows 60 requests an hour for the whole server; with it, 5,000.
 */
const { LinkError } = require('./leetcode');
const { githubDays } = require('./competition');

const API = 'https://api.github.com';
const USERNAME = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/;
const TIMEOUT_MS = 15000;
const PER_PAGE = 100;
const MAX_PAGES = 3; // the feed stops at about 300 events
const WINDOW_MS = 30 * 60 * 1000;
const DAY_MS = 864e5;

function headers() {
  const h = { 'User-Agent': 'CodeTrackr', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function get(path, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${API}${path}`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new LinkError(502, 'Could not reach GitHub. Try again later.');
  }
  if (res.status === 404) throw new LinkError(404, 'No GitHub user with that username.');
  if (res.status === 403 || res.status === 429) throw new LinkError(503, 'GitHub is limiting requests right now. Try again in an hour.');
  if (!res.ok) throw new LinkError(502, `GitHub answered ${res.status}. Try again later.`);
  return res.json();
}

function checkName(username) {
  if (!USERNAME.test(username)) throw new LinkError(400, 'That does not look like a GitHub username.');
}

const isMerge = (e) => e.payload && (e.payload.action === 'merged' || (e.payload.action === 'closed' && e.payload.pull_request && e.payload.pull_request.merged === true));

/** Pure: the profile and events → the summary we store. */
function parseActivity(profile, events, { now = Date.now(), truncated = false } = {}) {
  const inDays = (e, days) => now - new Date(e.created_at).getTime() <= days * DAY_MS;
  const recent = events.filter((e) => inDays(e, 30));
  const pushes = recent.filter((e) => e.type === 'PushEvent');
  const pushes7 = pushes.filter((e) => inDays(e, 7));
  const windows = (list) => new Set(list.map((e) => Math.floor(new Date(e.created_at).getTime() / WINDOW_MS))).size;

  const perRepo = new Map();
  for (const e of pushes) perRepo.set(e.repo.name, (perRepo.get(e.repo.name) || 0) + 1);

  const weekly = Array.from({ length: 4 }, (_, i) => {
    const newest = now - (3 - i) * 7 * DAY_MS;
    const oldest = newest - 7 * DAY_MS;
    return {
      weekEnding: new Date(newest).toISOString().slice(0, 10),
      pushes: pushes.filter((e) => { const t = new Date(e.created_at).getTime(); return t > oldest && t <= newest; }).length,
    };
  });

  const newestFirst = [...pushes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const prs = recent.filter((e) => e.type === 'PullRequestEvent');
  return {
    publicRepos: profile.public_repos || 0,
    pushes7d: pushes7.length,
    pushes30d: pushes.length,
    activeWindows7d: windows(pushes7),
    activeWindows30d: windows(pushes),
    activeDays30: new Set(pushes.map((e) => e.created_at.slice(0, 10))).size,
    mergedPrs30d: prs.filter(isMerge).length,
    openedPrs30d: prs.filter((e) => e.payload && e.payload.action === 'opened').length,
    repos30d: perRepo.size,
    topRepos: [...perRepo].map(([name, count]) => ({ name, pushes: count })).sort((a, b) => b.pushes - a.pushes || a.name.localeCompare(b.name)).slice(0, 5),
    lastPushAt: newestFirst.length ? newestFirst[0].created_at : null,
    recentPushes: newestFirst.slice(0, 5).map((e) => ({ repo: e.repo.name, at: e.created_at })),
    weekly,
    truncated, // the feed ran out before 30 days, so a very busy account may be undercounted
  };
}

/** Read one account. Throws LinkError with a message that is safe to show. */
async function fetchProfile(username, { fetchImpl = fetch, now = Date.now() } = {}) {
  checkName(username);
  const profile = await get(`/users/${username}`, fetchImpl);
  const events = [];
  let reachedOld = false;
  let lastPageFull = false;
  for (let page = 1; page <= MAX_PAGES && !reachedOld; page++) {
    const batch = await get(`/users/${username}/events/public?per_page=${PER_PAGE}&page=${page}`, fetchImpl);
    events.push(...batch);
    lastPageFull = batch.length === PER_PAGE;
    reachedOld = batch.some((e) => now - new Date(e.created_at).getTime() > 30 * DAY_MS);
    if (!lastPageFull) break;
  }
  return {
    username: profile.login,
    pushes: events.filter((e) => e.type === 'PushEvent' && now - new Date(e.created_at).getTime() <= 30 * DAY_MS)
      .map((e) => ({ id: String(e.id || `${e.created_at}:${e.repo && e.repo.name}`), at: e.created_at, repo: e.repo ? e.repo.name : null })),
    ledger: githubDays(events.filter((e) => now - new Date(e.created_at).getTime() <= 30 * DAY_MS)),
    summary: parseActivity(profile, events, { now, truncated: lastPageFull && !reachedOld }),
  };
}

/** The public bio, where the verification code goes. */
async function fetchBio(username, { fetchImpl = fetch } = {}) {
  checkName(username);
  const profile = await get(`/users/${username}`, fetchImpl);
  return profile.bio || '';
}

module.exports = { fetchProfile, fetchBio, parseActivity };
