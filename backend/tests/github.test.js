/**
 * Tests for services/github.js: reading a linked GitHub account's public activity (plan slice 2, D-67).
 * Event shapes follow the real public events feed, checked on 2026-11-10.
 * Run: node tests/github.test.js
 */
const assert = require('assert');
const github = require('../services/github');
const { LinkError } = require('../services/leetcode');

let passed = 0;
let failed = 0;
const pending = [];
function check(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  PASS  ${name}`); },
    (err) => { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); },
  ));
}

const NOW = Date.UTC(2026, 10, 10, 12, 0);
const ago = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const push = (hours, repo = 'asha/app') => ({ type: 'PushEvent', created_at: ago(hours), repo: { name: repo }, payload: { ref: 'refs/heads/main', head: 'a', before: 'b' } });
const pr = (hours, action, extra = {}) => ({ type: 'PullRequestEvent', created_at: ago(hours), repo: { name: 'asha/app' }, payload: { action, number: 1, pull_request: extra } });
const profile = { login: 'Asha', bio: 'hello', public_repos: 7 };

console.log('\ngithub');

check('counts pushes and 30-minute active windows, inside 7 and 30 days', () => {
  const s = github.parseActivity(profile, [push(0.9), push(1), push(2), push(24 * 10), push(24 * 40)], { now: NOW });
  assert.strictEqual(s.pushes7d, 3);
  assert.strictEqual(s.pushes30d, 4, 'older than 30 days is ignored');
  assert.strictEqual(s.activeWindows7d, 2, 'two pushes in one 30-minute window count once');
  assert.strictEqual(s.activeWindows30d, 3);
  assert.strictEqual(s.activeDays30, 2);
  assert.strictEqual(s.publicRepos, 7);
});

check('a burst of tiny pushes cannot earn more than one window', () => {
  const burst = Array.from({ length: 50 }, () => push(1));
  assert.strictEqual(github.parseActivity(profile, burst, { now: NOW }).activeWindows7d, 1);
});

check('counts merged and opened pull requests, and both ways the feed reports a merge', () => {
  const s = github.parseActivity(profile, [pr(1, 'merged'), pr(2, 'closed', { merged: true }), pr(3, 'closed', { merged: false }), pr(4, 'closed'), pr(5, 'opened')], { now: NOW });
  assert.strictEqual(s.mergedPrs30d, 2);
  assert.strictEqual(s.openedPrs30d, 1);
});

check('top repos, last push, four weekly buckets (oldest first), and no other event type counts', () => {
  const s = github.parseActivity(profile, [push(1, 'asha/b'), push(30, 'asha/a'), push(31, 'asha/a'), push(24 * 8, 'asha/a'), { type: 'WatchEvent', created_at: ago(1), repo: { name: 'x/y' } }], { now: NOW });
  assert.deepStrictEqual(s.topRepos, [{ name: 'asha/a', pushes: 3 }, { name: 'asha/b', pushes: 1 }]);
  assert.strictEqual(s.repos30d, 2);
  assert.strictEqual(s.lastPushAt, ago(1));
  assert.deepStrictEqual(s.weekly.map((w) => w.pushes), [0, 0, 1, 3]);
  assert.strictEqual(s.recentPushes[0].repo, 'asha/b');
});

check('stores no commit text or branch names', () => {
  const text = JSON.stringify(github.parseActivity(profile, [{ ...push(1), payload: { ref: 'refs/heads/secret-branch', head: 'abc123', commits: [{ message: 'private words' }] } }], { now: NOW }));
  assert.ok(!text.includes('secret-branch') && !text.includes('private words') && !text.includes('abc123'));
});

check('an account with no public activity gives zeros', () => {
  const s = github.parseActivity(profile, [], { now: NOW });
  assert.strictEqual(s.pushes7d, 0);
  assert.strictEqual(s.lastPushAt, null);
  assert.strictEqual(s.truncated, false);
});

function fakeFetch(routes, seen = []) {
  return async (url, opts) => {
    seen.push({ url, opts });
    for (const [frag, res] of routes) if (url.includes(frag)) return { status: res.status || 200, ok: (res.status || 200) < 400, json: async () => res.body };
    throw new Error(`unexpected ${url}`);
  };
}

check('fetchProfile: rejects a bad name before any request', async () => {
  const seen = [];
  await assert.rejects(github.fetchProfile('bad name/../x', { fetchImpl: fakeFetch([], seen), now: NOW }), (e) => e instanceof LinkError && e.status === 400);
  assert.strictEqual(seen.length, 0);
});

check('fetchProfile: a missing user is a clear 404', async () => {
  await assert.rejects(github.fetchProfile('nobody', { fetchImpl: fakeFetch([['/users/nobody', { status: 404, body: {} }]]), now: NOW }), (e) => e.status === 404 && /No GitHub user/.test(e.publicMessage));
});

check('fetchProfile: a rate limit says so plainly', async () => {
  await assert.rejects(github.fetchProfile('asha', { fetchImpl: fakeFetch([['/users/asha', { status: 403, body: { message: 'API rate limit exceeded' } }]]), now: NOW }), (e) => e.status === 503 && /limiting/.test(e.publicMessage));
});

check('fetchProfile: uses the canonical name, follows pages, stops at 3', async () => {
  const seen = [];
  const full = Array.from({ length: 100 }, () => push(1));
  const out = await github.fetchProfile('ASHA', { now: NOW, fetchImpl: fakeFetch([['/events/public', { body: full }], ['/users/ASHA', { body: profile }]], seen) });
  assert.strictEqual(out.username, 'Asha');
  assert.strictEqual(seen.filter((s) => s.url.includes('/events/public')).length, 3);
  assert.strictEqual(out.summary.truncated, true, 'a full feed may have hidden older events');
  assert.ok(seen[0].opts.headers['User-Agent']);
});

check('fetchProfile: stops early once the feed goes past 30 days', async () => {
  const seen = [];
  const old = Array.from({ length: 100 }, () => push(24 * 31));
  const out = await github.fetchProfile('asha', { now: NOW, fetchImpl: fakeFetch([['/events/public', { body: old }], ['/users/asha', { body: profile }]], seen) });
  assert.strictEqual(seen.filter((s) => s.url.includes('/events/public')).length, 1);
  assert.strictEqual(out.summary.truncated, false);
});

check('a server token is sent only when one is configured', async () => {
  const seen = [];
  const routes = [['/events/public', { body: [] }], ['/users/asha', { body: profile }]];
  delete process.env.GITHUB_TOKEN;
  await github.fetchProfile('asha', { now: NOW, fetchImpl: fakeFetch(routes, seen) });
  assert.strictEqual(seen[0].opts.headers.Authorization, undefined);
  process.env.GITHUB_TOKEN = 'test-token';
  await github.fetchProfile('asha', { now: NOW, fetchImpl: fakeFetch(routes, seen) });
  assert.strictEqual(seen[seen.length - 1].opts.headers.Authorization, 'Bearer test-token');
  delete process.env.GITHUB_TOKEN;
});

check('fetchBio: returns the public bio, or empty text', async () => {
  assert.strictEqual(await github.fetchBio('asha', { fetchImpl: fakeFetch([['/users/asha', { body: { bio: 'code ct-12345678' } }]]) }), 'code ct-12345678');
  assert.strictEqual(await github.fetchBio('asha', { fetchImpl: fakeFetch([['/users/asha', { body: { bio: null } }]]) }), '');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
