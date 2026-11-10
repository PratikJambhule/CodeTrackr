import type { GroupRole } from '../types';

/** What the viewer may do to one member row. The server enforces the same rules; this only hides buttons. */
export function memberActions(me: GroupRole | null | undefined, target: GroupRole, isSelf: boolean) {
  const none = { remove: false, promote: false, demote: false, transfer: false };
  if (isSelf || !me || me === 'member') return none;
  if (me === 'admin') return { ...none, remove: target === 'member' };
  return { remove: true, promote: target === 'member', demote: target === 'admin', transfer: true };
}

export const isGroupAdmin = (me: GroupRole | null | undefined) => me === 'owner' || me === 'admin';

const LABELS: Record<string, (target: string, detail: string | null) => string> = {
  member_removed: (t) => `removed ${t}`,
  group_renamed: () => 'edited the group details',
  role_changed: (t, d) => (d === 'admin' ? `made ${t} an admin` : `made ${t} a member`),
  ownership_transferred: (t) => `handed the group to ${t}`,
  invite_created: () => 'created an invite link',
  invite_revoked: () => 'revoked an invite link',
  joined_by_invite: () => 'joined with an invite link',
};

/** One activity-log line in plain words; an unknown action still reads sensibly. */
export function auditText(action: string, targetName: string | null | undefined, detail: string | null | undefined): string {
  const make = LABELS[action];
  return make ? make(targetName || 'someone who left', detail ?? null) : action.replace(/_/g, ' ');
}
