/**
 * The standings tower and the race chart (spec §2): ranking, gaps, day cells,
 * movement and end-label layout. Pure; unit-tested in standings.test.ts.
 * All amounts are seconds.
 */

export interface Racer {
  id: string;
  name: string;
  /** Seconds in the board's period. */
  total: number;
  /** Seconds per day of the board's window, oldest first (optional). */
  days?: number[];
  isMe?: boolean;
}

export interface Ranked<T extends Racer> {
  racer: T;
  pos: number;
  /** Seconds behind the leader (0 for the leader). */
  gap: number;
}

/** Highest total first; ties keep a stable order by name so rows do not jitter. */
export function rank<T extends Racer>(racers: T[]): Ranked<T>[] {
  const sorted = [...racers].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const lead = sorted.length ? sorted[0].total : 0;
  return sorted.map((racer, i) => ({ racer, pos: i + 1, gap: Math.max(0, lead - racer.total) }));
}

/**
 * best   = the most time in the group that day (ties share it)
 * pb     = your own best day of the window so far (at least one earlier day)
 * coded  = some time, not a best
 * off    = no time that day
 * future = the day has not happened yet
 */
export type Cell = 'best' | 'pb' | 'coded' | 'off' | 'future';

export function dayCells(racers: Racer[], futureFrom = Infinity): Record<string, Cell[]> {
  const length = Math.max(0, ...racers.map((r) => r.days?.length ?? 0));
  const dayMax = Array.from({ length }, (_, d) => Math.max(0, ...racers.map((r) => r.days?.[d] ?? 0)));
  const out: Record<string, Cell[]> = {};
  for (const r of racers) {
    const days = r.days ?? [];
    out[r.id] = Array.from({ length }, (_, d): Cell => {
      if (d >= futureFrom) return 'future';
      const v = days[d] ?? 0;
      if (v <= 0) return 'off';
      if (v === dayMax[d]) return 'best';
      if (d > 0 && v >= Math.max(...days.slice(0, d))) return 'pb';
      return 'coded';
    });
  }
  return out;
}

export const CELL_TEXT: Record<Cell, string> = {
  best: 'best in the group',
  pb: 'personal best',
  coded: 'coded',
  off: 'day off',
  future: 'not yet',
};

/** "Mon: best in the group, Tue: day off, ..." for a screen reader. */
export function cellsSummary(cells: Cell[], dayNames: string[]): string {
  return cells
    .map((c, i) => (c === 'future' ? null : `${dayNames[i] ?? `day ${i + 1}`}: ${CELL_TEXT[c]}`))
    .filter(Boolean)
    .join(', ');
}

/** Running totals: [1, 2, 3] -> [1, 3, 6]. */
export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v || 0));
}

/** Order of ids by total up to and including day `d` (the tower on day d). */
export function orderOnDay(racers: Racer[], d: number): string[] {
  return rank(racers.map((r) => ({ ...r, total: cumulative(r.days ?? []).at(Math.min(d, (r.days?.length ?? 1) - 1)) ?? 0 })))
    .map((x) => x.racer.id);
}

/** Places gained since the previous order: +2 = moved up two. New ids get 0. */
export function movement(previous: string[], now: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  now.forEach((id, i) => {
    const before = previous.indexOf(id);
    out[id] = before === -1 ? 0 : before - i;
  });
  return out;
}

/**
 * Push line-end labels apart so none overlap: input y positions (any order),
 * output positions in the same order, at least `gap` apart, kept inside
 * [top, bottom] where possible. Labels keep their relative order.
 */
export function layoutEndLabels(ys: number[], gap: number, top = -Infinity, bottom = Infinity): number[] {
  const order = ys.map((y, i) => ({ i, y })).sort((a, b) => a.y - b.y || a.i - b.i);
  for (let k = 0; k < order.length; k++) {
    const min = k === 0 ? top : order[k - 1].y + gap;
    if (order[k].y < min) order[k].y = min;
  }
  // If the stack ran past the bottom, shift it up as a block.
  const overflow = order.length ? order[order.length - 1].y - bottom : 0;
  if (overflow > 0) {
    for (const o of order) o.y -= overflow;
    for (let k = order.length - 2; k >= 0; k--) {
      if (order[k + 1].y - order[k].y < gap) order[k].y = order[k + 1].y - gap;
    }
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
