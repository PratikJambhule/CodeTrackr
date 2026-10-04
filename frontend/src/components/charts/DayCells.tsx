import type { Cell } from '../../lib/standings';

const CELL_BG: Record<Cell, string> = {
  best: 'var(--accent)',
  pb: 'var(--good)',
  coded: 'var(--warn)',
  off: 'var(--cell-off)',
  future: 'var(--cell-future)',
};

/** One small cell per day, coloured like timing-screen sectors (spec §4). */
export function DayCells({ cells, titles, size = 'md' }: { cells: Cell[]; titles?: string[]; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 11 : 15;
  const h = size === 'sm' ? 7 : 9;
  return (
    <span className="flex flex-none gap-[3px]" aria-hidden="true">
      {cells.map((c, i) => (
        <span key={i} title={titles?.[i]} className="rounded-[3px] transition-colors duration-300" style={{ width: w, height: h, background: CELL_BG[c] }} />
      ))}
    </span>
  );
}

export function CellLegend({ className = '' }: { className?: string }) {
  const items: Cell[] = ['best', 'pb', 'coded', 'off'];
  const label: Record<Cell, string> = { best: 'Best in group that day', pb: 'Personal best', coded: 'Coded', off: 'Day off', future: 'Not yet' };
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted ${className}`} aria-label="What the day cells mean">
      {items.map((c) => (
        <li key={c} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-[9px] w-[15px] rounded-[3px]" style={{ background: CELL_BG[c] }} />
          {label[c]}
        </li>
      ))}
    </ul>
  );
}
