/**
 * Hackathon events (plan slice 4, D-71): validation and the event board. Pure.
 * Run: node tests/eventBoard.test.js
 */
const assert = require('assert');
const { parseEvent, statusOf, buildEventBoard } = require('../services/eventBoard');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const NOW = Date.UTC(2026, 10, 12, 10, 0);
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const good = { name: 'SPIT Hack', description: '', startsAt: iso(NOW - 2 * H), endsAt: iso(NOW + 22 * H) };

console.log('\neventBoard');

t('a valid event gets defaults: any editor, teams of 4', () => {
  const r = parseEvent(good, NOW);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.editorRule, 'any');
  assert.strictEqual(r.value.maxTeamSize, 4);
});

t('refuses bad names, dates, rules and sizes', () => {
  assert.strictEqual(parseEvent({ ...good, name: 'x' }, NOW).ok, false);
  assert.strictEqual(parseEvent({ ...good, endsAt: good.startsAt }, NOW).ok, false);
  assert.strictEqual(parseEvent({ ...good, endsAt: iso(NOW + 8 * 24 * H) }, NOW).ok, false, 'at most 7 days');
  assert.strictEqual(parseEvent({ ...good, startsAt: iso(NOW - 5 * H), endsAt: iso(NOW - H) }, NOW).ok, false, 'already over');
  assert.strictEqual(parseEvent({ ...good, editorRule: 'vim' }, NOW).ok, false);
  assert.strictEqual(parseEvent({ ...good, maxTeamSize: 11 }, NOW).ok, false);
  assert.strictEqual(parseEvent({ ...good, startsAt: 'soon' }, NOW).ok, false);
});

t('a partial update checks only what is sent', () => {
  assert.deepStrictEqual(parseEvent({ name: 'New name' }, NOW, { partial: true }), { ok: true, value: { name: 'New name' } });
  assert.strictEqual(parseEvent({ maxTeamSize: 0 }, NOW, { partial: true }).ok, false);
});

t('status: upcoming, live, ended', () => {
  const e = { startsAt: iso(NOW), endsAt: iso(NOW + H) };
  assert.strictEqual(statusOf(e, NOW - 1), 'upcoming');
  assert.strictEqual(statusOf(e, NOW), 'live');
  assert.strictEqual(statusOf(e, NOW + H), 'ended');
});

const event = { startsAt: iso(NOW - 3 * H), endsAt: iso(NOW + 21 * H), editorRule: 'vscode' };
const teams = [
  { id: 't1', name: 'Alpha', members: [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bilal' }] },
  { id: 't2', name: 'Beta', members: [{ id: 'c', name: 'Chen' }] },
];
const base = { event, teams, vscodeSeconds: new Map([['a', 3600]]), githubVerified: new Set(['a', 'b', 'c']), vscodeConnected: new Set(['a', 'c']), now: NOW };

t('counts pushes inside the event only, per member and per team', () => {
  const pushes = [{ userId: 'a', at: iso(NOW - H) }, { userId: 'b', at: iso(NOW - 2 * H) }, { userId: 'a', at: iso(NOW - 5 * H) }, { userId: 'c', at: iso(NOW - 30 * 60e3) }];
  const b = buildEventBoard({ ...base, pushes, forOrganizer: false });
  assert.strictEqual(b.status, 'live');
  assert.deepStrictEqual(b.teams.map((x) => [x.name, x.pushes]), [['Alpha', 2], ['Beta', 1]]);
  assert.strictEqual(b.teams[0].members.find((m) => m.id === 'a').pushes, 1, 'a push before the start is left out');
  assert.strictEqual(b.teams[0].vscodeSeconds, 3600);
  assert.strictEqual(b.teams[0].firstPushAt, iso(NOW - 2 * H));
  assert.strictEqual(b.checks, null, 'participants do not see the checks');
});

t('organiser checks: missing accounts, pushes with no VS Code time, quiet teams', () => {
  const pushes = [{ userId: 'b', at: iso(NOW - 2 * H) }, { userId: 'c', at: iso(NOW - 10 * 60e3) }];
  const b = buildEventBoard({ ...base, githubVerified: new Set(['a', 'b']), pushes, forOrganizer: true });
  const kinds = b.checks.map((c) => `${c.kind}:${c.member || c.team}`).sort();
  assert.deepStrictEqual(kinds, ['no-github:Chen', 'no-vscode-time:Bilal', 'no-vscode:Bilal', 'quiet:Alpha', 'quiet:Beta'].sort());
  assert.match(b.checks.find((c) => c.kind === 'quiet' && c.team === 'Alpha').text, /not pushed for 120 minutes/);
});

t('with "any editor", VS Code is never asked for', () => {
  const b = buildEventBoard({ ...base, event: { ...event, editorRule: 'any' }, pushes: [], forOrganizer: true });
  assert.ok(!b.checks.some((c) => c.kind.startsWith('no-vscode')));
});

t('before the start nothing is counted and nobody is "quiet"', () => {
  const later = { ...event, startsAt: iso(NOW + H), endsAt: iso(NOW + 5 * H) };
  const b = buildEventBoard({ ...base, event: later, pushes: [{ userId: 'a', at: iso(NOW - 60e3) }], forOrganizer: true });
  assert.strictEqual(b.status, 'upcoming');
  assert.strictEqual(b.teams[0].pushes, 0);
  assert.ok(!b.checks.some((c) => c.kind === 'quiet' || c.kind === 'no-vscode-time'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
