const assert = require('assert');
const Activity = require('../models/Activity');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

// Mongoose SchemaType objects have huge circular graphs — never pass one to
// assert.*(). Reduce to a primitive first.
const pathInstance = (p) => {
  const st = Activity.schema.path(p);
  return st ? st.instance : null;
};
const pathDefault = (p) => {
  const st = Activity.schema.path(p);
  return st ? st.defaultValue : 'NO_PATH';
};
const hasPath = (p) => Activity.schema.path(p) !== undefined;

const indexes = Activity.schema.indexes(); // [ [keySpec, options], ... ]
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hasKey = (keys) => indexes.some(([k]) => sameKey(k, keys));

console.log('\nActivity schema');
check('the dead `date` field is gone', () => {
  assert.strictEqual(hasPath('date'), false);
});
check('`bucketStart` exists (Date)', () => {
  assert.strictEqual(pathInstance('bucketStart'), 'Date');
});
check('`files` exists (Array)', () => {
  assert.strictEqual(pathInstance('files'), 'Array');
});
check('`flushCount` defaults to 1', () => {
  assert.strictEqual(pathDefault('flushCount'), 1);
});
check('analytics leaves have NO default (sparse on insert)', () => {
  assert.strictEqual(pathDefault('terminalAnalytics.totalCommands'), undefined);
  assert.strictEqual(pathDefault('editorAnalytics.charsInserted'), undefined);
  assert.strictEqual(pathDefault('gitAnalytics.commits'), undefined);
  assert.strictEqual(pathDefault('focusAnalytics.focusedMs'), undefined);
});

console.log('\nActivity indexes');
check('has {userId:1, timestamp:-1}', () => {
  assert.strictEqual(hasKey({ userId: 1, timestamp: -1 }), true);
});
check('has the partial-unique bucket index', () => {
  const ok = indexes.some(([k, o]) =>
    sameKey(k, { userId: 1, projectName: 1, language: 1, bucketStart: 1 }) &&
    o && o.unique === true &&
    o.partialFilterExpression && o.partialFilterExpression.bucketStart);
  assert.strictEqual(ok, true);
});
check('has a 400-day TTL on createdAt', () => {
  const ok = indexes.some(([k, o]) =>
    k.createdAt === 1 && o && o.expireAfterSeconds === 60 * 60 * 24 * 400);
  assert.strictEqual(ok, true);
});
check('the dead {userId:1, date:-1} index is gone', () => {
  assert.strictEqual(hasKey({ userId: 1, date: -1 }), false);
});
check('keeps {userId:1, projectName:1} and {userId:1, language:1}', () => {
  assert.strictEqual(hasKey({ userId: 1, projectName: 1 }), true);
  assert.strictEqual(hasKey({ userId: 1, language: 1 }), true);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
