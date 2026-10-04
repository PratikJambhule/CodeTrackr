import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cumulative, layoutEndLabels } from '../../lib/standings';
import { dayLabel, hm, weekdayShort } from '../../lib/format';

export interface RaceSeries {
  id: string;
  name: string;
  /** Seconds per day, aligned with `dates`. */
  values: number[];
  isMe?: boolean;
}

const H = 300;
/** Room for the names at the line ends shrinks on narrow screens. */
const padFor = (w: number) => ({ left: 40, right: w < 460 ? 100 : 150, top: 16, bottom: 32 });

/** 1, 2, 5, 10, 20, 50 ... hours per grid line, aiming for about three lines. */
function niceStep(maxHours: number): number {
  const raw = Math.max(maxHours / 3, 0.25);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * How the week unfolded: each person's running total of hours, day by day
 * (spec chart kit #2). Names sit at the line ends instead of in a legend; you
 * are purple, the leader gold, everyone else grey. Hover, or focus the chart
 * and use the arrow keys, to read the totals on any day. A plain table carries
 * the same numbers for screen readers.
 */
export function RaceChart({ series, dates, title = 'Running total of hours' }: { series: RaceSeries[]; dates: string[]; title?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // The drawing is laid out in real pixels (viewBox = measured width), so text
  // stays 11-13 px whether the chart is 300 or 1,000 px wide.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  const visible = dates.length > 0 && series.length > 0;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setW(Math.max(300, Math.round(el.clientWidth || 640)));
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);
  const PAD = padFor(W);
  const nameMax = W < 460 ? 7 : 12;

  const model = useMemo(() => {
    const lines = series.map((s) => ({ ...s, cum: cumulative(s.values) }));
    const totals = lines.map((l) => l.cum.at(-1) ?? 0);
    const leaderTotal = Math.max(0, ...totals);
    const leaderId = lines.find((l) => (l.cum.at(-1) ?? 0) === leaderTotal && leaderTotal > 0)?.id;
    const maxHours = leaderTotal / 3600;
    const step = niceStep(maxHours);
    const top = Math.max(step, Math.ceil(maxHours / step) * step);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (dates.length <= 1 ? innerW / 2 : (i * innerW) / (dates.length - 1));
    const y = (seconds: number) => PAD.top + innerH - (seconds / 3600 / top) * innerH;
    const ends = layoutEndLabels(lines.map((l) => y(l.cum.at(-1) ?? 0) + 4), 15, PAD.top + 4, H - PAD.bottom);
    const ticks: number[] = [];
    for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
    const role = (l: (typeof lines)[number]) => (l.isMe ? 'me' : l.id === leaderId ? 'leader' : 'other');
    const drawOrder = [...lines].sort((a, b) => ({ other: 0, leader: 1, me: 2 })[role(a)] - ({ other: 0, leader: 1, me: 2 })[role(b)]);
    return { lines, drawOrder, ends, ticks, x, y, role };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PAD follows W
  }, [series, dates, W]);

  if (!visible) return null;

  const STROKE = { me: 'var(--accent)', leader: 'var(--gold)', other: 'var(--muted-line)' } as const;
  const WIDTH = { me: 3.5, leader: 3, other: 2 } as const;
  const LABEL = { me: 'var(--accent-ink)', leader: 'var(--gold)', other: 'var(--muted)' } as const;

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(dates.length - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? dates.length) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const hoverRows =
    hover === null
      ? []
      : model.lines
          .map((l) => ({ id: l.id, name: l.name, isMe: l.isMe, total: l.cum[hover] ?? 0 }))
          .sort((a, b) => b.total - a.total);

  return (
    <figure ref={box} className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${title}. Use the left and right arrow keys to read each day.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        onMouseLeave={() => setHover(null)}
        className="block overflow-visible rounded-lg"
      >
        {model.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={model.y(t * 3600)} y2={model.y(t * 3600)} style={{ stroke: 'var(--line)' }} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={PAD.left - 8} y={model.y(t * 3600) + 4} textAnchor="end" fontSize="11" fontFamily="Martian Mono, monospace" style={{ fill: 'var(--faint)' }}>
              {t === 0 ? '0' : `${Math.round(t * 10) / 10}h`}
            </text>
          </g>
        ))}
        {dates.map((d, i) =>
          i === 0 || i === dates.length - 1 || (dates.length <= 8 && i % 1 === 0) ? (
            <text key={d} x={model.x(i)} y={H - 10} textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'} fontSize="11" fontFamily="Martian Mono, monospace" style={{ fill: 'var(--faint)' }}>
              {dates.length <= 8 ? weekdayShort(d) : dayLabel(d)}
            </text>
          ) : null,
        )}
        {hover !== null && <line x1={model.x(hover)} x2={model.x(hover)} y1={PAD.top} y2={H - PAD.bottom} style={{ stroke: 'var(--line-strong)' }} />}
        {model.drawOrder.map((l) => {
          const r = model.role(l);
          return (
            <polyline
              key={l.id}
              points={l.cum.map((v, i) => `${model.x(i).toFixed(1)},${model.y(v).toFixed(1)}`).join(' ')}
              fill="none"
              style={{ stroke: STROKE[r] }}
              strokeWidth={WIDTH[r]}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {model.lines.map((l, i) => {
          const r = model.role(l);
          return (
            <text key={l.id} x={W - PAD.right + 8} y={model.ends[i]} fontSize="13" fontFamily="Instrument Sans, sans-serif" fontWeight={r === 'other' ? 500 : 700} style={{ fill: LABEL[r] }}>
              {l.name.length > nameMax ? `${l.name.slice(0, nameMax - 1)}…` : l.name} {hm(l.cum.at(-1) ?? 0).replace(' ', '')}
            </text>
          );
        })}
        {dates.map((d, i) => (
          <rect
            key={`hit-${d}`}
            x={model.x(i) - (W - PAD.left - PAD.right) / Math.max(1, dates.length - 1) / 2}
            y={PAD.top}
            width={(W - PAD.left - PAD.right) / Math.max(1, dates.length - 1)}
            height={H - PAD.top - PAD.bottom}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          aria-live="polite"
          className="card pointer-events-none absolute top-2 z-10 min-w-[170px] p-3 text-sm shadow-card"
          style={{ left: `${Math.min(70, (model.x(hover) / W) * 100)}%` }}
        >
          <div className="mb-1.5 font-mono text-[11px] text-muted">{dayLabel(dates[hover])}</div>
          {hoverRows.map((row) => (
            <div key={row.id} className={`flex justify-between gap-4 ${row.isMe ? 'font-bold text-accent-ink' : 'text-ink'}`}>
              <span className="truncate">{row.name}</span>
              <span className="font-mono num">{hm(row.total)}</span>
            </div>
          ))}
        </div>
      )}
      {/* A table ignores the sr-only width (tables grow to fit), so the wrapper carries it. */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            {dates.map((d) => (
              <th key={d} scope="col">
                {dayLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.lines.map((l) => (
            <tr key={l.id}>
              <th scope="row">{l.name}</th>
              {l.cum.map((v, i) => (
                <td key={i}>{hm(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
