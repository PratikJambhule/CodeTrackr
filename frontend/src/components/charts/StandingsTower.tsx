import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Cell } from '../../lib/standings';
import { ordinal } from '../../lib/standings';
import { DayCells } from './DayCells';

export interface TowerRow {
  id: string;
  name: string;
  isMe?: boolean;
  /** Text in the right-hand column: the gap ("+1h 05m") or the total for the leader. */
  value: string;
  /** Places gained since the previous day or period (+2, -1, 0). */
  move?: number;
  cells?: Cell[];
  cellTitles?: string[];
  /** Extra columns, in the same order as `columns`. */
  extras?: ReactNode[];
  /** Read out by screen readers after the position and name. */
  summary?: string;
}

const POS_COLOR = ['var(--gold)', 'var(--silver)', 'var(--bronze)'];

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The signature component (spec §2): a live standings tower, borrowed from F1
 * timing. Rows are a real ordered list in rank order; when the order changes,
 * each row slides from its old place to its new one (FLIP: measure, invert,
 * play), so screen readers and keyboard users get a plain list and nobody who
 * asked for reduced motion sees movement.
 */
export function StandingsTower({
  rows,
  columns = [],
  valueHeader = 'Gap',
  dayHeader,
  dense = false,
  label = 'Standings',
}: {
  rows: TowerRow[];
  columns?: { label: string; title?: string }[];
  valueHeader?: string;
  dayHeader?: string;
  dense?: boolean;
  label?: string;
}) {
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const animate = !reducedMotion();
    nodes.current.forEach((el, id) => {
      const top = el.offsetTop;
      const before = tops.current.get(id);
      if (animate && before !== undefined && before !== top && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], {
          duration: 650,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
      tops.current.set(id, top);
    });
  });

  const hasCells = rows.some((r) => r.cells?.length);
  const rowH = dense ? 'min-h-[44px]' : 'min-h-[54px]';

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[232px]">
        <div aria-hidden="true" className="flex items-center gap-1.5 px-2 pb-2 font-mono text-[11px] uppercase tracking-[0.05em] text-faint sm:gap-3 sm:px-3">
          <span className="w-8 sm:w-9">Pos</span>
          <span className="min-w-[56px] flex-1 sm:min-w-[84px]">Name</span>
          {hasCells && <span className="hidden sm:block">{dayHeader ?? 'Days'}</span>}
          {columns.map((c) => (
            <span key={c.label} title={c.title} className="hidden w-16 text-right md:block">
              {c.label}
            </span>
          ))}
          <span className="w-7 sm:w-8" />
          <span className="w-[66px] text-right sm:w-[92px]">{valueHeader}</span>
        </div>
        <ol aria-label={label} className="relative flex flex-col gap-1">
          {rows.map((r, i) => (
            <li
              key={r.id}
              ref={(el) => {
                if (el) nodes.current.set(r.id, el);
                else nodes.current.delete(r.id);
              }}
              className={`flex items-center gap-1.5 rounded-xl px-2 sm:gap-3 sm:px-3 ${rowH} ${r.isMe ? 'bg-me' : ''}`}
            >
              <span className="sr-only">{`${ordinal(i + 1)}, ${r.isMe ? `${r.name} (you)` : r.name}, ${r.summary ?? r.value}`}</span>
              <span className={`display w-8 flex-none sm:w-9 ${dense ? 'text-[24px]' : 'text-[30px]'}`} style={{ color: POS_COLOR[i] ?? 'var(--ink)' }} aria-hidden="true">
                {i + 1}
              </span>
              <span className={`min-w-[56px] flex-1 truncate sm:min-w-[84px] ${r.isMe ? 'font-bold' : 'font-medium'} ${dense ? 'text-[15px]' : 'text-[17px]'}`} aria-hidden="true">
                {r.name}
                {r.isMe && <span className="ml-2 align-middle font-mono text-[11px] font-normal text-accent-ink">you</span>}
              </span>
              {hasCells && (
                <span className="hidden sm:block" aria-hidden="true">
                  <DayCells cells={r.cells ?? []} titles={r.cellTitles} size={dense ? 'sm' : 'md'} />
                </span>
              )}
              {columns.map((c, k) => (
                <span key={c.label} className="hidden w-16 text-right font-mono text-[13px] text-ink md:block" aria-hidden="true">
                  {r.extras?.[k]}
                </span>
              ))}
              <span className="w-7 flex-none text-center font-mono text-[12px] sm:w-8" aria-hidden="true" style={{ color: !r.move ? 'var(--faint)' : r.move > 0 ? 'var(--good-ink)' : 'var(--bad-ink)' }}>
                {r.move === undefined ? '' : r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–'}
              </span>
              <span className={`w-[66px] flex-none text-right font-mono text-[12px] num sm:w-[92px] sm:text-[14px] ${i === 0 ? 'text-ink' : 'text-muted'}`} aria-hidden="true">
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
