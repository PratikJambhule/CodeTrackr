import { describe, expect, it } from 'vitest';
import {
  addDays, dayLabel, deadlineKey, fromDateKey, gapLabel, hm, hmCompact, hoursHm, localDateKey, mondayOf,
  plural, relativeDay, timeAgo, tzOffset,
} from './format';

describe('durations', () => {
  it('formats seconds as hours and minutes', () => {
    expect(hm(0)).toBe('0m');
    expect(hm(59)).toBe('1m');
    expect(hm(45 * 60)).toBe('45m');
    expect(hm(2 * 3600 + 5 * 60)).toBe('2h 05m');
    expect(hm(-30)).toBe('0m');
    expect(hm(Number.NaN)).toBe('0m');
  });
  it('formats hours from the API the same way', () => {
    expect(hoursHm(1.5)).toBe('1h 30m');
    expect(hoursHm(0.17)).toBe('10m');
  });
  it('has a compact form for chart labels', () => {
    expect(hmCompact(0)).toBe('');
    expect(hmCompact(3600)).toBe('1h');
    expect(hmCompact(9000)).toBe('2h30');
    expect(hmCompact(600)).toBe('10m');
  });
  it('shows a gap like a timing screen', () => {
    expect(gapLabel(3900)).toBe('+1h 05m');
  });
  it('pluralises', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(3, 'day')).toBe('3 days');
  });
  it('says how long ago', () => {
    const now = Date.UTC(2026, 9, 4, 12);
    expect(timeAgo(now - 20e3, now)).toBe('Just now');
    expect(timeAgo(now - 5 * 60e3, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3600e3, now)).toBe('3h ago');
    expect(timeAgo(now - 2 * 864e5, now)).toBe('2d ago');
  });
});

describe('local dates (tests run in India, UTC+5:30)', () => {
  it('runs in the India time zone', () => {
    expect(tzOffset()).toBe(-330);
  });

  it('uses the LOCAL date, not the UTC one (regression: goals were created a day early)', () => {
    // 00:30 on 10 Oct in India is still 9 Oct in UTC.
    const justAfterMidnight = new Date(2026, 9, 10, 0, 30);
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-10-09');
    expect(localDateKey(justAfterMidnight)).toBe('2026-10-10');
    // The old calendar built the deadline from local midnight with toISOString:
    expect(new Date(2026, 9, 10).toISOString().split('T')[0]).toBe('2026-10-09');
    expect(localDateKey(new Date(2026, 9, 10))).toBe('2026-10-10');
  });

  it('round-trips date keys through local midnight', () => {
    const d = fromDateKey('2026-02-28');
    expect(d.getHours()).toBe(0);
    expect(localDateKey(addDays(d, 1))).toBe('2026-03-01');
  });

  it('finds the Monday of the week', () => {
    expect(localDateKey(mondayOf(new Date(2026, 9, 4, 23)))).toBe('2026-09-28'); // Sunday 4 Oct
    expect(localDateKey(mondayOf(new Date(2026, 8, 28, 1)))).toBe('2026-09-28'); // Monday itself
  });

  it('labels days and deadlines', () => {
    expect(dayLabel('2026-09-28')).toBe('Mon 28 Sep');
    const today = new Date(2026, 9, 4, 15);
    expect(relativeDay('2026-10-04', today)).toBe('today');
    expect(relativeDay('2026-10-05', today)).toBe('tomorrow');
    expect(relativeDay('2026-10-10', today)).toBe('in 6 days');
    expect(relativeDay('2026-10-01', today)).toBe('3 days ago');
  });

  it('reads a stored deadline as the date that was chosen', () => {
    // The API stores "2026-10-10" as 2026-10-10T00:00:00.000Z.
    expect(deadlineKey('2026-10-10T00:00:00.000Z')).toBe('2026-10-10');
  });
});
