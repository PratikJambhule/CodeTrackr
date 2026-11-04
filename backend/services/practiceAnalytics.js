'use strict';

/**
 * Practice analytics (D-61): one view over a person's linked LeetCode and Codeforces accounts.
 * Pure: it reads only the stored summaries (services/linkedSync.js view()), so the page is one cheap
 * request. Plain statistics, not ML.
 *
 * The two sites name topics differently ("Dynamic Programming" vs "dp"), so both are mapped to one
 * list of topics. Where several site tags map to one topic (LeetCode "Tree" and "Binary Tree"), the
 * larger count is used, because one problem usually carries both tags.
 */

// topic → [LeetCode tags, Codeforces tags]; `core` = asked often in placement interviews. LeetCode tag
// names checked against a real profile on 2026-11-04 (e.g. 'Graph Theory', 'Heap'); older spellings kept.
const TOPICS = [
  ['Arrays', ['Array'], [], true],
  ['Strings', ['String'], ['strings'], true],
  ['Hash tables', ['Hash Table'], ['hashing'], true],
  ['Two pointers', ['Two Pointers'], ['two pointers'], true],
  ['Sliding window', ['Sliding Window'], [], true],
  ['Binary search', ['Binary Search'], ['binary search'], true],
  ['Sorting', ['Sorting'], ['sortings'], true],
  ['Stacks & queues', ['Stack', 'Queue', 'Monotonic Stack'], [], true],
  ['Heaps', ['Heap', 'Heap (Priority Queue)'], [], true],
  ['Linked lists', ['Linked List'], [], true],
  ['Trees', ['Tree', 'Binary Tree', 'Binary Search Tree'], ['trees'], true],
  ['Graphs', ['Graph Theory', 'Graph'], ['graphs'], true],
  ['DFS & BFS', ['Depth-First Search', 'Breadth-First Search'], ['dfs and similar'], true],
  ['Dynamic programming', ['Dynamic Programming'], ['dp'], true],
  ['Greedy', ['Greedy'], ['greedy'], true],
  ['Backtracking', ['Backtracking'], [], true],
  ['Math', ['Math'], ['math'], false],
  ['Number theory', ['Number Theory'], ['number theory'], false],
  ['Bit manipulation', ['Bit Manipulation'], ['bitmasks'], false],
  ['Shortest paths', ['Shortest Path'], ['shortest paths'], false],
  ['Data structures', [], ['data structures'], false],
  ['Constructive', [], ['constructive algorithms'], false],
  ['Implementation', ['Simulation'], ['implementation'], false],
  ['Brute force', ['Enumeration'], ['brute force'], false],
];
const GAP_BELOW = 5; // a core topic with fewer solved problems than this is shown as a gap

const maxOf = (counts, names) => Math.max(0, ...names.map((n) => counts.get(n) || 0));

/** Pure: linked accounts view → the practice page. */
function practiceAnalytics(links) {
  const lc = links && links.leetcode && links.leetcode.summary;
  const cf = links && links.codeforces && links.codeforces.summary;
  const lcTopics = new Map(((lc && lc.topics) || []).map((t) => [t.name, t.solved]));
  const cfTags = new Map(((cf && cf.tagStats) || []).map((t) => [t.name, t]));

  const topics = TOPICS.map(([topic, lcNames, cfNames, core]) => {
    const fromLc = maxOf(lcTopics, lcNames);
    const cfStats = cfNames.map((n) => cfTags.get(n)).filter(Boolean);
    const fromCf = Math.max(0, ...cfStats.map((t) => t.solved));
    const tried = cfStats.reduce((a, t) => Math.max(a, t.tried), 0);
    return {
      topic, core, leetcode: fromLc, codeforces: fromCf, total: fromLc + fromCf,
      cfAcceptance: tried >= 5 ? Math.round((fromCf / tried) * 100) / 100 : null, // too few attempts → no rate
    };
  }).filter((t) => t.total > 0 || t.core);

  const gaps = topics.filter((t) => t.core && t.total < GAP_BELOW).map((t) => t.topic);
  const strongest = [...topics].sort((a, b) => b.total - a.total).filter((t) => t.total > 0).slice(0, 3).map((t) => t.topic);

  // Weekly activity: LeetCode submissions and Codeforces problems solved, aligned by week index.
  const weeks = Array.from({ length: 12 }, (_, i) => ({
    weekEnd: (cf && cf.weekly && cf.weekly[i] && cf.weekly[i].weekEnd) || (lc && lc.weekly && lc.weekly[i] && lc.weekly[i].weekEnd) || null,
    leetcodeSubmissions: (lc && lc.weekly && lc.weekly[i] && lc.weekly[i].submissions) || 0,
    codeforcesSolved: (cf && cf.weekly && cf.weekly[i] && cf.weekly[i].solved) || 0,
  }));

  const hard = cf && cf.hard28d;
  return {
    linked: { leetcode: Boolean(lc), codeforces: Boolean(cf) },
    totals: {
      solved: ((lc && lc.solved && lc.solved.all) || 0) + ((cf && cf.solvedAll) || 0),
      solved7d: ((lc && lc.solved7d) || 0) + ((cf && cf.solved7d) || 0),
      leetcode: lc ? { solved: lc.solved || null, rating: lc.rating ?? null, streak: lc.streak ?? 0, activeDays30: lc.activeDays30 ?? 0 } : null,
      codeforces: cf ? { solved: cf.solvedAll || 0, rating: cf.rating ?? null, maxRating: cf.maxRating ?? null, rank: cf.rank || null, contests: cf.contests || 0, activeDays30: cf.activeDays30 ?? 0 } : null,
    },
    topics,
    gaps,
    strongest,
    weeks,
    difficulty: cf ? {
      monthly: cf.monthly || [],
      rating: cf.rating ?? null,
      above28d: hard ? { solvedRated: hard.solvedRated, aboveRating: hard.aboveRating, share: hard.solvedRated ? Math.round((hard.aboveRating / hard.solvedRated) * 100) / 100 : null } : null,
      byBand: cf.byDifficulty || [],
    } : null,
    leetcodeDifficulty: lc && lc.solved ? { easy: lc.solved.easy, medium: lc.solved.medium, hard: lc.solved.hard } : null,
    ratingHistory: (cf && cf.ratingHistory) || [],
    // The ML rating outlook (D-63), computed at sync time; null when Codeforces is not linked.
    outlook: (cf && cf.outlook) || null,
  };
}

module.exports = { practiceAnalytics, TOPICS, GAP_BELOW };
