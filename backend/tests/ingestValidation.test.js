const assert = require('assert');
const { validateIngestPayload } = require('../services/ingestValidation');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const base = { fileName: 'app.js', language: 'javascript', duration: 60 };
const okCases = [
  ['minimal valid', base],
  ['duration 1', { ...base, duration: 1 }],
  ['duration 3600', { ...base, duration: 3600 }],
  ['duration as numeric string', { ...base, duration: '45' }],
  ['timestamp now', { ...base, timestamp: new Date().toISOString() }],
  ['timestamp 23h ago', { ...base, timestamp: new Date(Date.now() - 23 * 3600e3).toISOString() }],
  ['projectName present', { ...base, projectName: 'CodeTrackr' }],
];
const badCases = [
  ['duration 0', { ...base, duration: 0 }],
  ['duration -5', { ...base, duration: -5 }],
  ['duration 3601', { ...base, duration: 3601 }],
  ['duration 1e12', { ...base, duration: 1e12 }],
  ['duration NaN', { ...base, duration: 'abc' }],
  ['missing fileName', { language: 'js', duration: 10 }],
  ['missing language', { fileName: 'a.js', duration: 10 }],
  ['fileName 300 chars', { ...base, fileName: 'a'.repeat(300) }],
  ['language 100 chars', { ...base, language: 'x'.repeat(100) }],
  ['projectName 200 chars', { ...base, projectName: 'p'.repeat(200) }],
  ['timestamp +2h (future)', { ...base, timestamp: new Date(Date.now() + 2 * 3600e3).toISOString() }],
  ['timestamp 2 days ago', { ...base, timestamp: new Date(Date.now() - 48 * 3600e3).toISOString() }],
  ['timestamp garbage', { ...base, timestamp: 'not-a-date' }],
  ['null body', null],
];

console.log('\ningestValidation: accepts valid payloads');
for (const [n, c] of okCases) check(n, () => {
  const r = validateIngestPayload(c);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});
console.log('\ningestValidation: rejects out-of-bounds payloads');
for (const [n, c] of badCases) check(n, () => {
  const r = validateIngestPayload(c);
  assert.strictEqual(r.ok, false, `expected reject, got ok for ${n}`);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
});

console.log('\ningestValidation: normalises the accepted value');
check('duration is returned as a Number', () => {
  const r = validateIngestPayload({ ...base, duration: '45' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.duration, 45);
  assert.strictEqual(typeof r.value.duration, 'number');
});
check('a signal-less clock-skew timestamp (+30s) is allowed', () => {
  const r = validateIngestPayload({ ...base, timestamp: new Date(Date.now() + 30e3).toISOString() });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
