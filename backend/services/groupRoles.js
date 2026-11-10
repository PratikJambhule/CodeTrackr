'use strict';

/**
 * Who may do what in a group (plan slice 1, D-64). Pure; unit-tested in tests/groupRoles.test.js.
 *
 * The owner is always `Group.createdBy`, so there is one source of truth and older groups need no
 * migration. `GroupMember.role` only records who is an admin; no value means member.
 */
const crypto = require('crypto');

const RANK = { member: 1, admin: 2, owner: 3 };

const idOf = (v) => String((v && v._id) || v);

function roleOf(group, membership) {
  if (!membership) return null;
  if (idOf(group.createdBy) === idOf(membership.userId)) return 'owner';
  return membership.role === 'admin' ? 'admin' : 'member';
}

const atLeast = (role, min) => Boolean(role) && RANK[role] >= RANK[min];

/** May someone with `actor` role act on (remove) someone with `target` role? Only strictly downward. */
const canManage = (actor, target) => atLeast(actor, 'admin') && RANK[actor] > RANK[target];

// Invite links work like API keys: a long random secret, only its hash stored, shown once.
const newInviteToken = () => crypto.randomBytes(24).toString('base64url');
const hashInviteToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const MAX_INVITE_DAYS = 30;
const MAX_INVITE_USES = 500;

function parseInviteOptions(body) {
  const { days = 7, maxUses = 25 } = body || {};
  if (!Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) {
    return { ok: false, error: `days must be a whole number from 1 to ${MAX_INVITE_DAYS}` };
  }
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES) {
    return { ok: false, error: `maxUses must be a whole number from 1 to ${MAX_INVITE_USES}` };
  }
  return { ok: true, days, maxUses };
}

module.exports = { roleOf, atLeast, canManage, newInviteToken, hashInviteToken, parseInviteOptions };
