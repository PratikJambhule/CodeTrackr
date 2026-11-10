import { describe, expect, it } from 'vitest';
import { auditText, isGroupAdmin, memberActions } from './groupRoles';

describe('memberActions', () => {
  it('gives a member and a non-member no actions', () => {
    expect(memberActions('member', 'member', false)).toEqual({ remove: false, promote: false, demote: false, transfer: false });
    expect(memberActions(null, 'member', false).remove).toBe(false);
  });
  it('lets an admin remove members only', () => {
    expect(memberActions('admin', 'member', false)).toEqual({ remove: true, promote: false, demote: false, transfer: false });
    expect(memberActions('admin', 'admin', false).remove).toBe(false);
    expect(memberActions('admin', 'owner', false).remove).toBe(false);
  });
  it('lets the owner manage others but not their own row', () => {
    expect(memberActions('owner', 'member', false)).toEqual({ remove: true, promote: true, demote: false, transfer: true });
    expect(memberActions('owner', 'admin', false)).toEqual({ remove: true, promote: false, demote: true, transfer: true });
    expect(memberActions('owner', 'owner', true).remove).toBe(false);
  });
});

describe('isGroupAdmin', () => {
  it('is true for owner and admin only', () => {
    expect(isGroupAdmin('owner')).toBe(true);
    expect(isGroupAdmin('admin')).toBe(true);
    expect(isGroupAdmin('member')).toBe(false);
    expect(isGroupAdmin(undefined)).toBe(false);
  });
});

describe('auditText', () => {
  it('reads as plain words', () => {
    expect(auditText('role_changed', 'Diya', 'admin')).toBe('made Diya an admin');
    expect(auditText('role_changed', 'Diya', 'member')).toBe('made Diya a member');
    expect(auditText('member_removed', null, null)).toBe('removed someone who left');
    expect(auditText('something_new', null, null)).toBe('something new');
  });
});
