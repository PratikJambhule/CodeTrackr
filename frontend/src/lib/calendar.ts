import { addDays, fromDateKey, localDateKey, mondayOf, monthShort } from './format';

/**
 * Year heatmap, streaks and the "when you code" window. Pure; unit-tested in
 * calendar.test.ts.
 */

/** Fixed thresholds, easy to explain: none, under 30 min, under 1h 30, under 3 h, 3 h+. */
export function heatLevel(seconds: number): 0 | 1 | 2 | 3 | 4 {
  if (!seconds || seconds <= 0) return 0;
  if (seconds < 30 * 60) return 1;
  if (seconds < 90 * 60) return 2;
  if (seconds < 180 * 60) return 3;
  return 4;
}

export interface HeatCell {
  key: string;
  seconds: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

export interface YearGrid {
  /** Columns of 7 cells, Monday first; the last column holds today. */
  weeks: HeatCell[][];
  /** Month labels and the column they start in. */
  months: { label: string; col: number }[];
}

export function yearGrid(days: { date: string; seconds: number }[], today: Date, weekCount = 53): YearGrid {
  const byDate = new Map(days.map((d) => [d.date, d.seconds]));
  const todayKey = localDateKey(today);
  const firstMonday = addDays(mondayOf(today), -7 * (weekCount - 1));
  const weeks: HeatCell[][] = [];
  const months: { label: string; col: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weekCount; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(firstMonday, w * 7 + d);
      const key = localDateKey(date);
      const seconds = byDate.get(key) ?? 0;
      col.push({ key, seconds, level: heatLevel(seconds), future: key > todayKey });
      if (d === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        months.push({ label: monthShort(lastMonth), col: w });
      }
    }
    weeks.push(col);
  }
  // Drop a first label that would be squeezed against the next one.
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();
  return { weeks, months };
}

/**
 * Current streak: consecutive active days ending today, or yesterday when
 * today has no activity yet (the day is not over). Same rule as the API.
 * Longest: the longest run anywhere in the data.
 */
export function streaks(activeKeys: Iterable<string>, today: Date): { current: number; longest: number } {
  const active = new Set(activeKeys);
  let current = 0;
  let start = active.has(localDateKey(today)) ? today : addDays(today, -1);
  if (active.has(localDateKey(start))) {
    while (active.has(localDateKey(start))) {
      current += 1;
      start = addDays(start, -1);
    }
  }
  let longest = 0;
  for (const key of active) {
    if (active.has(localDateKey(addDays(fromDateKey(key), -1)))) continue; // not a run start
    let run = 0;
    let d = fromDateKey(key);
    while (active.has(localDateKey(d))) {
      run += 1;
      d = addDays(d, 1);
    }
    longest = Math.max(longest, run);
  }
  return { current, longest: Math.max(longest, current) };
}

/**
 * The `width`-hour window (wrapping past midnight) with the most time: the
 * honest answer to "when do I code?". Null when there is no time at all.
 */
export function peakWindow(hourSeconds: number[], width = 4): { start: number; end: number; share: number } | null {
  const total = hourSeconds.reduce((a, b) => a + (b || 0), 0);
  if (total <= 0) return null;
  let best = -1;
  let bestStart = 0;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += hourSeconds[(s + k) % 24] || 0;
    if (sum > best) {
      best = sum;
      bestStart = s;
    }
  }
  return { start: bestStart, end: (bestStart + width) % 24, share: best / total };
}

export const hourLabel = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
