import type { Goal } from '../types';

const DAY = 864e5;
/** An open goal stays "current" this long after its deadline passes. */
export const OVERDUE_DAYS = 14;
/** A completed goal stays "current" this long after it was completed. */
export const COMPLETED_DAYS = 30;

/**
 * Split goals into what belongs on the page now and older ones (2026-10-04:
 * year-old test goals were topping the list as "overdue").
 * current: open goals not more than OVERDUE_DAYS past their deadline (soonest
 * first), then goals completed in the last COMPLETED_DAYS (newest first).
 * older: everything else, newest deadline first.
 */
export function splitGoals(goals: Goal[], now: Date = new Date()): { current: Goal[]; older: Goal[] } {
  const t = now.getTime();
  const open: Goal[] = [];
  const done: Goal[] = [];
  const older: Goal[] = [];
  for (const g of goals) {
    const deadline = new Date(g.deadline).getTime();
    if (g.status === 'completed') {
      const finished = new Date(g.completedAt ?? g.deadline).getTime();
      (t - finished <= COMPLETED_DAYS * DAY ? done : older).push(g);
    } else {
      (t - deadline <= OVERDUE_DAYS * DAY ? open : older).push(g);
    }
  }
  const by = (pick: (g: Goal) => string, dir: 1 | -1) => (a: Goal, b: Goal) => dir * pick(a).localeCompare(pick(b));
  open.sort(by((g) => g.deadline, 1));
  done.sort(by((g) => g.completedAt ?? g.deadline, -1));
  older.sort(by((g) => g.deadline, -1));
  return { current: [...open, ...done], older };
}
