/**
 * Tests for services/typeAnalytics.js — analytics per kind of work (D-55):
 * which group a session counts in, and the numbers each Insights tab shows.
 * Run: node tests/typeAnalytics.test.js
 */
const assert = require('assert');
const { kindOf, typeAnalytics } = require('../services/typeAnalytics');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const T0 = Date.UTC(2026, 9, 20, 4, 0); // 20 Oct 2026, 09:30 in India
const MIN = 60;
/** A 2.6.0 session; anything not given is empty. */
function session(over = {}) {
  return {
    startMs: T0, endMs: T0 + 3600e3, durationSec: 60 * MIN,
    writingSec: 30 * MIN, readingSec: 20 * MIN, runningSec: 10 * MIN,
    projects: ['sem3'], languages: ['cpp'], files: [], fileSec: {},
    commandKinds: {}, runs: {}, debug: {}, reading: {}, workspace: null,
    commits: 0, linesInserted: 0,
    workType: { type: 'dsa', group: 'dsa', reason: 'r', by: 'rules' }, pickerLabel: null,
    ...over,
  };
}
const guessOnly = () => ({ doc: null, prompt: 'guess' });

console.log('\ntypeAnalytics: which group a session counts in');

check('your answer beats the VS Code picker, which beats the guess', () => {
  const s = session({ pickerLabel: { type: 'project' } });
  assert.deepStrictEqual(kindOf(s, { userLabel: { type: 'setup' } }, 'guess'), { type: 'setup', source: 'you' });
  assert.deepStrictEqual(kindOf(s, null, 'guess'), { type: 'project', source: 'picker' });
  assert.deepStrictEqual(kindOf(session(), null, 'guess'), { type: 'dsa', source: 'guess' });
});

check('a blind session without an answer waits, so its hidden guess is not revealed', () => {
  assert.deepStrictEqual(kindOf(session(), null, 'blind'), { waiting: true });
  assert.deepStrictEqual(kindOf(session(), { userLabel: { type: 'dsa' } }, 'blind'), { type: 'dsa', source: 'you' });
  assert.deepStrictEqual(kindOf(session({ pickerLabel: { type: 'dsa' } }), null, 'blind'), { type: 'dsa', source: 'picker' });
});

check('"not sure" and "too short" go in no group', () => {
  assert.strictEqual(kindOf(session({ workType: { type: 'not_sure' } }), null, 'guess'), null);
  assert.strictEqual(kindOf(session({ workType: { type: 'not_enough' } }), null, 'guess'), null);
});

console.log('\ntypeAnalytics: the numbers');

check('every tab has sessions, confirmed, minutes, the split and how many have 2.6.0 detail', () => {
  const r = typeAnalytics([
    { s: session(), ...guessOnly() },
    { s: session({ startMs: T0 + 864e5 }), doc: { userLabel: { type: 'dsa' } }, prompt: 'guess' },
    { s: session({ startMs: T0 + 2 * 864e5, writingSec: 0, readingSec: 0, runningSec: 0 }), ...guessOnly() },
  ]);
  const d = r.groups.dsa;
  assert.strictEqual(d.sessions, 3);
  assert.strictEqual(d.confirmed, 1);
  assert.strictEqual(d.minutes, 180);
  assert.strictEqual(d.detailSessions, 2);
  assert.deepStrictEqual(d.split, { writingSec: 3600, readingSec: 2400, runningSec: 1200 });
  assert.strictEqual(r.groups.project_work.sessions, 0);
  assert.strictEqual(r.totalMinutes, 180);
});

check('waiting and unsorted sessions are counted apart', () => {
  const r = typeAnalytics([
    { s: session(), doc: null, prompt: 'blind' },
    { s: session({ workType: { type: 'not_sure' } }), ...guessOnly() },
  ]);
  assert.strictEqual(r.waiting, 1);
  assert.strictEqual(r.unsorted, 1);
  assert.strictEqual(r.groups.dsa.sessions, 0);
});

check('DSA: problems with time each (no config or notes), compiles, failed share, runs per problem', () => {
  const r = typeAnalytics([{ s: session({
    fileSec: { 'two_sum.cpp': { seconds: 1500 }, 'lru_cache.cpp': { seconds: 900 }, 'notes.md': { seconds: 300 }, '.clang-format': { seconds: 0 }, 'tasks.json': { seconds: 60 } },
    commandKinds: { compile: 10, run: 6, failed: { compile: 4 } }, runs: { codeRunner: 4 },
  }), ...guessOnly() }]).groups.dsa;
  assert.deepStrictEqual(d(r.problems), [['two_sum.cpp', 1500], ['lru_cache.cpp', 900]]);
  assert.strictEqual(r.problemCount, 2);
  assert.strictEqual(r.compiles, 10);
  assert.strictEqual(r.failedCompiles, 4);
  assert.strictEqual(r.runs, 10, 'terminal runs + Code Runner');
  assert.strictEqual(r.runsPerProblem, 10, '(10 compiles + 10 runs) / 2 problems');
  function d(list) { return list.map((p) => [p.name, p.seconds]); }
});

