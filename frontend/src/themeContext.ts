import { createContext, useContext } from 'react';

/** "system" follows the operating system's light/dark setting. */
export type ThemeChoice = 'dark' | 'light' | 'system';

export interface ThemeState {
  choice: ThemeChoice;
  mode: 'dark' | 'light';
  setChoice: (c: ThemeChoice) => void;
}

// Lives apart from ThemeProvider (theme.tsx) so that file exports only a
// component, which React Fast Refresh needs to hot-swap it.
export const ThemeContext = createContext<ThemeState>({ choice: 'dark', mode: 'dark', setChoice: () => {} });

export const useTheme = () => useContext(ThemeContext);
