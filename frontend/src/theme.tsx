import { useEffect, useState, type ReactNode } from 'react';
import { readStored, writeStored } from './lib/storage';
import { ThemeContext, type ThemeChoice } from './themeContext';

/**
 * Two themes, done properly (spec §4), plus "system". The 28-theme picker was
 * removed in the 2026-10 redesign. index.html applies the saved choice before
 * the first paint; this keeps it in sync afterwards.
 */
const KEY = 'codetrackr.theme';

function systemPrefersLight() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

function resolveTheme(choice: ThemeChoice): 'dark' | 'light' {
  if (choice === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return choice;
}

function apply(mode: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#12101C' : '#F6F4FB');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const saved = readStored(KEY);
    return saved === 'light' || saved === 'system' ? saved : 'dark';
  });
  const [mode, setMode] = useState<'dark' | 'light'>(() => resolveTheme(choice));

  useEffect(() => {
    const update = () => {
      const m = resolveTheme(choice);
      setMode(m);
      apply(m);
    };
    update();
    writeStored(KEY, choice);
    if (choice !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, [choice]);

  return <ThemeContext.Provider value={{ choice, mode, setChoice }}>{children}</ThemeContext.Provider>;
}
