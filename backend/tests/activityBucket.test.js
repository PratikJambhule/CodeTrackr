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

check('commandKinds and their failures are added up per kind', () => {
  const u = b.buildBucketUpdate({ ...flush, terminalAnalytics: { ...flush.terminalAnalytics,
    commandKinds: { compile: 3, run: 1, test: 0, failed: { compile: 2 } } } }, 'a.cpp');
  assert.strictEqual(u.$inc['terminalAnalytics.commandKinds.compile'], 3);
  assert.strictEqual(u.$inc['terminalAnalytics.commandKinds.run'], 1);
  assert.strictEqual(u.$inc['terminalAnalytics.commandKinds.failed.compile'], 2);
  assert.ok(!('terminalAnalytics.commandKinds.test' in u.$inc), 'zero leaf must be absent');
});
check('the bucket knows the same command kinds as the classifier', () => {
  assert.deepStrictEqual(b.COMMAND_KIND_KEYS, require('../services/commandKinds').COMMAND_KINDS);
});

const signals = {
  runs: { terminal: 1, task: 0, debugNoDebug: 2, codeRunner: 0 },
  debug: { sessions: 1, breakpointStops: 3, steps: 7 },
  reading: { scrollEvents: 4, navigations: 2, filesOpenedNotEdited: 1 },
  filesCreated: 1, filesDeleted: 0,
  workspace: { sourceFilesBucket: '2-5', hasPackageJson: false, hasRequirements: false, hasGit: true, ownCommits: null, clonedRecently: false },
};
check('v3 signals: runs, debug, reading and file counts are added up; zeros are left out', () => {
  const u = b.buildBucketUpdate({ ...flush, signals }, 'a.cpp');
  assert.strictEqual(u.$inc['runs.terminal'], 1);
  assert.strictEqual(u.$inc['runs.debugNoDebug'], 2);
  assert.strictEqual(u.$inc['debug.breakpointStops'], 3);
  assert.strictEqual(u.$inc['debug.steps'], 7);
  assert.strictEqual(u.$inc['reading.scrollEvents'], 4);
  assert.strictEqual(u.$inc.filesCreated, 1);
  assert.ok(!('runs.task' in u.$inc) && !('filesDeleted' in u.$inc), 'zero counters must be absent');
});
check('v3 workspace: the latest upload sets it, an unknown ownCommits does not overwrite', () => {
  const u = b.buildBucketUpdate({ ...flush, signals }, 'a.cpp');
  assert.strictEqual(u.$set['workspace.sourceFilesBucket'], '2-5');
  assert.strictEqual(u.$set['workspace.hasGit'], true);
  assert.strictEqual(u.$set['workspace.hasPackageJson'], false);
  assert.ok(!('workspace.ownCommits' in u.$set));
});
check('a 2.5.0 upload (signals null) adds no v3 fields', () => {
  const u = b.buildBucketUpdate({ ...flush, signals: null }, 'a.ts');
  assert.ok(!Object.keys(u.$inc).some((k) => /^(runs|debug|reading)\.|^files(Created|Deleted)$/.test(k)));
  assert.ok(!u.$set || !Object.keys(u.$set).some((k) => k.startsWith('workspace.')));
});
check('v3 signals alone count as real work (a run with no typing is not merged away)', () => {
  assert.strictEqual(b.signalCount(signals), 22);
  assert.strictEqual(b.hasSignal({ ...empty, signals: { runs: { task: 1 } } }), true);
  assert.strictEqual(b.signalCount(null), 0);
});

check('userMode: the latest answer is set; confirmed seconds are added to that mode', () => {
  const u = b.buildBucketUpdate({ ...flush, userMode: { mode: 'dsa', confirmed: true } }, 'a.cpp');
  assert.strictEqual(u.$set['userMode.mode'], 'dsa');
  assert.strictEqual(u.$set['userMode.confirmed'], true);
  assert.strictEqual(u.$inc['modeSec.dsa'], 84);
});
check('userMode: an unconfirmed answer is stored but adds no labelled seconds', () => {
  const u = b.buildBucketUpdate({ ...flush, userMode: { mode: 'project', confirmed: false } }, 'a.ts');
  assert.strictEqual(u.$set['userMode.mode'], 'project');
  assert.ok(!Object.keys(u.$inc).some((k) => k.startsWith('modeSec.')));
});
check('modeInc: nothing for Auto, no answer or no time', () => {
  assert.deepStrictEqual(b.modeInc({ mode: 'auto', confirmed: true }, 60), {});
  assert.deepStrictEqual(b.modeInc(null, 60), {});
  assert.deepStrictEqual(b.modeInc({ mode: 'setup', confirmed: true }, 0), {});
  assert.deepStrictEqual(b.modeInc({ mode: 'setup', confirmed: true }, 30), { 'modeSec.setup': 30 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
