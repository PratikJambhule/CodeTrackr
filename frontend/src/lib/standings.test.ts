import { describe, expect, it } from 'vitest';
import { cellsSummary, cumulative, dayCells, layoutEndLabels, movement, orderOnDay, ordinal, rank, type Racer } from './standings';

const H = 3600;
// The example week from the design proposal (hours per day, Mon..Sun).
const week: Racer[] = [
  { id: 'diya', name: 'Diya', total: 0, days: [2.5, 1, 3, 2, 0.5, 3.5, 2].map((h) => h * H) },
  { id: 'you', name: 'You', total: 0, isMe: true, days: [1.5, 2.5, 1, 3, 2.5, 1, 2.5].map((h) => h * H) },
  { id: 'rohan', name: 'Rohan', total: 0, days: [3, 0, 2, 1.5, 3, 2, 1].map((h) => h * H) },
  { id: 'kabir', name: 'Kabir', total: 0, days: [2, 1, 0, 2.5, 1, 0, 1.5].map((h) => h * H) },
].map((r) => ({ ...r, total: r.days!.reduce((a, b) => a + b, 0) }));

describe('rank', () => {
  it('orders by total and measures the gap to the leader', () => {
    const r = rank(week);
    expect(r.map((x) => x.racer.id)).toEqual(['diya', 'you', 'rohan', 'kabir']);
    expect(r[0].gap).toBe(0);
    expect(r[1].gap).toBe(0.5 * H);
    expect(r.map((x) => x.pos)).toEqual([1, 2, 3, 4]);
  });
  it('breaks ties by name so rows never jitter', () => {
    const r = rank([{ id: 'b', name: 'Bea', total: 10 }, { id: 'a', name: 'Ann', total: 10 }]);
    expect(r.map((x) => x.racer.id)).toEqual(['a', 'b']);
  });
  it('handles an empty board', () => {
    expect(rank([])).toEqual([]);
  });
});

describe('day cells', () => {
  it('follows the timing-screen rules', () => {
    const cells = dayCells(week);
    // Mon: Rohan had the most (best); Diya coded (first day cannot be a personal best).
    expect(cells.rohan[0]).toBe('best');
    expect(cells.diya[0]).toBe('coded');
    // Tue: Rohan did nothing.
    expect(cells.rohan[1]).toBe('off');
    // Thu: You had the most in the group.
    expect(cells.you[3]).toBe('best');
    // Tue: You had the most (2h 30m); Diya's 1h is below her Monday, so just "coded".
    expect(cells.you[1]).toBe('best');
    expect(cells.diya[1]).toBe('coded');
    // Thu: Kabir's 2h 30m beats his own earlier days but not You's 3h -> personal best.
    expect(cells.kabir[3]).toBe('pb');
    // Fri: You coded 2h 30m, below your Thursday and below Rohan -> coded.
    expect(cells.you[4]).toBe('coded');
  });
  it('shares "best" on a tie', () => {
    const cells = dayCells([
      { id: 'a', name: 'A', total: 0, days: [H] },
      { id: 'b', name: 'B', total: 0, days: [H] },
    ]);
    expect(cells.a[0]).toBe('best');
    expect(cells.b[0]).toBe('best');
  });
  it('marks days that have not happened yet', () => {
    const cells = dayCells(week, 5);
    expect(cells.you.slice(5)).toEqual(['future', 'future']);
    expect(cells.you[4]).not.toBe('future');
  });
});

describe('race helpers', () => {
  it('adds up running totals', () => {
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
    expect(cumulative([])).toEqual([]);
  });
  it('knows the order on any day of the week', () => {
    expect(orderOnDay(week, 0)).toEqual(['rohan', 'diya', 'kabir', 'you']);
    expect(orderOnDay(week, 1)[0]).toBe('you'); // You led after Tuesday
  });
  it('measures places gained', () => {
    expect(movement(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ c: 2, a: -1, b: -1 });
    expect(movement([], ['a'])).toEqual({ a: 0 });
  });
  it('pushes end labels apart without reordering them', () => {
    const ys = layoutEndLabels([100, 102, 50, 101], 12);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(12);
    expect(ys[2]).toBe(50); // far from the others: untouched
    expect(ys[0]).toBeLessThan(ys[3]);
    expect(ys[3]).toBeLessThan(ys[1]);
  });
  it('keeps labels inside the chart', () => {
    const ys = layoutEndLabels([195, 196, 197], 12, 0, 200);
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '22nd']);
  });
  it('reads the day cells out for a screen reader, skipping days not yet raced', () => {
    expect(cellsSummary(['best', 'off', 'pb', 'future'], ['Mon', 'Tue', 'Wed', 'Thu'])).toBe(
      'Mon: best in the group, Tue: day off, Wed: personal best',
    );
    expect(cellsSummary(['coded'], [])).toBe('day 1: coded');
  });
});
