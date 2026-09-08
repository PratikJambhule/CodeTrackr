const assert = require('assert');
const b = require('../services/activityBucket');
const {
  normalizeEditorAnalytics, normalizeFocusAnalytics, normalizeGitAnalytics,
} = require('../services/activityNormalizers');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60000;

console.log('\nbucketStartFor');
check('floors to the 10-minute mark', () => {
  const d = b.bucketStartFor(new Date('2026-03-10T14:23:45.123Z'));
  assert.strictEqual(d.toISOString(), '2026-03-10T14:20:00.000Z');
});
check('a time on the boundary maps to itself', () => {
  assert.strictEqual(b.bucketStartFor(new Date('2026-03-10T14:20:00.000Z')).toISOString(), '2026-03-10T14:20:00.000Z');
});
check('two times 3 min apart in one window share a bucket', () => {
  const a = b.bucketStartFor(new Date('2026-03-10T14:21:00Z')).getTime();
  const c = b.bucketStartFor(new Date('2026-03-10T14:24:00Z')).getTime();
  assert.strictEqual(a, c);
});
check('result is always a multiple of BUCKET_MS', () => {
  assert.strictEqual(b.bucketStartFor(Date.now()).getTime() % b.BUCKET_MS, 0);
});
check('a custom bucketMs is honoured', () => {
  const d = b.bucketStartFor(new Date('2026-03-10T14:23:00Z'), 5 * MIN);
  assert.strictEqual(d.toISOString(), '2026-03-10T14:20:00.000Z');
});

console.log('\nhasSignal');
const empty = {
  editorAnalytics: normalizeEditorAnalytics({}),
  focusAnalytics: normalizeFocusAnalytics({}),
  gitAnalytics: normalizeGitAnalytics({}),
  terminalAnalytics: {},
};
check('false for an all-zero normalized payload', () => {
  assert.strictEqual(b.hasSignal(empty), false);
});
check('true when characters were inserted', () => {
  assert.strictEqual(b.hasSignal({ ...empty, editorAnalytics: { charsInserted: 5 } }), true);
});
check('true when a terminal command ran', () => {
  assert.strictEqual(b.hasSignal({ ...empty, terminalAnalytics: { totalCommands: 1 } }), true);
});
check('true when a git commit landed', () => {
  assert.strictEqual(b.hasSignal({ ...empty, gitAnalytics: { commits: 1 } }), true);
});
check('true when a flow block closed', () => {
  assert.strictEqual(b.hasSignal({ ...empty, focusAnalytics: { flowBlocksMs: [90 * MIN] } }), true);
});

console.log('\nbuildBucketUpdate');
const flush = {
  duration: 84,
  linesAdded: 10,
  linesRemoved: 3,
  editorAnalytics: { charsInserted: 200, charsDeleted: 40, churnLines: 2, linesInserted: 10, linesDeleted: 3, saveCount: 1 },
  focusAnalytics: { focusedMs: 84000, blurredMs: 5000, longestBlockMs: 84000, flowBlocksMs: [84000] },
  gitAnalytics: { commits: 0, filesChanged: 0 },
  terminalAnalytics: { totalCommands: 2, successfulCommands: 2, commandUsage: { git: 1, npm: 1 }, gitActivity: {} },
};
check('$inc carries duration, lines and flushCount', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts', '.ts');
  assert.strictEqual(u.$inc.duration, 84);
  assert.strictEqual(u.$inc.linesAdded, 10);
  assert.strictEqual(u.$inc.linesRemoved, 3);
  assert.strictEqual(u.$inc.flushCount, 1);
});
check('$inc includes only non-zero analytics leaves', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts', '.ts');
  assert.strictEqual(u.$inc['editorAnalytics.charsInserted'], 200);
  assert.strictEqual(u.$inc['editorAnalytics.churnLines'], 2);
  assert.strictEqual(u.$inc['terminalAnalytics.commandUsage.git'], 1);
  assert.ok(!('editorAnalytics.undoCount' in u.$inc), 'zero leaf must be absent');
});
check('no gitAnalytics paths when git is empty', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts', '.ts');
  assert.ok(!Object.keys(u.$inc).some((k) => k.startsWith('gitAnalytics.')), 'git-less flush must not touch gitAnalytics');
});
check('$max carries longestBlockMs', () => {
  assert.strictEqual(b.buildBucketUpdate(flush, 'app.ts').$max['focusAnalytics.longestBlockMs'], 84000);
});
check('$push slices flowBlocksMs to the last 200', () => {
  const u = b.buildBucketUpdate(flush, 'app.ts');
  assert.deepStrictEqual(u.$push['focusAnalytics.flowBlocksMs'], { $each: [84000], $slice: -200 });
});
check('$addToSet adds the filename', () => {
  assert.deepStrictEqual(b.buildBucketUpdate(flush, 'app.ts').$addToSet, { files: 'app.ts' });
});
check('no $addToSet for an unknown filename', () => {
  assert.strictEqual(b.buildBucketUpdate(flush, 'unknown').$addToSet, undefined);
});
check('two flushes summed give the same $inc as one combined flush', () => {
  const u1 = b.buildBucketUpdate(flush, 'a.ts').$inc;
  const u2 = b.buildBucketUpdate(flush, 'a.ts').$inc;
  assert.strictEqual(u1.duration + u2.duration, 168);
});

console.log('\nplanActivityWrite');
const normalized = { ...flush, userId: 'u1', projectName: 'proj', language: 'typescript', fileName: 'a.ts', fileType: '.ts' };
check('mode legacy when bucketMs is 0', () => {
  assert.strictEqual(b.planActivityWrite(normalized, new Date(), 0).mode, 'legacy');
});
check('mode bucket for a payload with signal', () => {
  const p = b.planActivityWrite(normalized, new Date('2026-03-10T14:23:00Z'));
  assert.strictEqual(p.mode, 'bucket');
  assert.strictEqual(p.setOnInsert.bucketStart.toISOString(), '2026-03-10T14:20:00.000Z');
  assert.strictEqual(p.setOnInsert.timestamp.toISOString(), '2026-03-10T14:20:00.000Z');
  assert.deepStrictEqual(p.filter, { userId: 'u1', projectName: 'proj', language: 'typescript', bucketStart: p.setOnInsert.bucketStart });
});
check('mode merge for a signal-less payload', () => {
  const p = b.planActivityWrite({ ...empty, userId: 'u1', projectName: 'proj', language: 'typescript', duration: 20 }, new Date());
  assert.strictEqual(p.mode, 'merge');
  assert.deepStrictEqual(p.inc, { duration: 20, flushCount: 1 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
