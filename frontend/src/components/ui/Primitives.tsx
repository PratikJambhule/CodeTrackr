import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from './Button';

export function Card({ children, className = '', as: As = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={`card ${className}`}>{children}</As>;
}

/** A card title row: a heading on the left, an optional note or action on the right. */
export function CardTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {children}
      </h2>
      {aside && <div className="font-mono text-xs text-muted">{aside}</div>}
    </div>
  );
}

type PillTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
const pillTones: Record<PillTone, string> = {
  neutral: 'border-line-strong text-muted',
  accent: 'border-transparent bg-accent-soft text-accent-ink',
  good: 'border-line-strong text-good-ink',
  warn: 'border-line-strong text-warn-ink',
  bad: 'border-transparent bg-bad-soft text-bad-ink',
};

export function Pill({ children, tone = 'neutral', title }: { children: ReactNode; tone?: PillTone; title?: string }) {
  return (
    <span title={title} className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] ${pillTones[tone]}`}>
      {children}
    </span>
  );
}

/** A row of mutually exclusive choices (Today / This week, 7 / 30 / 90 days). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-lg font-semibold transition ${size === 'sm' ? 'min-h-[36px] px-3 text-sm' : 'min-h-[40px] px-4 text-sm'} ${
              on ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1 basis-72">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="display text-balance text-[44px] text-ink sm:text-[56px]">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** A failed load: what happened, and a way to try again. */
export function ErrorBox({ title = 'This did not load', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-start gap-3 p-6">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-muted">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} icon={<RotateCw className="h-4 w-4" aria-hidden="true" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (src) {
    return <img src={src} alt="" width={size} height={size} className="flex-none rounded-full object-cover" style={{ width: size, height: size }} referrerPolicy="no-referrer" />;
  }
  return (
    <span aria-hidden="true" className="flex flex-none items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-ink" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </span>
  );
}

export function Logo({ size = 32, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/icon.png" alt="" width={size} height={size} className="rounded-lg" style={{ width: size, height: size }} />
      {showName && <span className="display text-[24px] tracking-[0.02em] text-ink">CodeTrackr</span>}
    </span>
  );
}

// ---- Form fields ---------------------------------------------------------------

const control =
  'w-full rounded-xl border border-line-strong bg-bg px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint ' +
  'focus:border-accent focus:outline-none focus-visible:outline-2';

function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

type Common = { label: string; hint?: ReactNode; error?: string };

export function TextField({ label, hint, error, className = '', ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={`${control} ${className}`} {...rest} />
    </FieldShell>
  );
}

export function TextArea({ label, hint, error, className = '', ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={`${control} ${className}`} {...rest} />
    </FieldShell>
  );
}

export function SelectField({ label, hint, error, className = '', children, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select id={id} aria-invalid={Boolean(error)} className={`${control} ${className}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}
