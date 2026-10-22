/**
 * Tests for services/ingestRepair.js — repairing the live database after the stale-index 500s
 * (2026-10-22): which unique indexes are not declared by the schema, and which window counters
 * were inflated by failed retries.
 * Run: node tests/ingestRepair.test.js
 */
const assert = require('assert');
const { staleUniqueIndexes, windowRepairs } = require('../services/ingestRepair');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\ningestRepair');

const declared = [
  [{ userId: 1, timestamp: -1 }, {}],
  [{ userId: 1, projectName: 1, language: 1, bucketStart: 1 }, { unique: true, partialFilterExpression: { bucketStart: { $exists: true } } }],
];

check('a unique index the schema does not declare is stale; declared, _id and non-unique ones are kept', () => {
  const live = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'userId_1_timestamp_-1', key: { userId: 1, timestamp: -1 } },
    { name: 'bucket', key: { userId: 1, projectName: 1, language: 1, bucketStart: 1 }, unique: true },
    { name: 'userId_1_day_1_source_1_fileKey_1_hour_1_timestamp_1', key: { userId: 1, day: 1, source: 1, fileKey: 1, hour: 1, timestamp: 1 }, unique: true },
    { name: 'old_plain', key: { language: 1 } },
  ];
  assert.deepStrictEqual(staleUniqueIndexes(live, declared).map((i) => i.name), ['userId_1_day_1_source_1_fileKey_1_hour_1_timestamp_1']);
});

check('key order matters: the same fields in another order are a different index', () => {
  const live = [{ name: 'swapped', key: { projectName: 1, userId: 1, language: 1, bucketStart: 1 }, unique: true }];
  assert.deepStrictEqual(staleUniqueIndexes(live, declared).map((i) => i.name), ['swapped']);
});

check('a window counter above what was credited is reset to the credited seconds', () => {
  const usages = [
    { _id: 'a', userId: 'u1', bucketStart: new Date('2026-10-22T14:30:00Z'), seconds: 1025 },
    { _id: 'b', userId: 'u1', bucketStart: new Date('2026-10-22T14:20:00Z'), seconds: 120 },
    { _id: 'c', userId: 'u2', bucketStart: new Date('2026-10-22T14:30:00Z'), seconds: 700 },
  ];
  const credited = new Map([['u1|2026-10-22T14:30:00.000Z', 10], ['u1|2026-10-22T14:20:00.000Z', 120], ['u2|2026-10-22T14:30:00.000Z', 600]]);
  assert.deepStrictEqual(windowRepairs(usages, credited), [
    { _id: 'a', userId: 'u1', bucketStart: usages[0].bucketStart, from: 1025, to: 10 },
    { _id: 'c', userId: 'u2', bucketStart: usages[2].bucketStart, from: 700, to: 600 },
  ]);
});

check('a window with no bucket at all goes back to 0; a counter never goes up', () => {
  const usages = [{ _id: 'x', userId: 'u1', bucketStart: new Date('2026-10-22T14:40:00Z'), seconds: 300 },
    { _id: 'y', userId: 'u1', bucketStart: new Date('2026-10-22T14:50:00Z'), seconds: 50 }];
  const credited = new Map([['u1|2026-10-22T14:50:00.000Z', 90]]);
  assert.deepStrictEqual(windowRepairs(usages, credited).map((r) => [r._id, r.to]), [['x', 0]]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
