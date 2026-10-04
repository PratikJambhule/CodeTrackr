export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition ' +
  'disabled:opacity-50 disabled:cursor-not-allowed select-none';

const variants: Record<ButtonVariant, string> = {
  // The brand gradient appears on the main action only (spec §4).
  primary: 'brand-gradient text-white shadow-card hover:brightness-110 active:brightness-95',
  secondary: 'border border-line-strong text-ink bg-transparent hover:bg-surface-2',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'border border-line-strong text-bad-ink hover:bg-bad-soft',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-3 text-sm',
  md: 'min-h-[44px] px-4 text-[15px]',
  lg: 'min-h-[52px] px-6 text-base',
};

/** Button styling for elements that are not <Button>, such as a plain <a> to Google sign-in. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}
