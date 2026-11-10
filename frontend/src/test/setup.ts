import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy* waited 1 s by default. Lazy-loaded pages in a full parallel run can take longer on a busy
// machine, which failed App and NotificationBell tests at random. 5 s still fails a real bug fast.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());

// jsdom has no matchMedia; the theme and the tower's motion check read it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
