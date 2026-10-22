import type { WorkSession, WorkTypeId } from '../types';

/**
 * Work types on the website (plan W2). People see 3 groups; labels keep the 5 types the model needs
 * (user decision 2026-10-22). Mirrors backend/services/workType.js GROUP_OF.
 */
export const WORK_GROUPS = [
  { id: 'dsa', label: 'DSA', types: ['dsa'] },
  { id: 'project_work', label: 'Project work', types: ['project', 'debugging'] },
  { id: 'learning_setup', label: 'Learning & setup', types: ['learning', 'setup'] },
] as const;

export type WorkGroupId = (typeof WORK_GROUPS)[number]['id'];

export const TYPE_LABEL: Record<WorkTypeId, string> = {
  dsa: 'DSA practice',
  project: 'Building',
  debugging: 'Debugging',
  learning: 'Learning',
  setup: 'Setup',
};

export function groupOf(type: string | null | undefined): WorkGroupId | null {
  const g = WORK_GROUPS.find((x) => (x.types as readonly string[]).includes(type ?? ''));
  return g ? g.id : null;
}

export const groupLabel = (id: WorkGroupId | null) => WORK_GROUPS.find((g) => g.id === id)?.label ?? 'Not sure';

/**
 * What to show for a session:
 *  answered  the user said it on the website
 *  picker    the user said it in VS Code's status bar (confirmed that session)
 *  guess     show the guess with ✓ / Change
 *  blind     ask "What was this session?" without a guess
 *  none      too little activity to ask about
 */
export type SessionState = 'answered' | 'picker' | 'guess' | 'blind' | 'none';

export function sessionState(s: WorkSession): SessionState {
  if (s.userLabel) return 'answered';
  if (s.pickerLabel) return 'picker';
  if (s.prompt === 'blind') return 'blind';
  if (s.prompt === 'guess') return 'guess';
  return 'none';
}

/** The best known type: what the user said, else the guess (null when nothing is known). */
export function knownType(s: WorkSession): string | null {
  return s.userLabel?.type ?? s.pickerLabel?.type ?? s.workType?.type ?? null;
}

/** Minutes per group, for the summary chips. Sessions with no known group count as "Not sure". */
export function groupMinutes(sessions: WorkSession[]): { id: WorkGroupId | null; label: string; minutes: number }[] {
  const by = new Map<WorkGroupId | null, number>();
  for (const s of sessions) {
    if (sessionState(s) === 'none') continue;
    const g = groupOf(knownType(s));
    by.set(g, (by.get(g) ?? 0) + s.minutes);
  }
  return [...by.entries()]
    .map(([id, minutes]) => ({ id, label: groupLabel(id), minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** Sessions still waiting for an answer, newest first ("label your past week"). */
export function toLabel(sessions: WorkSession[], days = 7, now = Date.now()): WorkSession[] {
  const since = now - days * 864e5;
  return sessions.filter((s) => Date.parse(s.startAt) >= since && (sessionState(s) === 'guess' || sessionState(s) === 'blind'));
}

/** Setup above this share of all coding time gets a gentle warning on the Learning & setup tab. */
export const SETUP_WARN_SHARE = 0.25;

/** The tab to open first: the kind of work with the most minutes (DSA on a tie or when empty). */
export function biggestGroup(groups: Record<WorkGroupId, { minutes: number }>): WorkGroupId {
  return WORK_GROUPS.reduce<WorkGroupId>((best, g) => (groups[g.id].minutes > groups[best].minutes ? g.id : best), 'dsa');
}
