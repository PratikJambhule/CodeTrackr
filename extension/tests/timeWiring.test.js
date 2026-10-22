/**
 * The time engine wired into the real extension (plan E4 + E5 + E6): VS Code events become
 * heartbeats and runs, uploads carry payload version 3, and they are made at the right moments.
 * Runs the built bundle against the VS Code stub with a controlled clock.
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const realNow = Date.now;
let clock = Date.UTC(2026, 9, 22, 10, 0, 0);
Date.now = () => clock;
const tickClock = (sec) => { clock += sec * 1000; };

const stub = createVscodeStub({ settings: { apiKey: '', minFlushMinutes: 2 } });
installVscodeStub(stub.vscode);
const ext = require(path.join(__dirname, '..', 'dist', 'extension.js'));

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}
const settle = () => new Promise((r) => setImmediate(r));

const doc = (fileName, languageId, scheme = 'file') => ({ fileName, languageId, uri: { scheme } });
const dsa = doc('C:\\Users\\me\\leetcode\\two_sum.cpp', 'cpp');
const notes = doc('/home/me/proj/notes.md', 'markdown');
const outputPanel = doc('extension-output-#1', 'log', 'output');
const type = (d, text = 'x') => stub.emit.onDidChangeTextDocument({ document: d, contentChanges: [{ text, rangeLength: 0 }] });
const open = (d) => { stub.vscode.window.activeTextEditor = { document: d }; stub.emit.onDidChangeActiveTextEditor({ document: d }); };
const queued = () => ext.getOutboxForTest().peekAll();
const lastUpload = () => queued()[queued().length - 1];

(async () => {
  const store = {};
  await ext.activate({
    subscriptions: [],
    globalState: { get: (k) => store[k], update: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); } },
    secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve(), onDidChange: () => ({ dispose() {} }) },
  });
  const engine = ext.getEngineForTest();
  engine.take(clock); // start from a clean slate

  console.log('\ntime wiring');

  await check('typing, then a terminal run: one upload with writing, running and the file', async () => {
    open(dsa);
    for (let s = 0; s < 59; s++) { type(dsa, s % 10 === 9 ? 'x\n' : 'x'); tickClock(1); }
    type(dsa);                                               // 59 s of typing
    const run = { commandLine: { value: 'g++ two_sum.cpp -o a' } };
    stub.emit.onDidStartTerminalShellExecution({ execution: run });
    tickClock(60);
    stub.emit.onDidEndTerminalShellExecution({ execution: run, exitCode: 1 });
    await stub.commandHandlers['codetrackr.flushNow']();
    const p = lastUpload();
    assert.strictEqual(p.payloadVersion, 3);
    assert.strictEqual(p.duration, 119);                     // the run starts in the same second as the last keystroke
    assert.strictEqual(p.writingSec, 59);
    assert.strictEqual(p.runningSec, 60);
    assert.strictEqual(p.readingSec, 0);
    assert.strictEqual(p.fileName, 'two_sum.cpp');
    assert.strictEqual(p.language, 'cpp');
    assert.deepStrictEqual(p.perFile.map((f) => [f.name, f.seconds, f.edited]), [['two_sum.cpp', 119, true]]);
    assert.strictEqual(p.perFile[0].linesInserted, 5);
    assert.strictEqual(p.editorAnalytics.writeMs, 59000, 'writeMs comes from the engine');
    assert.strictEqual(p.editorAnalytics.readMs, 0);
    assert.strictEqual(p.timestamp, new Date(clock - 119000).toISOString(), 'stamped when the counted time began');
  });

  await check('no folder path, command text or output-panel name in the upload', async () => {
    const text = JSON.stringify(lastUpload());
    for (const leak of ['Users', 'leetcode', 'me\\\\', '-o a', 'g++ two', 'extension-output']) {
      assert.ok(!text.includes(leak), `upload contains "${leak}"`);
    }
  });

  await check('the Output panel and files changed in the background do not count', async () => {
    const before = engine.countedMs(clock);
    type(outputPanel); tickClock(5); type(outputPanel);
    stub.emit.onDidChangeTextEditorSelection({ textEditor: { document: outputPanel } });
    const background = doc('/home/me/proj/other.js', 'javascript'); // not on screen
    type(background); tickClock(5); type(background);
    assert.strictEqual(engine.countedMs(clock), before);
  });

  await check('scrolling and moving the cursor count as reading', async () => {
    tickClock(70);                                           // a break first: nothing before it carries over
    engine.take(clock);
    open(notes);
    for (let s = 0; s < 30; s++) {
      tickClock(1);
      stub.emit.onDidChangeTextEditorVisibleRanges({ textEditor: { document: notes } });
    }
    for (let s = 0; s < 10; s++) {
      tickClock(1);
      stub.emit.onDidChangeTextEditorSelection({ textEditor: { document: notes } });
    }
    await stub.commandHandlers['codetrackr.flushNow']();
    const p = lastUpload();
    assert.strictEqual(p.readingSec, 40);
    assert.strictEqual(p.duration, 40);
    assert.deepStrictEqual(p.perFile.map((f) => [f.name, f.reading, f.edited]), [['notes.md', 40, false]]);
  });

  await check('a reading-only interval is uploaded, not held back', async () => {
    assert.ok(ext.payloadHasSignal({ duration: 40, editorAnalytics: {}, terminalAnalytics: {}, gitAnalytics: {}, focusAnalytics: {} }));
  });

  await check('the 30-second check uploads at 2 minutes of counted time, not before', async () => {
    const n = queued().length;
    open(dsa);
    for (let s = 0; s < 100; s++) { tickClock(1); type(dsa); }
    ext.tickForTest();
    await settle();
    assert.strictEqual(queued().length, n, 'only 100 s counted: no upload yet');
    for (let s = 0; s < 25; s++) { tickClock(1); type(dsa); }
    ext.tickForTest();
    await settle();
    assert.strictEqual(queued().length, n + 1);
    assert.strictEqual(lastUpload().duration, 125);
  });

  await check('going idle uploads the tail at once', async () => {
    const n = queued().length;
    for (let s = 0; s < 20; s++) { tickClock(1); type(dsa); }
    tickClock(61);                                           // no action for over a minute
    ext.tickForTest();
    await settle();
    assert.strictEqual(queued().length, n + 1);
    assert.strictEqual(lastUpload().duration, 20);
  });

  await check('leaving VS Code for more than 30 s uploads the tail; the time away counts 0', async () => {
    const n = queued().length;
    type(dsa);                                               // back after the break above (that gap counts 0)
    for (let s = 0; s < 15; s++) { tickClock(1); type(dsa); }
    stub.emit.onDidChangeWindowState({ focused: false });
    tickClock(31);
    try {
      ext.tickForTest();
      await settle();
      assert.strictEqual(queued().length, n + 1);
      assert.strictEqual(lastUpload().duration, 15);
    } finally {
      stub.emit.onDidChangeWindowState({ focused: true });   // always back, or later tests type "in the background"
    }
  });

  await check('a task and a debug session count as running', async () => {
    engine.take(clock);
    const task = { id: 'build' };
    stub.emit.onDidStartTaskProcess({ execution: task });
    tickClock(90);
    stub.emit.onDidEndTaskProcess({ execution: task });
    stub.emit.onDidStartDebugSession({ id: 'dbg1', configuration: { name: 'Launch' } });
    tickClock(45);
    stub.emit.onDidTerminateDebugSession({ id: 'dbg1' });
    await stub.commandHandlers['codetrackr.flushNow']();
    assert.strictEqual(lastUpload().runningSec, 135);
  });

  await check('a project change uploads at once, so the time stays with its project', async () => {
    const n = queued().length;
    tickClock(70);
    type(dsa);
    for (let s = 0; s < 10; s++) { tickClock(1); type(dsa); }
    stub.emit.onDidChangeWorkspaceFolders({ added: [], removed: [] });
    await settle(); await settle();
    assert.strictEqual(queued().length, n + 1);
    assert.strictEqual(lastUpload().duration, 10);
  });

  await check('ignored housekeeping commands (cd) do not start a run', async () => {
    engine.take(clock);
    const cd = { commandLine: { value: 'cd src' } };
    stub.emit.onDidStartTerminalShellExecution({ execution: cd });
    tickClock(120);
    stub.emit.onDidEndTerminalShellExecution({ execution: cd, exitCode: 0 });
    assert.strictEqual(engine.countedMs(clock), 0);
  });

  await check('per-file seconds of every upload add up to its duration', async () => {
    for (const p of queued()) {
      const sum = (p.perFile || []).reduce((a, f) => a + f.seconds, 0);
      assert.strictEqual(sum, p.duration, `upload ${p.flushId}: ${sum} vs ${p.duration}`);
      assert.strictEqual(p.writingSec + p.readingSec + p.runningSec, p.duration);
    }
  });

  await ext.deactivate();
  Date.now = realNow;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