check('DSA: active days use the viewer\'s time zone, languages count sessions', () => {
  const late = Date.UTC(2026, 9, 20, 20, 0); // 21 Oct 01:30 in India, still 20 Oct in UTC
  const entries = [
    { s: session({ languages: ['cpp'] }), ...guessOnly() },
    { s: session({ startMs: late, languages: ['cpp', 'python'] }), ...guessOnly() },
  ];
  assert.strictEqual(typeAnalytics(entries).groups.dsa.activeDays, 1, 'UTC: both on 20 Oct');
  const india = typeAnalytics(entries, { timezoneOffset: -330 }).groups.dsa;
  assert.strictEqual(india.activeDays, 2);
  assert.deepStrictEqual(india.languages, [{ name: 'cpp', sessions: 2 }, { name: 'python', sessions: 1 }]);
});

check('Project work: projects (two-project sessions split equally), commits, top files, lines', () => {
  const p = { workType: { type: 'project', group: 'project_work' } };
  const r = typeAnalytics([
    { s: session({ ...p, projects: ['shop'], commits: 3, linesInserted: 400, fileSec: { 'App.tsx': { seconds: 2000 }, 'api.ts': { seconds: 1000 } } }), ...guessOnly() },
    { s: session({ ...p, projects: ['shop', 'blog'], commits: 1, linesInserted: 100, fileSec: { 'api.ts': { seconds: 500 } } }), ...guessOnly() },
  ]).groups.project_work;
  assert.deepStrictEqual(r.projects, [{ name: 'shop', minutes: 90 }, { name: 'blog', minutes: 30 }]);
  assert.strictEqual(r.commits, 4);
  assert.strictEqual(r.commitsPerHour, 2);
  assert.strictEqual(r.linesWritten, 500);
  assert.deepStrictEqual(r.topFiles.map((f) => [f.name, f.seconds]), [['App.tsx', 2000], ['api.ts', 1500]]);
});

check('Project work: debugging minutes, sessions, stops, steps; builds and tests with failures', () => {
  const r = typeAnalytics([
    { s: session({ workType: { type: 'debugging' }, debug: { sessions: 2, breakpointStops: 9, steps: 30 },
      commandKinds: { build: 3, compile: 1, test: 5, failed: { build: 2, test: 1 } }, runs: { task: 2, debugNoDebug: 1 } }), ...guessOnly() },
    { s: session({ workType: { type: 'project' }, commandKinds: { run: 4 } }), ...guessOnly() },
  ]).groups.project_work;
  assert.deepStrictEqual(r.debugging, { minutes: 60, sessions: 2, breakpointStops: 9, steps: 30 });
  assert.strictEqual(r.builds, 4);
  assert.strictEqual(r.failedBuilds, 2);
  assert.strictEqual(r.tests, 5);
  assert.strictEqual(r.failedTests, 1);
  assert.strictEqual(r.runs, 7, '4 terminal + 2 tasks + 1 Run Without Debugging');
});

check('Learning & setup: learning vs setup minutes, docs, reading, cloned repos, installs, config files, setup share', () => {
  const r = typeAnalytics([
    { s: session({ workType: { type: 'learning' }, projects: ['react-tutorial'], workspace: { clonedRecently: true },
      reading: { navigations: 40, filesOpenedNotEdited: 6 }, fileSec: { 'README.md': { seconds: 600 }, 'index.js': { seconds: 900 } } }), ...guessOnly() },
    { s: session({ workType: { type: 'setup' }, durationSec: 30 * MIN, projects: ['shop'],
      commandKinds: { install: 5, docker: 2, failed: { install: 2, docker: 1 } }, files: ['package.json', '.env', 'App.tsx', 'vite.config.ts'] }), ...guessOnly() },
    { s: session({ workType: { type: 'project' }, durationSec: 90 * MIN }), ...guessOnly() },
  ]).groups.learning_setup;
  assert.strictEqual(r.learningMinutes, 60);
  assert.strictEqual(r.setupMinutes, 30);
  assert.strictEqual(r.docSec, 600);
  assert.strictEqual(r.navigations, 40);
  assert.strictEqual(r.filesOpenedNotEdited, 6);
  assert.deepStrictEqual(r.clonedRepos, ['react-tutorial']);
  assert.strictEqual(r.installs, 7);
  assert.strictEqual(r.failedInstalls, 3);
  assert.deepStrictEqual(r.configFiles, ['package.json', '.env', 'vite.config.ts']);
  assert.strictEqual(r.setupShare, 0.17, '30 of 180 minutes, rounded');
});

check('long lists are capped and numbers are whole or 2 decimals', () => {
  const fileSec = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}.cpp`, { seconds: 100 + i }]));
  const r = typeAnalytics([{ s: session({ fileSec, commandKinds: { compile: 1 } }), ...guessOnly() }]).groups.dsa;
  assert.strictEqual(r.problems.length, 8);
  assert.strictEqual(r.problemCount, 20);
  assert.strictEqual(r.problems[0].name, 'p19.cpp');
  assert.strictEqual(r.runsPerProblem, 0.05);
});

check('no sessions gives empty groups, not errors', () => {
  const r = typeAnalytics([]);
  assert.strictEqual(r.totalMinutes, 0);
  assert.strictEqual(r.groups.dsa.runsPerProblem, 0);
  assert.strictEqual(r.groups.project_work.commitsPerHour, 0);
  assert.strictEqual(r.groups.learning_setup.setupShare, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
