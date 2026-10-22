'use strict';

/**
 * File-name hints for the work-type classifier (ML plan §8, change C-05). Pure, no I/O.
 *
 * Three numbers come out; the names that went in never leave this module:
 *   problemFileShare  share of the session's files named like practice problems
 *                     (two_sum.cpp, q3.py, A.cpp, 1234.java, cf_1850A.cpp)
 *   configFileShare   share of files that are configuration (package.json, Dockerfile, *.yml, .env…)
 *   practiceFolder    1 when the project folder is named like a practice repo (leetcode, dsa, cp…)
 *
 * These are hints, not proof: a project can have sort_utils.js. The model weighs them with the
 * other 15 signals.
 */

const CODE_EXT = new Set(['cpp', 'cc', 'cxx', 'c', 'py', 'java', 'kt', 'go', 'rs', 'js', 'ts', 'cs', 'rb']);

// Short, distinctive words from practice-problem titles. Matched as whole tokens.
const DSA_WORDS = new Set([
  'sum', 'subarray', 'subsequence', 'substring', 'palindrome', 'palindromic', 'parentheses', 'anagram',
  'tree', 'bst', 'graph', 'dp', 'knapsack', 'fibonacci', 'fib', 'prime', 'primes', 'sieve', 'permutation',
  'permutations', 'subset', 'subsets', 'combination', 'combinations', 'bfs', 'dfs', 'dijkstra',
  'kruskal', 'prim', 'topological', 'bitmask', 'matrix', 'island', 'islands', 'linked', 'stack',
  'queue', 'heap', 'trie', 'intervals', 'interval', 'rotate', 'reverse', 'kth', 'lcs', 'lis',
  'nqueens', 'queens', 'sudoku', 'coin', 'coins', 'stairs', 'climbing', 'binary', 'search', 'sort',
  'sorting', 'merge', 'quick', 'two', 'three', 'max', 'min', 'longest', 'shortest', 'median', 'pairs',
]);

const PROBLEM_PATTERNS = [
  /^(q|p|prob|problem|lc|cf|abc|arc|ques|question)[-_]?\d+[a-z]?$/i, // q3, lc_1234, cf1850a
  /^\d{1,5}[a-z]?([-_].*)?$/i,                                        // 1234, 1850A, 0001-two-sum
  /^[a-h]\d?$/i,                                                      // A, b, c1 (contest letters)
  /^(cf|lc|abc|arc|cc)[-_]\w+$/i,                                     // cf_1850A, lc_two_sum
];

const CONFIG_EXACT = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'tsconfig.json', 'jsconfig.json',
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'requirements.txt', 'pyproject.toml',
  'setup.cfg', 'setup.py', 'pipfile', 'makefile', 'cmakelists.txt', 'pom.xml', 'build.gradle',
  'build.gradle.kts', 'settings.gradle', '.gitignore', 'go.mod', 'cargo.toml', '.npmrc', '.nvmrc',
  'vercel.json', 'netlify.toml', 'procfile', '.editorconfig',
]);
const CONFIG_EXT = new Set(['yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env']);
const CONFIG_PREFIX = ['.env', '.eslintrc', '.prettierrc', '.babelrc', '.stylelintrc'];
const CONFIG_INFIX = /\.config\.(js|cjs|mjs|ts)$/i; // vite.config.ts, tailwind.config.js

const PRACTICE_WORDS = ['leetcode', 'codeforces', 'codechef', 'geeksforgeeks', 'hackerrank', 'atcoder', 'interviewbit'];
const PRACTICE_TOKENS = new Set(['gfg', 'dsa', 'cp', 'lc', 'cses', 'competitive', 'daa', 'algo', 'algorithms']);

function splitName(name) {
  const base = String(name || '').trim().split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return { base, stem: base, ext: '' };
  return { base, stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() };
}

function isProblemFile(name) {
  const { stem, ext } = splitName(name);
  if (!CODE_EXT.has(ext) || !stem) return false;
  if (PROBLEM_PATTERNS.some((re) => re.test(stem))) return true;
  // two_sum, ValidParentheses, longest-common-subsequence: split snake, kebab and camel case
  const tokens = stem.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 2 && !DSA_WORDS.has(tokens[0])) return false;
  return tokens.some((t) => DSA_WORDS.has(t)) && tokens.length <= 6;
}

/** A source-code file by its extension (.cpp, .py, .ts, ...). */
function isCodeFile(name) {
  return CODE_EXT.has(splitName(name).ext);
}

function isConfigFile(name) {
  const { base, ext } = splitName(name);
  const lower = base.toLowerCase();
  if (CONFIG_EXACT.has(lower)) return true;
  if (CONFIG_PREFIX.some((p) => lower.startsWith(p))) return true;
  if (CONFIG_INFIX.test(lower)) return true;
  return CONFIG_EXT.has(ext);
}

function isPracticeFolder(project) {
  const lower = String(project || '').toLowerCase();
  if (!lower) return false;
  if (PRACTICE_WORDS.some((w) => lower.includes(w))) return true;
  return lower.split(/[^a-z0-9]+/).some((t) => PRACTICE_TOKENS.has(t));
}

/**
 * @param files     base names of the files active during the session (duplicates ignored)
 * @param projects  project (workspace) names seen in the session
 * @returns { problemFileShare, configFileShare, practiceFolder } numbers only
 */
function fileNameHints(files = [], projects = []) {
  const unique = [...new Set((files || []).map((f) => splitName(f).base).filter(Boolean))];
  const n = unique.length;
  const share = (pred) => (n ? unique.filter(pred).length / n : 0);
  return {
    problemFileShare: share(isProblemFile),
    configFileShare: share(isConfigFile),
    practiceFolder: (projects || []).some(isPracticeFolder) ? 1 : 0,
  };
}

module.exports = { fileNameHints, isProblemFile, isConfigFile, isCodeFile, isPracticeFolder };
