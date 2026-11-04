/**
 * Tests for services/practiceAnalytics.js — one practice view over linked LeetCode and Codeforces
 * (D-61). Run: node tests/practiceAnalytics.test.js
 */
const assert = require('assert');
const { practiceAnalytics, GAP_BELOW } = require('../services/practiceAnalytics');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\npracticeAnalytics');

const leetcode = { summary: {
  solved: { all: 40, easy: 25, medium: 13, hard: 2 },
  topics: [{ name: 'Array', solved: 30 }, { name: 'Tree', solved: 6 }, { name: 'Binary Tree', solved: 8 }, { name: 'Dynamic Programming', solved: 3 }],
  rating: 1600, streak: 4, activeDays30: 12,
  weekly: Array.from({ length: 12 }, (_, i) => ({ weekEnd: `w${i}`, submissions: i })),
} };
const codeforces = { summary: {
  rating: 1400, maxRating: 1450, rank: 'specialist', contests: 20, solvedAll: 60, activeDays30: 9,
  tagStats: [{ name: 'dp', tried: 10, solved: 4, acRate: 0.4 }, { name: 'greedy', tried: 3, solved: 3, acRate: 1 }],
  weekly: Array.from({ length: 12 }, (_, i) => ({ weekEnd: `w${i}`, solved: 2 })),
  monthly: [{ month: '2026-10', solved: 5, avgRating: 1300, maxRating: 1600 }],
  hard28d: { solvedRated: 10, aboveRating: 3 },
  byDifficulty: [{ label: 'under 1200', count: 30 }],
  ratingHistory: [{ t: 1, rating: 1400 }],
} };

check('topics merge both sites; several tags of one site count once (the larger)', () => {
  const p = practiceAnalytics({ leetcode, codeforces });
  const by = Object.fromEntries(p.topics.map((t) => [t.topic, t]));
  assert.deepStrictEqual([by.Trees.leetcode, by.Trees.codeforces], [8, 0]);
  assert.deepStrictEqual([by['Dynamic programming'].leetcode, by['Dynamic programming'].codeforces, by['Dynamic programming'].total], [3, 4, 7]);
  assert.strictEqual(by['Dynamic programming'].cfAcceptance, 0.4);
  assert.strictEqual(by.Greedy.cfAcceptance, null, 'under 5 attempts: no acceptance rate');
});

check(`gaps = core interview topics with fewer than ${GAP_BELOW} solved; strongest = top 3 by total`, () => {
  const p = practiceAnalytics({ leetcode, codeforces });
  assert.ok(p.gaps.includes('Graphs') && p.gaps.includes('Greedy'));
  assert.ok(!p.gaps.includes('Arrays') && !p.gaps.includes('Dynamic programming') && !p.gaps.includes('Math'));
  assert.deepStrictEqual(p.strongest, ['Arrays', 'Trees', 'Dynamic programming']);
});

check('totals, weekly activity side by side, harder-than-rating share', () => {
  const p = practiceAnalytics({ leetcode, codeforces });
  assert.strictEqual(p.totals.solved, 100);
  assert.strictEqual(p.totals.solved7d, 0);
  assert.strictEqual(p.outlook, null, 'no outlook stored yet');
  assert.deepStrictEqual(p.weeks[11], { weekEnd: 'w11', leetcodeSubmissions: 11, codeforcesSolved: 2 });
  assert.deepStrictEqual(p.difficulty.above28d, { solvedRated: 10, aboveRating: 3, share: 0.3 });
  assert.deepStrictEqual(p.leetcodeDifficulty, { easy: 25, medium: 13, hard: 2 });
});

check('real LeetCode tag names map to topics (Graph Theory, Heap)', () => {
  const p = practiceAnalytics({ leetcode: { summary: { topics: [{ name: 'Graph Theory', solved: 34 }, { name: 'Heap', solved: 6 }] } }, codeforces: null });
  const by = Object.fromEntries(p.topics.map((t) => [t.topic, t.total]));
  assert.deepStrictEqual([by.Graphs, by.Heaps], [34, 6]);
});

check('works with one site, or none linked', () => {
  const only = practiceAnalytics({ leetcode, codeforces: null });
  assert.deepStrictEqual(only.linked, { leetcode: true, codeforces: false });
  assert.strictEqual(only.difficulty, null);
  const none = practiceAnalytics({ leetcode: null, codeforces: null });
  assert.strictEqual(none.totals.solved, 0);
  assert.ok(none.topics.every((t) => t.core && t.total === 0));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
