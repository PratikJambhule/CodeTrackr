/**
 * Tests for scripts/seed-demo-students.js — the plan of 100 demo students and their activity.
 * Run: node tests/seedDemoStudents.test.js
 */
const assert = require('assert');
const { plan, totals, NAMES, MARKER, EMAIL_DOMAIN } = require('../scripts/seed-demo-students');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\nseedDemoStudents');

const now = Date.UTC(2026, 10, 2, 12, 0);
const p = plan({ now });

check('100 students, every one marked as demo with a unique email and googleId', () => {
  assert.strictEqual(p.students.length, 100);
  assert.strictEqual(new Set(NAMES).size, 100);
  assert.ok(p.students.every((s) => s.googleId.startsWith(MARKER) && s.email.endsWith(`@${EMAIL_DOMAIN}`)));
  assert.strictEqual(new Set(p.students.map((s) => s.email)).size, 100);
  assert.strictEqual(new Set(p.students.map((s) => s.googleId)).size, 100);
});

check('every student has activity; buckets sit on the 10-minute grid, in the past, at most 600 s', () => {
  assert.strictEqual(new Set(p.docs.map((d) => d.student)).size, 100);
  for (const d of p.docs) {
    assert.strictEqual(d.bucketStart.getTime() % 600000, 0);
    assert.ok(d.bucketStart.getTime() < now && d.duration <= 600);
    assert.strictEqual(d.writingSec + d.readingSec + d.runningSec, d.duration);
  }
});

check('no two buckets share the unique key (student, project, language, start)', () => {
  const keys = p.docs.map((d) => `${d.student}|${d.projectName}|${d.language}|${d.bucketStart.getTime()}`);
  assert.strictEqual(new Set(keys).size, keys.length);
});

check('each student has about 1, 2, 3 or 4 hours, within 30 minutes, in the last 3 weeks', () => {
  const t = totals(p.docs);
  p.hours.forEach((h, i) => {
    const sec = t.get(i).totalSeconds;
    assert.ok(Math.abs(sec - h * 3600) < 30 * 60, `${p.students[i].name}: ${sec} s vs ${h} h`);
  });
  assert.deepStrictEqual([...new Set(p.hours)].sort(), [1, 2, 3, 4]);
  assert.ok(p.docs.every((d) => d.bucketStart.getTime() > now - 22 * 864e5));
});

check('the same seed plans the same data; totals add up to the buckets', () => {
  assert.deepStrictEqual(plan({ now }).docs.length, p.docs.length);
  const t = totals(p.docs);
  const sum = [...t.values()].reduce((a, x) => a + x.totalSeconds, 0);
  assert.strictEqual(sum, p.docs.reduce((a, d) => a + d.duration, 0));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
