const assert = require('assert');
const { normalizeEditorAnalytics, normalizeFocusAnalytics, normalizeGitAnalytics } =
  require('../services/activityNormalizers');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\nnormalizeEditorAnalytics');

check('defaults every field to 0 for a v2.0.11 payload with no editorAnalytics', () => {
  const r = normalizeEditorAnalytics({});
  assert.strictEqual(r.charsInserted, 0);
  assert.strictEqual(r.churnLines, 0);
  assert.strictEqual(r.readMs, 0);
});

check('passes through supplied numbers', () => {
  const r = normalizeEditorAnalytics({ editorAnalytics: { charsInserted: 120, churnLines: 8, readMs: 4000 } });
  assert.strictEqual(r.charsInserted, 120);
  assert.strictEqual(r.churnLines, 8);
  assert.strictEqual(r.readMs, 4000);
});

check('coerces junk to 0 rather than NaN', () => {
  const r = normalizeEditorAnalytics({ editorAnalytics: { charsInserted: 'abc', saveCount: null } });
  assert.strictEqual(r.charsInserted, 0);
  assert.strictEqual(r.saveCount, 0);
});

check('rejects negative values', () => {
  const r = normalizeEditorAnalytics({ editorAnalytics: { charsInserted: -50 } });
  assert.strictEqual(r.charsInserted, 0);
});

console.log('\nnormalizeFocusAnalytics');

check('keeps flowBlocksMs as an array of positive numbers', () => {
  const r = normalizeFocusAnalytics({ focusAnalytics: { flowBlocksMs: [1000, -5, 'x', 2000] } });
  assert.deepStrictEqual(r.flowBlocksMs, [1000, 2000]);
});

check('caps flowBlocksMs length to prevent unbounded documents', () => {
  const many = Array.from({ length: 500 }, () => 1000);
  const r = normalizeFocusAnalytics({ focusAnalytics: { flowBlocksMs: many } });
  assert.ok(r.flowBlocksMs.length <= 200, `got ${r.flowBlocksMs.length}`);
});

check('defaults to an empty array when absent', () => {
  assert.deepStrictEqual(normalizeFocusAnalytics({}).flowBlocksMs, []);
});

console.log('\nnormalizeGitAnalytics');

check('defaults and passes through', () => {
  assert.strictEqual(normalizeGitAnalytics({}).commits, 0);
  assert.strictEqual(normalizeGitAnalytics({ gitAnalytics: { commits: 3 } }).commits, 3);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
