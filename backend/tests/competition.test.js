/**
 * The group's weekly board (D-70): counts from the daily ledger, ranked by problems solved.
 * Run: node tests/competition.test.js
 */
const assert = require('assert');
const c = require('../services/competition');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

// Wednesday 2026-11-11, noon India time. Monday of this week is 2026-11-09.
const NOW = Date.UTC(2026, 10, 11, 6, 30);
const row = (userId, day, f) => ({ userId, day, problems: 0, contests: 0, pushes: 0, ...f });
const members = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));

console.log('\ncompetition');

t('days are India days', () => {
  assert.strictEqual(c.dayKey(Date.UTC(2026, 10, 8, 18, 29)), '2026-11-08');
  assert.strictEqual(c.dayKey(Date.UTC(2026, 10, 8, 18, 30)), '2026-11-09');
});

t('Codeforces: solved problems and contests land on their day', () => {
  const s = Date.UTC(2026, 10, 10, 4, 0) / 1000;
  const days = c.codeforcesDays([{ t: s }, { t: s + 60 }], [{ ratingUpdateTimeSeconds: s }], NOW);
  assert.deepStrictEqual(days['2026-11-10'], { problems: 2, contests: 1 });
});

t('LeetCode: accepted problems per day', () => {
  assert.deepStrictEqual(c.leetcodeDays([{ solvedAt: new Date(Date.UTC(2026, 10, 10, 4)) }])['2026-11-10'], { problems: 1 });
});

t('GitHub: pushes per day, other events ignored', () => {
  const at = new Date(Date.UTC(2026, 10, 10, 4)).toISOString();
  const days = c.githubDays([{ type: 'PushEvent', created_at: at }, { type: 'PushEvent', created_at: at }, { type: 'WatchEvent', created_at: at }]);
  assert.deepStrictEqual(days['2026-11-10'], { pushes: 2 });
});

t('the week runs Monday to Sunday, with days left', () => {
  const b = c.buildBoard({ members: members('a'), rows: [], now: NOW });
  assert.deepStrictEqual(b.week, { startsOn: '2026-11-09', endsOn: '2026-11-15', daysLeft: 4 });
  assert.strictEqual(c.buildBoard({ members: [], rows: [], now: Date.UTC(2026, 10, 15, 6, 30) }).week.startsOn, '2026-11-09', 'Sunday is still the same week');
  assert.strictEqual(c.buildBoard({ members: [], rows: [], now: Date.UTC(2026, 10, 16, 6, 30) }).week.startsOn, '2026-11-16', 'Monday starts a new one');
});

t('ranks by problems solved, and adds up every site', () => {
  const rows = [row('a', '2026-11-09', { problems: 2 }), row('a', '2026-11-10', { problems: 1, contests: 1 }), row('b', '2026-11-09', { problems: 5, pushes: 7 })];
  const b = c.buildBoard({ members: members('a', 'b'), rows, now: NOW });
  assert.deepStrictEqual(b.rows.map((x) => [x.id, x.pos, x.problems, x.contests, x.pushes]), [['b', 1, 5, 0, 7], ['a', 2, 3, 1, 0]]);
});

t('the same count shares a rank', () => {
  const rows = [row('a', '2026-11-09', { problems: 3 }), row('b', '2026-11-09', { problems: 3 })];
  assert.deepStrictEqual(c.buildBoard({ members: members('a', 'b', 'c'), rows, now: NOW }).rows.map((x) => x.pos), [1, 1, 3]);
});

t('pushes alone do not change the rank', () => {
  const rows = [row('a', '2026-11-09', { pushes: 500 }), row('b', '2026-11-09', { problems: 1 })];
  assert.strictEqual(c.buildBoard({ members: members('a', 'b'), rows, now: NOW }).rows[0].id, 'b');
});

t('other weeks are left out; last week gives the top solver', () => {
  const rows = [row('a', '2026-11-08', { problems: 9 }), row('b', '2026-11-02', { problems: 9 }), row('a', '2026-10-30', { problems: 50 })];
  const b = c.buildBoard({ members: members('a', 'b'), rows, now: NOW });
  assert.strictEqual(b.rows[0].problems, 0);
  assert.deepStrictEqual(b.lastWeek, { problems: 9, names: ['A', 'B'] });
});

t('no activity gives a valid empty board', () => {
  const b = c.buildBoard({ members: members('a'), rows: [], now: NOW });
  assert.strictEqual(b.lastWeek, null);
  assert.strictEqual(b.rows[0].problems, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
