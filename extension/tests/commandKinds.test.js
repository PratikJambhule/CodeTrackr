/**
 * Command kinds and the "no command text leaves the laptop" guarantee (plan E1 + E2).
 * The case table is shared with backend/tests/commandKinds.test.js.
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const stub = createVscodeStub();
installVscodeStub(stub.vscode);
const { commandKind, classifyCommand, TerminalTracker, COMMAND_KINDS } = require(path.join(__dirname, '..', 'dist', 'extension.js'));
const { cases } = require('./fixtures/commandKinds.json');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

// Drive the tracker through the same events VS Code fires.
function run(tracker, commandLine, exitCode = 0) {
  const execution = { commandLine: { value: commandLine } };
  stub.emit.onDidStartTerminalShellExecution({ execution });
  stub.emit.onDidEndTerminalShellExecution({ execution, exitCode });
}
function startedTracker() {
  const t = new TerminalTracker();
  t.start({ subscriptions: [] });
  return t;
}

console.log('\ncommandKind');

check(`every case in the shared table (${cases.length}) gets the expected kind`, () => {
  const wrong = [];
  for (const [cmd, want] of cases) {
    const got = classifyCommand(cmd).isIgnored ? 'ignored' : commandKind(cmd);
    if (got !== want) wrong.push(`"${cmd}": got ${got}, want ${want}`);
  }
  assert.deepStrictEqual(wrong, []);
});

check('the eight kinds, in a fixed order', () => {
  assert.deepStrictEqual(COMMAND_KINDS, ['install', 'run', 'compile', 'build', 'test', 'git', 'docker', 'other']);
});

check('the table covers every kind', () => {
  const seen = new Set(cases.map((c) => c[1]));
  for (const k of [...COMMAND_KINDS, 'ignored']) assert.ok(seen.has(k), k);
});

console.log('\nTerminalTracker: no command text in the upload');

check('a compile-error loop is counted by kind, with failures per kind', () => {
  const t = startedTracker();
  run(t, 'g++ two_sum.cpp -o a', 1);
  run(t, 'g++ two_sum.cpp -o a', 1);
  run(t, 'g++ two_sum.cpp -o a', 0);
  run(t, './a', 0);
  const s = t.consumeInterval();
  assert.strictEqual(s.commandKinds.compile, 3);
  assert.strictEqual(s.commandKinds.run, 1);
  assert.strictEqual(s.commandKinds.failed.compile, 2);
  assert.strictEqual(s.commandKinds.failed.run, 0);
  assert.strictEqual(s.totalCommands, 4);
  assert.strictEqual(s.failedCommands, 2);
  t.stop();
});

check('lastCommand and repeated failures carry a kind, never the command', () => {
  const t = startedTracker();
  run(t, 'npm test -- --grep login', 1);
  run(t, 'npm test -- --grep login', 1);
  run(t, 'curl https://api.example.com/data?token=abc123', 0);
  const s = t.consumeInterval();
  assert.strictEqual(s.lastCommand, 'other');
  assert.deepStrictEqual(s.repeatedFailedCommands, [{ command: 'test', count: 2 }]);
  t.stop();
});

check('no file name, URL, argument or token appears anywhere in the snapshot', () => {
  const t = startedTracker();
  for (const c of ['g++ two_sum.cpp -o a', 'python3 secret_plan.py --port 8000',
    'curl https://api.example.com/data?token=abc123', 'git commit -m "fix password bug"',
    'docker run -e API_KEY=xyz app', 'node server.js']) {
    run(t, c, 1);
    run(t, c, 1);
  }
  const text = JSON.stringify(t.consumeInterval());
  for (const leak of ['two_sum', 'secret_plan', '8000', 'example.com', 'token', 'abc123',
    'password', 'API_KEY', 'xyz', 'server.js', '.cpp', 'https']) {
    assert.ok(!text.includes(leak), `upload contains "${leak}"`);
  }
  t.stop();
});

check('"cd <folder>" and other shell housekeeping are not counted', () => {
  const t = startedTracker();
  run(t, 'cd src');
  run(t, 'cd ..');
  run(t, 'clear');
  run(t, 'npm run dev');
  const s = t.consumeInterval();
  assert.strictEqual(s.totalCommands, 1);
  assert.strictEqual(s.commandKinds.run, 1);
  t.stop();
});

check('the old per-tool counts are unchanged (servers and features still read them)', () => {
  const t = startedTracker();
  run(t, 'g++ a.cpp', 1);
  run(t, 'npm install', 0);
  const s = t.consumeInterval();
  assert.strictEqual(s.commandUsage.gcc, 1);
  assert.strictEqual(s.commandUsage.npm, 1);
  assert.strictEqual(s.buildRuns, 1);   // g++ still counts as a build in the old fields
  assert.strictEqual(s.failedBuilds, 1);
  t.stop();
});

check('consumeInterval resets the kinds', () => {
  const t = startedTracker();
  run(t, 'pytest', 1);
  t.consumeInterval();
  const s = t.consumeInterval();
  assert.strictEqual(s.commandKinds.test, 0);
  assert.strictEqual(s.commandKinds.failed.test, 0);
  assert.deepStrictEqual(s.repeatedFailedCommands, []);
  t.stop();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
