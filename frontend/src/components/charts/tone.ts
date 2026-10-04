/** Chart colours by role, as CSS variables so both themes work (spec §4). */
export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'muted';

export const toneVar: Record<Tone, string> = {
  accent: 'var(--accent)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  muted: 'var(--muted-line)',
};
