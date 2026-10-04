import { useEffect, useMemo, useRef, useState } from 'react';
import { yearGrid } from '../../lib/calendar';
import { dayLabel, hm, localDateKey } from '../../lib/format';

const GAP = 3;
const LABELS = 32; // the day-name column and its gap
const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/**
 * A year of coding at a glance (spec chart kit #4), like GitHub's
 * contribution graph but on the purple scale. Scrolls to today on narrow
 * screens. Hover a cell for the date and time; the summary line is what a
 * screen reader hears.
 */
export function YearHeatmap({ days, today = new Date(), summary }: { days: { date: string; seconds: number }[]; today?: Date; summary: string }) {
  const todayKey = localDateKey(today);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute per day, not per Date object
  const grid = useMemo(() => yearGrid(days, today), [days, todayKey]);
  const scroller = useRef<HTMLDivElement>(null);
  // Cells grow to fill the card (10-16 px); below 10 px the grid scrolls instead.
  const [CELL, setCell] = useState(12);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => setCell(Math.max(10, Math.min(16, Math.floor((el.clientWidth - LABELS) / grid.weeks.length) - GAP)));
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grid.weeks.length]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [grid, CELL]);

  const width = grid.weeks.length * (CELL + GAP);
  return (
    <figure className="m-0">
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div className="flex gap-2" style={{ width: width + LABELS }}>
          <div aria-hidden="true" className="flex flex-col pt-[18px]" style={{ gap: GAP }}>
            {DAYS.map((d, i) => (
              <span key={i} className="font-mono text-[10px] leading-none text-faint" style={{ height: CELL, lineHeight: `${CELL}px` }}>
                {d}
              </span>
            ))}
          </div>
          <div>
            <div aria-hidden="true" className="relative h-[18px]">
              {grid.months.map((m) => (
                <span key={`${m.label}-${m.col}`} className="absolute top-0 font-mono text-[10px] text-faint" style={{ left: m.col * (CELL + GAP) }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div role="img" aria-label={summary} className="flex" style={{ gap: GAP }}>
              {grid.weeks.map((week, w) => (
                <div key={w} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((c) => (
                    <span
                      key={c.key}
                      title={c.future ? undefined : `${dayLabel(c.key)}: ${c.seconds ? hm(c.seconds) : 'no coding'}`}
                      className="block rounded-[3px]"
                      style={{ width: CELL, height: CELL, background: c.future ? 'transparent' : `var(--heat-${c.level})` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>{summary}</span>
        <span aria-hidden="true" className="flex items-center gap-1 font-mono text-[10px]">
          less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="inline-block rounded-[3px]" style={{ width: 10, height: 10, background: `var(--heat-${l})` }} />
          ))}
          more
        </span>
      </figcaption>
    </figure>
  );
}
