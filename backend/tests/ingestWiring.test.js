const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'extension.js'), 'utf8');
const route = require('../routes/extension');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\n/track bucketing wiring');
check('the route requires the bucketing service', () => {
  assert.ok(/require\(['"]\.\.\/services\/activityBucket['"]\)/.test(src));
});
check('the route calls planActivityWrite', () => {
  assert.ok(/planActivityWrite\(/.test(src));
});
check('ACTIVITY_BUCKET_MS is read from env with a 600000 default', () => {
  assert.ok(/ACTIVITY_BUCKET_MS/.test(src) && /600000/.test(src));
});
check('the only Activity.create calls are in the legacy branch', () => {
  const creates = src.match(/Activity\.create\(/g) || [];
  assert.ok(creates.length <= 2, `expected <=2 Activity.create (track + batch legacy), found ${creates.length}`);
  assert.ok(/mode === 'legacy'/.test(src), "legacy guard present");
});
check('bucket writes use findOneAndUpdate with upsert', () => {
  assert.ok(/findOneAndUpdate\(/.test(src) && /upsert:\s*true/.test(src));
});
check('an 11000 duplicate-key is retried', () => {
  assert.ok(/11000/.test(src));
});
check('re-exports the bucketing helpers for tests', () => {
  assert.strictEqual(typeof route.planActivityWrite, 'function');
  assert.strictEqual(typeof route.hasSignal, 'function');
});

console.log('\nread-path compatibility');
const analyticsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'analytics.js'), 'utf8');
const leaderboardSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'leaderboard.js'), 'utf8');

check('/timeslot fileCount reads the bucket files[] array', () => {
  assert.ok(/a\.files/.test(analyticsSrc) && /flatMap/.test(analyticsSrc));
});
check('leaderboard activityCount is flush-based via flushCount', () => {
  assert.ok(/\$ifNull:\s*\[\s*['"]\$flushCount['"]/.test(leaderboardSrc));
});

console.log('\ningest payload validation (#12)');
check('/track and /track/batch bounds-check with ingestValidation', () => {
  assert.ok(/require\(['"]\.\.\/services\/ingestValidation['"]\)/.test(src), 'validator not required');
  assert.ok(/validateIngestPayload\(req\.body\)/.test(src), '/track does not call the validator');
  assert.ok(/validateIngestPayload\(activities\[i\]\)/.test(src), '/track/batch does not validate each element');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
