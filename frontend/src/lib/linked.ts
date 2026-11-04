import type { CodeforcesLink, LeetCodeLink } from '../types';

/** Easy / Medium / Hard as counts and shares of all solved, for the stacked bar (0 when nothing solved). */
export function difficultyMix(solved: LeetCodeLink['summary']['solved']) {
  const s = solved ?? { all: 0, easy: 0, medium: 0, hard: 0 };
  const total = s.easy + s.medium + s.hard;
  return (['easy', 'medium', 'hard'] as const).map((k) => ({
    key: k,
    label: k[0].toUpperCase() + k.slice(1),
    count: s[k],
    share: total ? s[k] / total : 0,
  }));
}

/** SVG polyline points for a rating history in a w×h box (oldest left; top = highest). '' if under 2 points. */
export function ratingLine(history: NonNullable<CodeforcesLink['summary']['ratingHistory']>, w: number, h: number): string {
  if (history.length < 2) return '';
  const ratings = history.map((r) => r.rating);
  const lo = Math.min(...ratings);
  const span = Math.max(1, Math.max(...ratings) - lo);
  return history.map((r, i) => `${((i / (history.length - 1)) * w).toFixed(1)},${(h - ((r.rating - lo) / span) * h).toFixed(1)}`).join(' ');
}

/**
 * Your Codeforces rating at the end of each month (YYYY-MM): the last contest result on or before
 * that month's end; null before your first contest.
 */
export function ratingAtMonthEnds(history: NonNullable<CodeforcesLink['summary']['ratingHistory']>, months: string[]): (number | null)[] {
  const sorted = [...history].sort((a, b) => a.t - b.t);
  return months.map((m) => {
    const [y, mo] = m.split('-').map(Number);
    const end = Date.UTC(y, mo, 1) / 1000; // first second of the next month
    let r: number | null = null;
    for (const h of sorted) if (h.t < end) r = h.rating;
    return r;
  });
}

/**
 * Positions (0–100 %) on one scale for the outlook's range, its middle and today's rating, with a
 * little room either side so nothing sits on the edge. Today's rating can lie outside the range.
 */
export function outlookScale(now: number, range: { low: number; mid: number; high: number }) {
  const lo = Math.min(range.low, now);
  const hi = Math.max(range.high, now);
  const pad = Math.max(20, (hi - lo) * 0.12);
  const at = (v: number) => Math.round(((v - (lo - pad)) / (hi - lo + 2 * pad)) * 1000) / 10;
  return { low: at(range.low), mid: at(range.mid), high: at(range.high), now: at(now) };
}
