import type { ReactNode } from 'react';

export interface BarItem {
  key: string;
  /** Label under the bar ("Mon", "09"). */
  label: string;
  value: number;
  /** Text above the bar ("2h30"). */
  display?: string;
  /** Hover text and accessible name. */
  title: string;
  highlight?: boolean;
  /** Stacked bars (commands that worked / failed): drawn bottom-up. */
  segments?: { value: number; color: string }[];
}

/**
 * Vertical bars (spec chart kit #3): the week, today by hour, failures by day.
 * Plain HTML, so labels stay crisp and the bars are buttons when they do
 * something (picking an hour on the Today view).
 */
export function Bars({
  items,
  goal,
  height = 180,
  onSelect,
  selected,
  label,
  showValues = true,
  footer,
}: {
  items: BarItem[];
  goal?: { value: number; label: string };
  height?: number;
  onSelect?: (index: number) => void;
  selected?: number | null;
  label: string;
  showValues?: boolean;
  footer?: ReactNode;
}) {
  const max = Math.max(goal?.value ?? 0, ...items.map((i) => i.value), 1e-9);
  const pct = (v: number) => `${Math.max(0, (v / max) * 100)}%`;
  // More than 8 bars: thinner gaps, no value labels, and only every `step`-th axis label.
  const dense = items.length > 8;
  const step = Math.max(1, Math.ceil(items.length / 6));

  return (
    <figure className="m-0" aria-label={label}>
      <div className="relative flex items-end" style={{ height, gap: dense ? 3 : 10 }}>
        {goal && goal.value > 0 && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed" style={{ bottom: pct(goal.value), borderColor: 'var(--warn)' }}>
            <span className="absolute -top-5 right-0 font-mono text-[10px] text-warn-ink">{goal.label}</span>
          </div>
        )}
        {items.map((item, i) => {
          const isSelected = selected === i;
          const bar = (
            <div className="flex h-full w-full flex-col items-center justify-end gap-1">
              {showValues && !dense && <span className="font-mono text-[11px] text-muted">{item.display}</span>}
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t-md rounded-b-[3px] transition-[height] duration-500"
                style={{
                  height: item.value > 0 ? pct(item.value) : 3,
                  minHeight: 3,
                  background: item.segments ? 'transparent' : item.value <= 0 ? 'var(--cell-future)' : isSelected || item.highlight ? 'var(--accent)' : 'var(--heat-2)',
                  outline: isSelected ? '2px solid var(--accent-ink)' : undefined,
                }}
              >
                {item.segments?.map((s, k) => (
                  <div key={k} style={{ height: item.value > 0 ? `${(s.value / item.value) * 100}%` : 0, background: s.color }} />
                ))}
              </div>
            </div>
          );
          return onSelect ? (
            <button
              key={item.key}
              type="button"
              title={item.title}
              aria-label={item.title}
              aria-pressed={isSelected}
              onClick={() => onSelect(i)}
              className="h-full min-w-0 flex-1 rounded-md hover:bg-surface-2"
            >
              {bar}
            </button>
          ) : (
            <div key={item.key} title={item.title} className="h-full min-w-0 flex-1">
              {bar}
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="mt-2 flex" style={{ gap: dense ? 3 : 10 }}>
        {items.map((item, i) => (
          <span key={item.key} className={`min-w-0 flex-1 whitespace-nowrap text-center font-mono text-[11px] ${item.highlight ? 'text-ink' : 'text-faint'}`}>
            {dense && i % step !== 0 ? '' : item.label}
          </span>
        ))}
      </div>
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item.key}>{item.title}</li>
        ))}
      </ul>
      {footer}
    </figure>
  );
}

/** Horizontal ranked bars (spec chart kit #5): languages, projects, commands. */
export function RankedBars({ items, empty }: { items: { label: string; value: number; display: string }[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty ?? 'Nothing yet.'}</p>;
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={item.label} className="flex items-center gap-3">
          <span className="w-28 flex-none truncate text-sm text-ink" title={item.label}>
            {item.label}
          </span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(item.value / max) * 100}%`, background: i === 0 ? 'var(--accent)' : `var(--heat-${Math.max(1, 4 - i)})` }}
            />
          </span>
          <span className="w-16 flex-none text-right font-mono text-xs text-muted num">{item.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar with a legend: commands or builds, red only for failures (chart kit #9). */
export function SplitBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.value} ${p.label}`).join(', ')}`} className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-surface-2">
        {total > 0 &&
          parts.map((p) => (p.value > 0 ? <span key={p.label} style={{ flex: p.value, background: p.color }} /> : null))}
      </div>
    </div>
  );
}
