const assert = require('assert');
const { hashPassword, verifyPassword, isHashed } = require('../services/passwordHash');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

(async () => {
  console.log('\npasswordHash');

  await check('hash then verify round-trips', async () => {
    const stored = await hashPassword('correct horse');
    assert.strictEqual(await verifyPassword('correct horse', stored), true);
  });

  await check('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse');
    assert.strictEqual(await verifyPassword('wrong horse', stored), false);
  });

  await check('never stores the plaintext', async () => {
    const stored = await hashPassword('hunter2');
    assert.ok(!stored.includes('hunter2'), 'plaintext present in stored value');
    assert.ok(stored.startsWith('scrypt$'), `unexpected format: ${stored}`);
  });

  await check('two hashes of the same password differ (salted)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notStrictEqual(a, b);
  });

  await check('still accepts a legacy plaintext value', async () => {
    assert.strictEqual(await verifyPassword('oldpass', 'oldpass'), true);
    assert.strictEqual(await verifyPassword('nope', 'oldpass'), false);
  });

  await check('isHashed distinguishes the two formats', async () => {
    assert.strictEqual(isHashed(await hashPassword('x')), true);
    assert.strictEqual(isHashed('plaintext'), false);
    assert.strictEqual(isHashed(null), false);
  });

  await check('handles empty and null stored values safely', async () => {
    assert.strictEqual(await verifyPassword('x', null), false);
    assert.strictEqual(await verifyPassword('x', ''), false);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
