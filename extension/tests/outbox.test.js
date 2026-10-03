/**
 * Persisted upload queue (roadmap item 8, fixes M-30). Runs against the built bundle.
 * Run: npm run build && node tests/outbox.test.js
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const restore = installVscodeStub(createVscodeStub().vscode);
const { Outbox, mergeAnalytics } = require(path.join(__dirname, '..', 'dist', 'extension.js'));

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}

function memoryStore(initial) {
  const data = { ...(initial || {}) };
  return { data, get: (k) => data[k], update: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); } };
}
const item = (id, ageMin = 1) => ({ flushId: id, duration: 60, timestamp: new Date(Date.now() - ageMin * 60000).toISOString() });

(async () => {
  console.log('\noutbox');

  await check('an enqueued upload is persisted and survives a restart', async () => {
    const store = memoryStore();
    const a = new Outbox(store);
    await a.enqueue(item('one'));
    const b = new Outbox(store); // "VS Code restarted"
    assert.strictEqual(b.size, 1);
    assert.strictEqual(b.peekAll()[0].flushId, 'one');
  });

  await check('drain sends oldest first and stops at the first transient failure', async () => {
    const box = new Outbox(memoryStore());
    for (const id of ['a', 'b', 'c']) await box.enqueue(item(id));
    const sent = [];
    await box.drain(async (p) => { sent.push(p.flushId); return p.flushId === 'b' ? 'retry' : 'ok'; });
    assert.deepStrictEqual(sent, ['a', 'b']);
    assert.deepStrictEqual(box.peekAll().map((p) => p.flushId), ['b', 'c']);
  });

  await check('a retried item keeps its flushId (so the server can de-duplicate it)', async () => {
    const box = new Outbox(memoryStore());
    await box.enqueue(item('keep-me'));
    await box.drain(async () => 'retry');
    const ids = [];
    await box.drain(async (p) => { ids.push(p.flushId); return 'ok'; });
    assert.deepStrictEqual(ids, ['keep-me']);
    assert.strictEqual(box.size, 0);
  });

  await check('items are never merged: three failures stay three uploads', async () => {
    const box = new Outbox(memoryStore());
    for (const id of ['x', 'y', 'z']) await box.enqueue(item(id));
    await box.drain(async () => 'retry');
    assert.strictEqual(box.size, 3);
  });

  await check('a permanently rejected item is dropped, not retried forever', async () => {
    const box = new Outbox(memoryStore());
    await box.enqueue(item('bad'));
    await box.enqueue(item('good'));
    const sent = [];
    await box.drain(async (p) => { sent.push(p.flushId); return p.flushId === 'bad' ? 'drop' : 'ok'; });
    assert.deepStrictEqual(sent, ['bad', 'good']);
    assert.strictEqual(box.size, 0);
  });

  await check('items older than the server accepts (24 h) are pruned before sending', async () => {
    const box = new Outbox(memoryStore());
    await box.enqueue(item('stale', 25 * 60));
    await box.enqueue(item('fresh'));
    const sent = [];
    await box.drain(async (p) => { sent.push(p.flushId); return 'ok'; });
    assert.deepStrictEqual(sent, ['fresh']);
  });

  await check('the queue is capped: the oldest items go first', async () => {
    const box = new Outbox(memoryStore(), 3);
    for (const id of ['1', '2', '3', '4']) await box.enqueue(item(id));
    assert.deepStrictEqual(box.peekAll().map((p) => p.flushId), ['2', '3', '4']);
  });

  await check('two drains at once do not send the same item twice', async () => {
    const box = new Outbox(memoryStore());
    await box.enqueue(item('only'));
    let sends = 0;
    const send = async () => { sends++; await new Promise((r) => setTimeout(r, 20)); return 'ok'; };
    await Promise.all([box.drain(send), box.drain(send)]);
    assert.strictEqual(sends, 1);
  });

  await check('garbage in storage is ignored, not fatal', async () => {
    const box = new Outbox(memoryStore({ 'codetrackr.outbox': 'not an array' }));
    assert.strictEqual(box.size, 0);
  });

  console.log('\ncarry-forward merge of contiguous signal-less intervals');

  await check('the merged interval starts at the EARLIER timestamp (M-30)', async () => {
    const earlier = { duration: 60, timestamp: '2026-10-03T10:00:00.000Z' };
    const later = { duration: 120, timestamp: '2026-10-03T10:01:00.000Z' };
    const m = mergeAnalytics(earlier, later);
    assert.strictEqual(m.timestamp, '2026-10-03T10:00:00.000Z');
    assert.strictEqual(m.duration, 180);
  });

  restore();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
