import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeChoice } from '../../themeContext';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'Match system', Icon: Monitor },
];

export function ThemeToggle({ withLabels = false }: { withLabels?: boolean }) {
  const { choice, setChoice } = useTheme();
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-xl border border-line bg-surface p-1">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          aria-label={withLabels ? undefined : label}
          title={label}
          onClick={() => setChoice(value)}
          className={`flex min-h-[36px] items-center gap-2 rounded-lg px-2.5 text-sm font-semibold ${choice === value ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {withLabels && label}
        </button>
      ))}
    </div>
  );
}
