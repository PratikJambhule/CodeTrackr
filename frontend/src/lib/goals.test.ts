import { describe, expect, it } from 'vitest';
import { splitGoals } from './goals';
import type { Goal } from '../types';

const NOW = new Date('2026-10-04T12:00:00+05:30');
const day = 864e5;
const at = (days: number) => new Date(NOW.getTime() + days * day).toISOString();
const goal = (title: string, deadlineInDays: number, extra: Partial<Goal> = {}): Goal => ({
  _id: title,
  title,
  targetHours: 1,
  deadline: at(deadlineInDays),
  status: 'in-progress',
  ...extra,
});

describe('splitGoals', () => {
  it('keeps upcoming and recently missed goals current; long-overdue ones move to older (regression: year-old goals topped the page)', () => {
    const { current, older } = splitGoals(
      [goal('next week', 7), goal('missed last week', -7), goal('missed in November', -328), goal('tomorrow', 1)],
      NOW,
    );
    expect(current.map((g) => g.title)).toEqual(['missed last week', 'tomorrow', 'next week']);
    expect(older.map((g) => g.title)).toEqual(['missed in November']);
  });

  it('shows recently completed goals after the open ones, and old completed goals under older, newest first', () => {
    const { current, older } = splitGoals(
      [
        goal('done yesterday', -2, { status: 'completed', completedAt: at(-1) }),
        goal('open', 3),
        goal('done in spring', -200, { status: 'completed', completedAt: at(-190) }),
        goal('done in summer', -100, { status: 'completed', completedAt: at(-95) }),
      ],
      NOW,
    );
    expect(current.map((g) => g.title)).toEqual(['open', 'done yesterday']);
    expect(older.map((g) => g.title)).toEqual(['done in summer', 'done in spring']);
  });
});
