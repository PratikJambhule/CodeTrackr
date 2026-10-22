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

console.log('\nnormalizeV3Signals (plan E7–E11)');
const { normalizeV3Signals } = require('../services/activityNormalizers');

check('an older payload without the new blocks gives null', () => {
  assert.strictEqual(normalizeV3Signals({ duration: 60, editorAnalytics: {} }), null);
});

check('runs, debug, reading and file counts become whole, bounded numbers', () => {
  const s = normalizeV3Signals({
    runs: { terminal: 2, task: '1', debugNoDebug: -3, codeRunner: 2.7, extra: 9 },
    debug: { sessions: 1, breakpointStops: 1e9, steps: 'x' },
    reading: { scrollEvents: 4, navigations: 2, docFileSec: 30, filesOpenedNotEdited: 1, searches: 5 },
    filesCreated: 1, filesDeleted: null,
  });
  assert.deepStrictEqual(s.runs, { terminal: 2, task: 1, debugNoDebug: 0, codeRunner: 2 });
  assert.deepStrictEqual(s.debug, { sessions: 1, breakpointStops: 10000, steps: 0 });
  // docFileSec is not stored: it can be worked out from fileTime; unknown keys are dropped.
  assert.deepStrictEqual(s.reading, { scrollEvents: 4, navigations: 2, filesOpenedNotEdited: 1 });
  assert.strictEqual(s.filesCreated, 1);
  assert.strictEqual(s.filesDeleted, 0);
  assert.strictEqual(s.workspace, null);
});

check('workspace keeps only the allowed bucket and yes/no flags', () => {
  const s = normalizeV3Signals({ workspace: {
    sourceFilesBucket: '6-20', hasPackageJson: true, hasRequirements: 0, hasGit: 'yes',
    ownCommits: null, clonedRecently: false, path: 'C:\\secret',
  } });
  assert.deepStrictEqual(s.workspace, {
    sourceFilesBucket: '6-20', hasPackageJson: true, hasRequirements: false, hasGit: false,
    ownCommits: null, clonedRecently: false,
  });
});

check('an unknown size bucket is dropped, ownCommits true/false is kept', () => {
  const s = normalizeV3Signals({ workspace: { sourceFilesBucket: '/home/me', ownCommits: true } });
  assert.strictEqual('sourceFilesBucket' in s.workspace, false);
  assert.strictEqual(s.workspace.ownCommits, true);
  assert.strictEqual(normalizeV3Signals({ workspace: 'x', runs: {} }).workspace, null);
});

console.log('\nnormalizeUserMode (plan E12 / B4)');
const { normalizeUserMode } = require('../services/activityNormalizers');

check('a picked mode is kept with its confirmed flag', () => {
  assert.deepStrictEqual(normalizeUserMode({ userMode: { mode: 'dsa', confirmed: true } }), { mode: 'dsa', confirmed: true });
  assert.deepStrictEqual(normalizeUserMode({ userMode: { mode: 'project', confirmed: false } }), { mode: 'project', confirmed: false });
});
check('only a real true counts as confirmed; Auto is never confirmed', () => {
  assert.strictEqual(normalizeUserMode({ userMode: { mode: 'setup', confirmed: 'yes' } }).confirmed, false);
  assert.deepStrictEqual(normalizeUserMode({ userMode: { mode: 'auto', confirmed: true } }), { mode: 'auto', confirmed: false });
});
check('an unknown mode, or no userMode at all (2.5.0), gives null', () => {
  assert.strictEqual(normalizeUserMode({ userMode: { mode: 'gaming', confirmed: true } }), null);
  assert.strictEqual(normalizeUserMode({ userMode: 'dsa' }), null);
  assert.strictEqual(normalizeUserMode({ duration: 60 }), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
