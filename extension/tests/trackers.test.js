const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const stub = createVscodeStub();
const restore = installVscodeStub(stub.vscode);
const { EditorTracker } = require(path.join(__dirname, '..', 'dist', 'extension.js'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\nEditorTracker');

check('counts gross insertions and deletions separately', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'hello\nworld', rangeLength: 0 });
  t.recordChange({ text: '', rangeLength: 5 });
  const s = t.consumeInterval();
  assert.strictEqual(s.charsInserted, 11);
  assert.strictEqual(s.charsDeleted, 5);
  assert.strictEqual(s.linesInserted, 1);
});

check('a replace-in-place edit is not invisible (regression: net lineCount delta)', () => {
  const t = new EditorTracker();
  // Delete 10 lines, write 10 back: the old net-delta metric reported zero.
  t.recordChange({ text: '', rangeLength: 200, linesRemoved: 10 });
  t.recordChange({ text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', rangeLength: 0 });
  const s = t.consumeInterval();
  assert.ok(s.charsInserted > 0, 'insertions recorded');
  assert.ok(s.charsDeleted > 0, 'deletions recorded');
});

check('counts lines written then deleted within 10 min as churn', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'a\nb\nc\nd', rangeLength: 0 }, undefined, 1_000_000);
  t.recordChange({ text: '', rangeLength: 8, linesRemoved: 3 }, undefined, 1_060_000); // 1 min later
  const s = t.consumeInterval();
  assert.strictEqual(s.churnLines, 3);
});

check('deletions after the 10 minute window are not churn', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'a\nb\nc\nd', rangeLength: 0 }, undefined, 1_000_000);
  t.recordChange({ text: '', rangeLength: 8, linesRemoved: 3 }, undefined, 1_700_000); // 11.6 min later
  const s = t.consumeInterval();
  assert.strictEqual(s.churnLines, 0);
});

check('counts undo and redo', () => {
  const t = new EditorTracker();
  t.recordChange({ text: '', rangeLength: 3 }, 1); // Undo
  t.recordChange({ text: 'x', rangeLength: 0 }, 2); // Redo
  const s = t.consumeInterval();
  assert.strictEqual(s.undoCount, 1);
  assert.strictEqual(s.redoCount, 1);
});

check('counts file switches and unique files', () => {
  const t = new EditorTracker();
  t.recordFileSwitch('a.ts');
  t.recordFileSwitch('b.ts');
  t.recordFileSwitch('a.ts');
  const s = t.consumeInterval();
  assert.strictEqual(s.fileSwitches, 3);
  assert.strictEqual(s.uniqueFiles, 2);
});

check('splits attention into read and write time', () => {
  const t = new EditorTracker();
  t.sampleAttention(0);
  t.recordChange({ text: 'x', rangeLength: 0 }, undefined, 1000);
  t.sampleAttention(5000);   // edit happened -> write
  t.sampleAttention(10000);  // no edit since -> read
  const s = t.consumeInterval();
  assert.strictEqual(s.writeMs, 5000);
  assert.strictEqual(s.readMs, 5000);
});

check('flags large inserts without storing their text', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'y'.repeat(200), rangeLength: 0 });
  const s = t.consumeInterval();
  assert.strictEqual(s.largeInsertCount, 1);
  assert.strictEqual(s.largeInsertChars, 200);
  assert.ok(!JSON.stringify(s).includes('yyy'), 'snapshot must not contain inserted text');
});

check('consumeInterval resets the counters', () => {
  const t = new EditorTracker();
  t.recordSave();
  assert.strictEqual(t.consumeInterval().saveCount, 1);
  assert.strictEqual(t.consumeInterval().saveCount, 0);
});

restore();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
