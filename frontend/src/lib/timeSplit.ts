/** Writing / reading / running colours and labels, shared by the dashboard and the Insights tabs. */
export const SPLIT_PARTS = [
  { key: 'writingSec', label: 'Writing', color: 'var(--accent)' },
  { key: 'readingSec', label: 'Reading', color: 'var(--heat-2)' },
  { key: 'runningSec', label: 'Running', color: 'var(--good)' },
  { key: 'otherSec', label: 'Not split', color: 'var(--muted)' },
] as const;
