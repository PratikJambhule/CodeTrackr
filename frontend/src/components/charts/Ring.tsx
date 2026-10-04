import type { ReactNode } from 'react';
import { toneVar, type Tone } from './tone';

/** Progress towards a goal (spec chart kit #7). `value` is 0..1; over 1 shows full. */
export function Ring({ value, size = 64, stroke = 8, tone = 'accent', label, children }: { value: number; size?: number; stroke?: number; tone?: Tone; label: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <span className="relative inline-flex flex-none items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--surface-2)' }} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          style={{ stroke: toneVar[tone], transition: 'stroke-dasharray 600ms ease' }}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * v).toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}
