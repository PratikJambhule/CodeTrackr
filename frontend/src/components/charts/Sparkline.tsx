import { toneVar, type Tone } from './tone';

/** A trend line with no axes: decoration for a stat tile, so hidden from screen readers. */
export function Sparkline({ values, tone = 'accent', height = 28 }: { values: number[]; tone?: Tone; height?: number }) {
  const w = 120;
  if (values.length < 2) return <div style={{ height }} aria-hidden="true" />;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(2 + (i * (w - 4)) / (values.length - 1)).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline
        points={points}
        fill="none"
        style={{ stroke: toneVar[tone] }}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
