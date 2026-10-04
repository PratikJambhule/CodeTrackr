import { hourLabel, peakWindow } from '../../lib/calendar';
import { hm } from '../../lib/format';

/** "When do I code?" (spec chart kit #6): 24 cells on the heatmap's purple scale. */
export function HourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 0);
  const peak = peakWindow(hours);
  const summary = peak
    ? `Most active between ${hourLabel(peak.start)} and ${hourLabel(peak.end)} (${Math.round(peak.share * 100)}% of your time this week).`
    : 'No coding in the last 7 days.';
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} className="flex gap-[3px]">
        {hours.map((s, h) => {
          const level = s <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((s / max) * 4));
          return <span key={h} title={`${hourLabel(h)}–${hourLabel(h + 1)}: ${s ? hm(s) : 'no coding'}`} className="h-14 flex-1 rounded-[4px]" style={{ background: `var(--heat-${level})` }} />;
        })}
      </div>
      <div aria-hidden="true" className="mt-2 flex justify-between font-mono text-[10px] text-faint">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <figcaption className="mt-3 text-sm text-muted">{summary}</figcaption>
    </figure>
  );
}
