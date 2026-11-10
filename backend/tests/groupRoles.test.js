'use strict';
/** Group roles (plan slice 1, D-64): the creator is the owner, everything else follows from one comparison. */
const assert = require('assert');
const { roleOf, atLeast, canManage, hashInviteToken, newInviteToken, parseInviteOptions } = require('../services/groupRoles');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}

const group = { createdBy: 'u1' };
console.log('\ngroupRoles');
t('the creator is the owner, whatever the stored role says', () => assert.strictEqual(roleOf(group, { userId: 'u1', role: 'member' }), 'owner'));
t('a stored admin is an admin', () => assert.strictEqual(roleOf(group, { userId: 'u2', role: 'admin' }), 'admin'));
t('an existing member with no role is a member', () => assert.strictEqual(roleOf(group, { userId: 'u3' }), 'member'));
t('no membership means no role, even for the creator id', () => assert.strictEqual(roleOf(group, null), null));
t('a populated createdBy works', () => assert.strictEqual(roleOf({ createdBy: { _id: 'u1' } }, { userId: 'u1' }), 'owner'));
t('a populated membership user works', () => assert.strictEqual(roleOf(group, { userId: { _id: 'u1' } }), 'owner'));
t('atLeast orders the roles', () => {
  assert.ok(atLeast('owner', 'admin'));
  assert.ok(atLeast('admin', 'admin'));
  assert.ok(!atLeast('member', 'admin'));
  assert.ok(!atLeast(null, 'member'));
});
t('an admin can manage members but not another admin or the owner', () => {
  assert.ok(canManage('admin', 'member'));
  assert.ok(!canManage('admin', 'admin'));
  assert.ok(!canManage('admin', 'owner'));
  assert.ok(canManage('owner', 'admin'));
  assert.ok(!canManage('member', 'member'));
});
t('invite tokens are long, random and stored only as a hash', () => {
  const a = newInviteToken();
  assert.ok(a.length >= 32);
  assert.notStrictEqual(a, newInviteToken());
  assert.match(hashInviteToken(a), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(hashInviteToken(a), a);
});
t('invite options default and refuse out-of-range values', () => {
  assert.deepStrictEqual(parseInviteOptions({}), { ok: true, days: 7, maxUses: 25 });
  assert.deepStrictEqual(parseInviteOptions({ days: 1, maxUses: 1 }), { ok: true, days: 1, maxUses: 1 });
  assert.strictEqual(parseInviteOptions({ days: 0 }).ok, false);
  assert.strictEqual(parseInviteOptions({ days: 31 }).ok, false);
  assert.strictEqual(parseInviteOptions({ maxUses: 501 }).ok, false);
  assert.strictEqual(parseInviteOptions({ maxUses: 1.5 }).ok, false);
  assert.strictEqual(parseInviteOptions({ days: '7' }).ok, false);
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
