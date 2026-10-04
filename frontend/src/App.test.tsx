import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ThemeProvider } from './theme';
import { ToastProvider } from './components/ui/Toast';

/** Answer every API call: the profile with `profileStatus`, everything else with empty data. */
function mockApi(profileStatus: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/user/profile')) {
        return new Response(JSON.stringify(profileStatus === 200 ? { success: true, user: { id: 'u1', name: 'Soham Test', email: 's@example.test', hasApiKey: false, apiKeyHint: null, legacyApiKey: false } } : { message: 'Unauthorized' }), { status: profileStatus });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('routing', () => {
  it('shows the landing page to a signed-out visitor, with install and sign-in actions', async () => {
    mockApi(401);
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: /your coding hours, on the scoreboard/i })).toBeInTheDocument();
    const install = screen.getAllByRole('link', { name: 'Install for VS Code' })[0];
    expect(install).toHaveAttribute('href', expect.stringContaining('marketplace.visualstudio.com'));
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
    // The hero tower is a real list a screen reader can read.
    expect(screen.getByRole('list', { name: 'Example standings' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor from a protected page to sign in, and remembers where they were going', async () => {
    mockApi(401);
    renderAt('/join/abc123');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(sessionStorage.getItem('codetrackr.afterLogin')).toBe('/join/abc123');
  });

  it('shows the app shell to a signed-in user', async () => {
    mockApi(200);
    renderAt('/goals');
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /account menu for soham test/i })).toBeInTheDocument();
  });

  it('signs out with a fresh load of the landing page (regression: it went to /login and remembered the page)', async () => {
    mockApi(200);
    renderAt('/goals');
    fireEvent.click(await screen.findByRole('button', { name: /account menu for soham test/i }));
    const replace = vi.fn();
    vi.stubGlobal('location', { ...window.location, replace });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/), expect.objectContaining({ method: 'POST' }));
    expect(sessionStorage.getItem('codetrackr.afterLogin')).toBeNull();
  });

  it('answers an unknown address with a page, not a blank screen', async () => {
    mockApi(401);
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { name: 'Off the track' })).toBeInTheDocument();
  });

  it('keeps the guide and privacy pages public', async () => {
    mockApi(401);
    renderAt('/privacy');
    expect(await screen.findByRole('heading', { level: 1, name: /what we collect, plainly/i })).toBeInTheDocument();
  });
});
