/**
 * Tests for services/fileNameHints.js — the file-name hints of the work-type
 * classifier (ML plan §8). Run: node tests/fileNameHints.test.js
 */
const assert = require('assert');
const { fileNameHints, isProblemFile, isConfigFile, isPracticeFolder } = require('../services/fileNameHints');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\nfileNameHints');

check('practice-problem names are recognised', () => {
  for (const f of ['two_sum.cpp', 'q3.py', 'A.cpp', 'b.py', '1234.java', '1850A.cpp', 'cf_1850A.cpp',
    'lc_42.py', '0001-two-sum.py', 'ValidParentheses.java', 'longest-common-subsequence.cpp', 'fib.py']) {
    assert.strictEqual(isProblemFile(f), true, f);
  }
});

check('ordinary project files are not practice problems', () => {
  for (const f of ['user_service.py', 'App.tsx', 'index.js', 'main.cpp', 'README.md', 'auth.js',
    'leaderboard.js', 'two_sum.md', 'package.json', 'Dashboard.tsx']) {
    assert.strictEqual(isProblemFile(f), false, f);
  }
});

check('configuration files are recognised', () => {
  for (const f of ['package.json', 'Dockerfile', 'docker-compose.yml', '.env', '.env.local',
    'requirements.txt', 'tsconfig.json', 'vite.config.ts', '.eslintrc.cjs', 'ci.yml', 'pyproject.toml']) {
    assert.strictEqual(isConfigFile(f), true, f);
  }
  for (const f of ['index.js', 'two_sum.cpp', 'App.tsx', 'notes.md']) {
    assert.strictEqual(isConfigFile(f), false, f);
  }
});

check('practice folders are recognised, project folders are not', () => {
  for (const p of ['leetcode', 'LeetCode-Solutions', 'dsa', 'my-dsa-sheet', 'cp', 'codeforces-practice', 'gfg_potd']) {
    assert.strictEqual(isPracticeFolder(p), true, p);
  }
  for (const p of ['CodeTrackr', 'cpp-project', 'portfolio', 'college-work', 'chat-app']) {
    assert.strictEqual(isPracticeFolder(p), false, p);
  }
});

check('shares are fractions of unique files, and paths are reduced to base names', () => {
  const h = fileNameHints(['src/two_sum.cpp', 'two_sum.cpp', 'q2.py', 'package.json', 'notes.md'], ['practice']);
  assert.strictEqual(h.problemFileShare, 2 / 4);
  assert.strictEqual(h.configFileShare, 1 / 4);
  assert.strictEqual(h.practiceFolder, 0);
});

check('empty input gives zeros, never NaN', () => {
  assert.deepStrictEqual(fileNameHints([], []), { problemFileShare: 0, configFileShare: 0, practiceFolder: 0 });
  assert.deepStrictEqual(fileNameHints(undefined, undefined), { problemFileShare: 0, configFileShare: 0, practiceFolder: 0 });
});

check('only numbers come out: no names leak', () => {
  const out = fileNameHints(['secret_project_plan.py'], ['top-secret']);
  assert.deepStrictEqual(Object.keys(out).sort(), ['configFileShare', 'practiceFolder', 'problemFileShare']);
  for (const v of Object.values(out)) assert.strictEqual(typeof v, 'number');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
