/** @type {import('tailwindcss').Config} */
// Colours are CSS variables (src/index.css), so one class works in both themes.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)', soft: 'var(--accent-soft)' },
        good: { DEFAULT: 'var(--good)', ink: 'var(--good-ink)' },
        warn: { DEFAULT: 'var(--warn)', ink: 'var(--warn-ink)' },
        bad: { DEFAULT: 'var(--bad)', ink: 'var(--bad-ink)', soft: 'var(--bad-soft)' },
        gold: 'var(--gold)',
        silver: 'var(--silver)',
        bronze: 'var(--bronze)',
        me: 'var(--me)',
        'bg-glass': 'var(--bg-glass)',
        'surface-glass': 'var(--surface-glass)',
      },
      fontFamily: {
        display: ['"Big Shoulders Display"', '"Arial Narrow"', 'sans-serif'],
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Martian Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
    },
  },
  plugins: [],
};
