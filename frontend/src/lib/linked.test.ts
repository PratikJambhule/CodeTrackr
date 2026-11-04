import { describe, expect, it } from 'vitest';
import { difficultyMix, outlookScale, ratingAtMonthEnds, ratingLine } from './linked';

describe('difficultyMix', () => {
  it('splits solved problems into Easy / Medium / Hard shares', () => {
    const mix = difficultyMix({ all: 10, easy: 5, medium: 4, hard: 1 });
    expect(mix.map((m) => [m.label, m.count, m.share])).toEqual([['Easy', 5, 0.5], ['Medium', 4, 0.4], ['Hard', 1, 0.1]]);
  });
  it('is all zeros when nothing is solved or the summary is missing', () => {
    expect(difficultyMix(undefined).every((m) => m.count === 0 && m.share === 0)).toBe(true);
  });
});

describe('ratingLine', () => {
  it('spreads points across the width, highest rating at the top', () => {
    expect(ratingLine([{ t: 1, rating: 1000 }, { t: 2, rating: 1200 }, { t: 3, rating: 1100 }], 100, 20)).toBe('0.0,20.0 50.0,0.0 100.0,10.0');
  });
  it('is empty with fewer than two contests', () => {
    expect(ratingLine([{ t: 1, rating: 1000 }], 100, 20)).toBe('');
  });
});

describe('ratingAtMonthEnds', () => {
  it('takes the last contest on or before each month end, null before the first', () => {
    const t = (iso: string) => Date.parse(iso) / 1000;
    const history = [{ t: t('2026-02-10'), rating: 1200 }, { t: t('2026-02-25'), rating: 1260 }, { t: t('2026-04-03'), rating: 1300 }];
    expect(ratingAtMonthEnds(history, ['2026-01', '2026-02', '2026-03', '2026-04'])).toEqual([null, 1260, 1260, 1300]);
  });
});

describe('outlookScale', () => {
  it('keeps low < mid < high in order inside the scale, with room at the edges', () => {
    const s = outlookScale(1598, { low: 1483, mid: 1605, high: 1741 });
    expect(s.low).toBeGreaterThan(0);
    expect(s.high).toBeLessThan(100);
    expect(s.low < s.now && s.now < s.mid && s.mid < s.high).toBe(true);
  });
  it('fits today\'s rating when it lies outside the range', () => {
    const s = outlookScale(1900, { low: 1500, mid: 1600, high: 1700 });
    expect(s.now).toBeGreaterThan(s.high);
    expect(s.now).toBeLessThan(100);
  });
});
