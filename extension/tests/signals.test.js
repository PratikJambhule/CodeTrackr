/**
 * The extra signals that make work types distinguishable (plan E7–E11): real debugging vs
 * "Run Without Debugging", runs (terminal, tasks, Code Runner), reading signals, files created and
 * deleted, and the workspace probe. Runs the built bundle against the VS Code stub.
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const stub = createVscodeStub({ settings: { apiKey: '' } });
installVscodeStub(stub.vscode);
const ext = require(path.join(__dirname, '..', 'dist', 'extension.js'));
const { DebugTracker, RunsTracker, isCodeRunnerOutput, classifyCommand, EditorTracker, probeWorkspace, sizeBucket, clonedWithin } = ext;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}
const ctx = () => ({ subscriptions: [] });
const doc = (fileName, scheme = 'file', uriText) => ({ fileName, languageId: 'cpp', uri: { scheme, toString: () => uriText || `${scheme}:${fileName}` } });

(async () => {
  console.log('\nsignals: debugging vs running (E7)');

  await check('"Run Without Debugging" is not a debug session; the debugger is', async () => {
    const d = new DebugTracker();
    d.onSessionStart({ id: 'a', configuration: { noDebug: true } });
    d.onSessionStart({ id: 'b', configuration: { name: 'Launch' } });
    assert.strictEqual(d.consumeInterval().debugSessions, 1);
  });

  await check('breakpoint stops and steps are counted from debugger messages; nothing else is', async () => {
    const d = new DebugTracker();
    d.onAdapterMessage({ type: 'event', event: 'stopped', body: { reason: 'breakpoint' } });
    d.onAdapterMessage({ type: 'event', event: 'stopped', body: { reason: 'exception' } });
    d.onAdapterMessage({ type: 'event', event: 'stopped', body: { reason: 'pause' } });     // the user paused: not a stop
    d.onAdapterMessage({ type: 'event', event: 'output', body: { output: 'x' } });
    d.onClientMessage({ type: 'request', command: 'next' });
    d.onClientMessage({ type: 'request', command: 'stepIn' });
    d.onClientMessage({ type: 'request', command: 'evaluate' });
    const s = d.consumeInterval();
    assert.strictEqual(s.breakpointStops, 2);
    assert.strictEqual(s.steps, 2);
  });

  await check('the debug adapter tracker is registered for real sessions only', async () => {
    const d = new DebugTracker();
    d.start(ctx());
    const factory = stub.debugTrackerFactories[stub.debugTrackerFactories.length - 1];
    assert.strictEqual(factory.createDebugAdapterTracker({ configuration: { noDebug: true } }), undefined);
    const tracker = factory.createDebugAdapterTracker({ configuration: {} });
    tracker.onDidSendMessage({ type: 'event', event: 'stopped', body: { reason: 'breakpoint' } });
    tracker.onWillReceiveMessage({ type: 'request', command: 'stepOut' });
    const s = d.consumeInterval();
    assert.strictEqual(s.breakpointStops, 1);
    assert.strictEqual(s.steps, 1);
    d.stop();
  });

  await check('node --inspect and python -m pdb are recognised as debugging (L-17)', async () => {
    assert.strictEqual(classifyCommand('node --inspect server.js').isDebug, true);
    assert.strictEqual(classifyCommand('python -m pdb app.py').isDebug, true);
    assert.strictEqual(classifyCommand('node server.js').isDebug, false);
  });

  console.log('\nsignals: runs (E8)');

  await check('terminal commands, tasks and Run Without Debugging are counted as runs', async () => {
    const r = new RunsTracker();
    r.start(ctx());
    stub.emit.onDidStartTerminalShellExecution({ execution: { commandLine: { value: 'python app.py' } } });
    stub.emit.onDidStartTerminalShellExecution({ execution: { commandLine: { value: 'cd src' } } });  // housekeeping
    stub.emit.onDidStartTaskProcess({ execution: {} });
    stub.emit.onDidStartDebugSession({ id: 'x', configuration: { noDebug: true } });
    stub.emit.onDidStartDebugSession({ id: 'y', configuration: {} });                          // real debugging
    assert.deepStrictEqual(r.consumeInterval(), { terminal: 1, task: 1, debugNoDebug: 1, codeRunner: 0 });
    r.stop();
  });

  await check('Code Runner runs are found by their [Running] / [Done] markers, with start and end times', async () => {
    const seen = [];
    const r = new RunsTracker({ onCodeRunnerStart: (ts) => seen.push(['start', ts]), onCodeRunnerEnd: (ts) => seen.push(['end', ts]) });
    r.onCodeRunnerOutput('[Running] cd "c:\\x\\" && g++ two_sum.cpp -o two_sum\n', 1000);
    r.onCodeRunnerOutput('5\n', 1500);
    r.onCodeRunnerOutput('\n[Done] exited with code=0 in 0.62 seconds\n', 1620);
    assert.deepStrictEqual(seen, [['start', 1000], ['end', 1620]]);
    assert.strictEqual(r.consumeInterval().codeRunner, 1);
  });

  await check('only the Code Runner output channel is watched', async () => {
    assert.strictEqual(isCodeRunnerOutput(doc('Code', 'output', 'output:extension-output-formulahendry.code-runner-#1-Code')), true);
    assert.strictEqual(isCodeRunnerOutput(doc('Git', 'output', 'output:git')), false);
    assert.strictEqual(isCodeRunnerOutput(doc('/x/code-runner-notes.md', 'file')), false);
  });

  console.log('\nsignals: reading and files (E9, E11)');

  await check('text written to the Output panel is not counted as typing (L-19)', async () => {
    const t = new EditorTracker();
    t.start(ctx());
    stub.emit.onDidChangeTextDocument({ document: doc('Git', 'output'), contentChanges: [{ text: 'lots of git output\n', rangeLength: 0 }] });
    stub.emit.onDidChangeTextDocument({ document: doc('/x/a.cpp'), contentChanges: [{ text: 'int\n', rangeLength: 0 }] });
    const s = t.consumeInterval();
    assert.strictEqual(s.charsInserted, 4);
    assert.strictEqual(s.linesInserted, 1);
    t.stop();
  });

  await check('scrolling is counted in bursts; Go to Definition / Find jumps are navigations', async () => {
    const t = new EditorTracker();
    t.recordScroll(1000); t.recordScroll(1100); t.recordScroll(1500);  // one burst
    t.recordScroll(4000);                                                // a second one
    t.recordSelection(3);  // by a command
    t.recordSelection(1);  // keyboard
    t.recordSelection(2);  // mouse
    const s = t.getSignals();
    assert.strictEqual(s.scrollEvents, 2);
    assert.strictEqual(s.navigations, 1);
  });

  await check('files created and deleted are counted, and created files are remembered by base name', async () => {
    const t = new EditorTracker();
    t.start(ctx());
    stub.emit.onDidCreateFiles({ files: [{ fsPath: 'C:\\p\\src\\two_sum.cpp' }, { fsPath: '/p/notes.md' }] });
    stub.emit.onDidDeleteFiles({ files: [{ fsPath: '/p/old.js' }] });
    const s = t.getSignals();
    assert.strictEqual(s.filesCreated, 2);
    assert.strictEqual(s.filesDeleted, 1);
    assert.deepStrictEqual([...s.created].sort(), ['notes.md', 'two_sum.cpp']);
    t.consumeInterval();
    assert.strictEqual(t.getSignals().filesCreated, 0, 'reset each interval');
    t.stop();
  });

  console.log('\nsignals: the kind of project (E10)');

  await check('source-file counts become buckets', async () => {
    assert.deepStrictEqual([0, 1, 2, 5, 6, 20, 21, 100, 101, 500, 501].map(sizeBucket),
      ['0', '1', '2-5', '2-5', '6-20', '6-20', '21-100', '21-100', '101-500', '101-500', '500+']);
  });

  await check('a recent clone is found from the first line of the Git log; only the marker and time are read', async () => {
    const now = Date.UTC(2026, 9, 22);
    const line = (daysAgo, action) => `0000000 abc123 Me <me@x.com> ${Math.floor((now - daysAgo * 86400000) / 1000)} +0530\t${action}\n`;
    assert.strictEqual(clonedWithin(line(3, 'clone: from https://github.com/x/tutorial'), now), true);
    assert.strictEqual(clonedWithin(line(30, 'clone: from https://github.com/x/tutorial'), now), false);
    assert.strictEqual(clonedWithin(line(1, 'commit (initial): first'), now), false);
    assert.strictEqual(clonedWithin(undefined, now), false);
  });

  await check('the probe sends only a bucket and yes/no flags, and survives failing inputs', async () => {
    const now = Date.UTC(2026, 9, 22);
    const snap = await probeWorkspace({
      countSourceFiles: async () => 3,
      exists: async (rel) => rel === 'package.json' || rel === '.git',
      readText: async () => `0 1 A <a@b> ${Math.floor(now / 1000) - 86400} +0000\tclone: from https://github.com/secret/repo\n`,
      ownCommits: async () => false,
    }, now);
    assert.deepStrictEqual(snap, { sourceFilesBucket: '2-5', hasPackageJson: true, hasRequirements: false, hasGit: true, ownCommits: false, clonedRecently: true });
    assert.ok(!JSON.stringify(snap).includes('secret'));
    const broken = await probeWorkspace({
      countSourceFiles: async () => { throw new Error('x'); }, exists: async () => { throw new Error('x'); },
      readText: async () => { throw new Error('x'); }, ownCommits: async () => { throw new Error('x'); },
    }, now);
    assert.deepStrictEqual(broken, { sourceFilesBucket: '0', hasPackageJson: false, hasRequirements: false, hasGit: false, ownCommits: null, clonedRecently: false });
  });

  console.log('\nsignals: in the upload');

  await check('the upload carries runs, debug, reading, file counts and the workspace block', async () => {
    await ext.activate({
      subscriptions: [],
      globalState: { get: () => undefined, update: () => Promise.resolve() },
      secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve(), onDidChange: () => ({ dispose() {} }) },
    });
    stub.emit.onDidStartTaskProcess({ execution: { id: 'build' } });
    stub.emit.onDidStartDebugSession({ id: 'n1', configuration: { noDebug: true } });
    stub.emit.onDidCreateFiles({ files: [{ fsPath: '/p/new.js' }] });
    const p = ext.buildPayloadForTest(30);
    assert.strictEqual(p.runs.task, 1);
    assert.strictEqual(p.runs.debugNoDebug, 1);
    assert.deepStrictEqual(Object.keys(p.debug), ['sessions', 'breakpointStops', 'steps']);
    assert.deepStrictEqual(Object.keys(p.reading), ['scrollEvents', 'navigations', 'docFileSec', 'filesOpenedNotEdited']);
    assert.strictEqual(p.filesCreated, 1);
    assert.ok('workspace' in p);
    await ext.deactivate();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
