import { describe, expect, it } from 'vitest';
import { heatLevel, hourLabel, peakWindow, streaks, yearGrid } from './calendar';

describe('heat levels', () => {
  it('uses fixed, explainable thresholds', () => {
    expect([0, 60, 29 * 60, 30 * 60, 89 * 60, 90 * 60, 179 * 60, 180 * 60, 9 * 3600].map(heatLevel))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('year grid', () => {
  const today = new Date(2026, 9, 4, 15); // Sunday 4 Oct 2026
  const grid = yearGrid([{ date: '2026-10-04', seconds: 7200 }, { date: '2026-01-05', seconds: 600 }], today);

  it('has 53 Monday-first weeks ending with this week', () => {
    expect(grid.weeks).toHaveLength(53);
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    const last = grid.weeks[52];
    expect(last[0].key).toBe('2026-09-28'); // Monday
    expect(last[6].key).toBe('2026-10-04'); // Sunday = today
    expect(last[6].level).toBe(3);
  });
  it('marks future days', () => {
    const wed = yearGrid([], new Date(2026, 9, 7, 9)); // Wednesday
    const last = wed.weeks[52];
    expect(last[2].future).toBe(false);
    expect(last[3].future).toBe(true);
  });
  it('labels months where they start', () => {
    expect(grid.months.length).toBeGreaterThanOrEqual(11);
    expect(grid.months.at(-1)?.label).toBe('Sep');
    const cell = grid.weeks.flat().find((c) => c.key === '2026-01-05');
    expect(cell?.level).toBe(1);
  });
});

describe('streaks', () => {
  const today = new Date(2026, 9, 4, 10);
  it('counts back from today', () => {
    expect(streaks(['2026-10-02', '2026-10-03', '2026-10-04'], today)).toEqual({ current: 3, longest: 3 });
  });
  it('a day that has not been coded yet does not break the streak', () => {
    expect(streaks(['2026-10-02', '2026-10-03'], today).current).toBe(2);
  });
  it('a missed yesterday does', () => {
    expect(streaks(['2026-10-01', '2026-10-02'], today).current).toBe(0);
  });
  it('finds the longest run anywhere', () => {
    const keys = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-10-04'];
    expect(streaks(keys, today)).toEqual({ current: 1, longest: 4 });
  });
});

describe('peak window', () => {
  it('finds the busiest four hours, wrapping past midnight', () => {
    const hours = new Array(24).fill(0);
    hours[22] = 3600; hours[23] = 3600; hours[0] = 1800; hours[1] = 1800; hours[10] = 600;
    expect(peakWindow(hours)).toEqual({ start: 22, end: 2, share: 10800 / 11400 });
  });
  it('is null with no time at all', () => {
    expect(peakWindow(new Array(24).fill(0))).toBeNull();
  });
  it('labels hours', () => {
    expect(hourLabel(21)).toBe('21:00');
    expect(hourLabel(24)).toBe('00:00');
  });
});
