/**
 * Tests for services/leetcode.js and services/codeforces.js — reading linked LeetCode (D-59) and
 * Codeforces (D-60) profiles. Fixtures follow the real response shapes checked on 2026-11-03.
 * Run: node tests/linkedAccounts.test.js
 */
const assert = require('assert');
const leetcode = require('../services/leetcode');
const codeforces = require('../services/codeforces');

let passed = 0;
let failed = 0;
const pending = [];
function check(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  PASS  ${name}`); },
    (err) => { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); },
  ));
}

console.log('\nlinkedAccounts');

const NOW = Date.UTC(2026, 10, 3, 12, 0);
const day = (daysAgo) => String(Math.floor((NOW - daysAgo * 864e5) / 864e5) * 86400);
const lcBody = {
  data: {
    matchedUser: {
      username: 'Asha_01',
      submitStats: { acSubmissionNum: [{ difficulty: 'All', count: 50 }, { difficulty: 'Easy', count: 30 }, { difficulty: 'Medium', count: 18 }, { difficulty: 'Hard', count: 2 }] },
      tagProblemCounts: {
        fundamental: [{ tagName: 'Array', problemsSolved: 25 }, { tagName: 'String', problemsSolved: 0 }],
        intermediate: [{ tagName: 'Hash Table', problemsSolved: 12 }],
        advanced: [{ tagName: 'Dynamic Programming', problemsSolved: 3 }],
      },
      submissionCalendar: JSON.stringify({ [day(1)]: 3, [day(10)]: 1, [day(40)]: 5 }),
    },
    recentAcSubmissionList: [{ title: 'Two Sum', titleSlug: 'two-sum', timestamp: String(NOW / 1000 - 3600) }],
    userContestRanking: { rating: 1534.62 },
  },
};

check('LeetCode: solved by difficulty, topics sorted (zeros dropped), active days in 30, rating, recent solves', () => {
  const p = leetcode.parseProfile(lcBody, { now: NOW });
  assert.strictEqual(p.username, 'Asha_01');
  assert.deepStrictEqual(p.summary.solved, { all: 50, easy: 30, medium: 18, hard: 2 });
  assert.deepStrictEqual(p.summary.topics.map((t) => t.name), ['Array', 'Hash Table', 'Dynamic Programming']);
  assert.strictEqual(p.summary.activeDays30, 2);
  assert.strictEqual(p.summary.rating, 1535);
  assert.strictEqual(p.recent[0].titleSlug, 'two-sum');
  assert.strictEqual(p.recent[0].solvedAt.getTime(), NOW - 3600e3);
});

check('LeetCode: unknown user → 404; no contest → rating null; bad calendar → 0 days', () => {
  assert.throws(() => leetcode.parseProfile({ data: { matchedUser: null } }), (e) => e.status === 404);
  const body = JSON.parse(JSON.stringify(lcBody));
  body.data.userContestRanking = null;
  body.data.matchedUser.submissionCalendar = 'not json';
  const p = leetcode.parseProfile(body, { now: NOW });
  assert.strictEqual(p.summary.rating, null);
  assert.strictEqual(p.summary.activeDays30, 0);
});

check('LeetCode: problem difficulty and topics; missing problem → empty', () => {
  assert.deepStrictEqual(leetcode.parseProblem({ data: { question: { difficulty: 'Easy', topicTags: [{ name: 'Array' }, { name: 'Hash Table' }] } } }),
    { difficulty: 'Easy', topics: ['Array', 'Hash Table'] });
  assert.deepStrictEqual(leetcode.parseProblem({ data: { question: null } }), { difficulty: null, topics: [] });
});

check('LeetCode: a bad username is refused before any request (400)', async () => {
  let called = false;
  await assert.rejects(leetcode.fetchProfile('bad name!', { fetchImpl: () => { called = true; } }), (e) => e.status === 400);
  assert.strictEqual(called, false);
});

check('LeetCode: network failure and non-200 answers become 502', async () => {
  await assert.rejects(leetcode.fetchProfile('asha', { fetchImpl: async () => { throw new Error('ECONNRESET'); } }), (e) => e.status === 502);
  await assert.rejects(leetcode.fetchProfile('asha', { fetchImpl: async () => ({ ok: false, status: 429 }) }), (e) => e.status === 502 && /429/.test(e.message));
});

const cfSub = (t, verdict, contestId, index, rating, tags) => ({ creationTimeSeconds: t, verdict, problem: { contestId, index, name: `P${contestId}${index}`, rating, tags } });
const nowS = NOW / 1000;

check('Codeforces: rating, rank, contests, solved once per problem, difficulty bands, topics, recent solves', () => {
  const c = codeforces.parseProfile(
    { handle: 'asha_cf', rating: 1450, maxRating: 1520, rank: 'specialist' },
    [{ ratingUpdateTimeSeconds: nowS - 9e5, newRating: 1400 }, { ratingUpdateTimeSeconds: nowS - 1e5, newRating: 1450 }],
    [cfSub(nowS - 100, 'OK', 1, 'A', 800, ['math']), cfSub(nowS - 200, 'OK', 1, 'A', 800, ['math']), cfSub(nowS - 300, 'WRONG_ANSWER', 2, 'B', 1300, ['dp']),
      cfSub(nowS - 400, 'OK', 3, 'C', 1700, ['dp', 'graphs']), cfSub(nowS - 40 * 86400, 'OK', 4, 'D', null, ['greedy'])],
    { now: NOW });
  assert.strictEqual(c.username, 'asha_cf');
  const s = c.summary;
  assert.deepStrictEqual([s.rating, s.maxRating, s.rank, s.contests, s.solvedAll], [1450, 1520, 'specialist', 2, 3]);
  assert.deepStrictEqual(s.byDifficulty.map((b) => b.count), [1, 0, 1, 0]);
  assert.deepStrictEqual(s.topics.slice(0, 1), [{ name: 'dp', solved: 1 }]);
  assert.strictEqual(s.activeDays30, 1);
  assert.deepStrictEqual(s.recentSolves.map((p) => `${p.contestId}${p.index}`), ['1A', '3C', '4D']);
  assert.strictEqual(s.recentSolves[0].solvedAt.getTime(), (nowS - 200) * 1000, 'first accepted time is kept');
});

check('Codeforces: unrated user → rating null; unknown handle → 404; bad handle → 400 without a request', async () => {
  const c = codeforces.parseProfile({ handle: 'new_one' }, [], [], { now: NOW });
  assert.strictEqual(c.summary.rating, null);
  const missing = async () => ({ ok: false, status: 400, json: async () => ({ status: 'FAILED', comment: 'handles: User with handle zz not found' }) });
  await assert.rejects(codeforces.fetchProfile('zz_missing', { fetchImpl: missing, pauseMs: 0 }), (e) => e.status === 404);
  let called = false;
  await assert.rejects(codeforces.fetchProfile('a b', { fetchImpl: () => { called = true; } }), (e) => e.status === 400);
  assert.strictEqual(called, false);
});

check('Codeforces: topic tried/solved, 12 months and 12 weeks, harder-than-rating solves in 4 weeks', () => {
  const c = codeforces.parseProfile(
    { handle: 'asha_cf', rating: 1400, maxRating: 1450, rank: 'specialist' },
    [],
    [cfSub(nowS - 100, 'OK', 1, 'A', 1600, ['dp']), cfSub(nowS - 200, 'WRONG_ANSWER', 2, 'B', 1300, ['dp']),
      cfSub(nowS - 300, 'OK', 3, 'C', 1200, ['greedy']), cfSub(nowS - 60 * 86400, 'OK', 4, 'D', 1700, ['dp'])],
    { now: NOW });
  const s = c.summary;
  assert.deepStrictEqual(s.tagStats.find((t) => t.name === 'dp'), { name: 'dp', tried: 3, solved: 2, acRate: 0.67 });
  assert.strictEqual(s.monthly.length, 12);
  assert.strictEqual(s.monthly[11].month, new Date(NOW).toISOString().slice(0, 7));
  assert.deepStrictEqual([s.monthly[11].solved, s.monthly[11].maxRating], [2, 1600]);
  assert.strictEqual(s.weekly.length, 12);
  assert.strictEqual(s.weekly[11].solved, 2);
  assert.deepStrictEqual(s.hard28d, { solvedRated: 2, aboveRating: 1 });
});

check('LeetCode: 12 weeks of submissions and the current streak', () => {
  const body = JSON.parse(JSON.stringify(lcBody));
  const d = (ago) => String((Math.floor(NOW / 864e5) - ago) * 86400);
  body.data.matchedUser.submissionCalendar = JSON.stringify({ [d(0)]: 2, [d(1)]: 1, [d(2)]: 4, [d(4)]: 9, [d(20)]: 5 });
  const p = leetcode.parseProfile(body, { now: NOW });
  assert.strictEqual(p.summary.streak, 3);
  assert.strictEqual(p.summary.weekly.length, 12);
  assert.strictEqual(p.summary.weekly[11].submissions, 16);
  assert.strictEqual(p.summary.weekly[9].submissions, 5);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
