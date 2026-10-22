/**
 * The work-mode picker (plan E12): the user says what they are doing; it is a label only when picked
 * or confirmed in the current coding session (user decision 2026-10-22).
 * Part 1 tests the WorkMode logic with a fake clock; part 2 runs the built extension against the
 * VS Code stub (status-bar item, command, Quick Pick, userMode in uploads).
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const realNow = Date.now;
let clock = Date.UTC(2026, 9, 22, 10, 0, 0);
Date.now = () => clock;
const advanceMin = (m) => { clock += m * 60000; };

const stub = createVscodeStub({ settings: { apiKey: '', minFlushMinutes: 2 } });
installVscodeStub(stub.vscode);
const ext = require(path.join(__dirname, '..', 'dist', 'extension.js'));
const { WorkMode } = ext;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}
const memStore = (init = {}) => { const m = { ...init }; return { get: (k) => m[k], update: (k, v) => { m[k] = v; return Promise.resolve(); }, m }; };

(async () => {
  console.log('\nwork mode (logic)');

  await check('a new workspace starts on Auto, which is never a label', async () => {
    const w = new WorkMode(memStore(), () => clock);
    assert.deepStrictEqual(w.payload(), { mode: 'auto', confirmed: false });
    assert.strictEqual(w.statusText(), '$(symbol-event) CodeTrackr: Auto');
  });

  await check('picking a mode remembers it and counts it as confirmed now', async () => {
    const s = memStore();
    const w = new WorkMode(s, () => clock);
    await w.set('dsa');
    assert.strictEqual(s.m['codetrackr.workMode'], 'dsa');
    assert.deepStrictEqual(w.payload(), { mode: 'dsa', confirmed: true });
    assert.ok(!w.statusText().endsWith('?'));
  });

  await check('a remembered mode from an earlier session is shown with "?" and sent as not confirmed', async () => {
    const w = new WorkMode(memStore({ 'codetrackr.workMode': 'project' }), () => clock);
    assert.deepStrictEqual(w.payload(), { mode: 'project', confirmed: false });
    assert.strictEqual(w.statusText(), '$(symbol-event) CodeTrackr: Project?');
    const items = w.pickItems();
    assert.strictEqual(items[0].confirmOnly, true, '"Still Project building" comes first');
    assert.match(items[0].label, /Still Project building/);
    assert.strictEqual(items.filter((i) => !i.confirmOnly).length, 6);
  });

  await check('"Still …" confirms without changing the mode', async () => {
    const w = new WorkMode(memStore({ 'codetrackr.workMode': 'learning' }), () => clock);
    await w.choose(w.pickItems()[0]);
    assert.deepStrictEqual(w.payload(), { mode: 'learning', confirmed: true });
  });

  await check('the confirmation lasts while uploads keep coming (same session)', async () => {
    const w = new WorkMode(memStore(), () => clock);
    await w.set('debugging');
    for (let i = 0; i < 5; i++) { advanceMin(20); assert.strictEqual(w.payload().confirmed, true, `upload ${i}`); }
  });

  await check('after 30 minutes with no upload the session is over: ask again', async () => {
    const w = new WorkMode(memStore(), () => clock);
    await w.set('setup');
    advanceMin(31);
    assert.deepStrictEqual(w.payload(), { mode: 'setup', confirmed: false });
    assert.ok(w.statusText().endsWith('?'));
  });

  await check('choosing Auto clears the label; dismissing the picker changes nothing', async () => {
    const w = new WorkMode(memStore(), () => clock);
    await w.set('dsa');
    await w.choose(undefined);
    assert.deepStrictEqual(w.payload(), { mode: 'dsa', confirmed: true });
    await w.choose(w.pickItems().find((i) => i.mode === 'auto'));
    assert.deepStrictEqual(w.payload(), { mode: 'auto', confirmed: false });
  });

  await check('a garbage stored value falls back to Auto', async () => {
    const w = new WorkMode(memStore({ 'codetrackr.workMode': 'C:\\secret' }), () => clock);
    assert.strictEqual(w.current(), 'auto');
  });

  console.log('\nwork mode (in the extension)');
  const wsStore = memStore({ 'codetrackr.workMode': 'dsa' });
  await ext.activate({
    subscriptions: [],
    globalState: memStore(),
    workspaceState: wsStore,
    secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve(), onDidChange: () => ({ dispose() {} }) },
  });

  await check('the status bar shows the remembered mode with "?" and opens the picker', async () => {
    const item = stub.statusItems.find((i) => i.command === 'codetrackr.setWorkMode');
    assert.ok(item, 'status-bar item exists');
    assert.strictEqual(item.visible, true);
    assert.strictEqual(item.text, '$(symbol-event) CodeTrackr: DSA?');
  });

  await check('an upload carries userMode; not confirmed until the user confirms', async () => {
    assert.deepStrictEqual(ext.buildPayloadForTest(120).userMode, { mode: 'dsa', confirmed: false });
  });

  await check('picking "Project building" in the Quick Pick: stored per workspace, confirmed, status updated', async () => {
    stub.quickPick.answer = (items) => items.find((i) => i.mode === 'project' && !i.confirmOnly);
    await stub.commandHandlers['codetrackr.setWorkMode']();
    assert.strictEqual(wsStore.m['codetrackr.workMode'], 'project');
    assert.deepStrictEqual(ext.buildPayloadForTest(120).userMode, { mode: 'project', confirmed: true });
    const item = stub.statusItems.find((i) => i.command === 'codetrackr.setWorkMode');
    assert.strictEqual(item.text, '$(symbol-event) CodeTrackr: Project');
  });

  await check('merging two held uploads keeps the newer userMode, it is not added up', async () => {
    const merged = ext.mergeAnalytics({ duration: 60, userMode: { mode: 'dsa', confirmed: false } },
      { duration: 60, userMode: { mode: 'project', confirmed: true } });
    assert.deepStrictEqual(merged.userMode, { mode: 'project', confirmed: true });
  });

  Date.now = realNow;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
