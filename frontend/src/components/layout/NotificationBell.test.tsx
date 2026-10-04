import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationBell } from './NotificationBell';

const NOTES = [
  { _id: 'n1', type: 'deadline_missed', title: 'Goal Deadline Missed', message: 'Ship it has passed.', read: false, createdAt: new Date().toISOString() },
  { _id: 'n2', type: 'deadline_reminder', title: 'Goal Deadline Approaching', message: 'Due in 6 hours.', read: false, createdAt: new Date().toISOString() },
];

function mockApi() {
  let unread = NOTES.length;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.endsWith('/api/notifications/unread-count')) return new Response(JSON.stringify({ count: unread }));
    if (path.endsWith('/api/notifications/mark-all-read')) {
      unread = 0;
      return new Response(JSON.stringify({ updated: NOTES.length }));
    }
    if (path.endsWith('/api/notifications')) return new Response(JSON.stringify(NOTES.map((n) => ({ ...n, read: unread === 0 }))));
    return new Response('{}');
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('NotificationBell', () => {
  it('marks what you saw as read when you open it, so the count does not greet you again (regression)', async () => {
    const calls = mockApi();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NotificationBell />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    expect(await screen.findByText('Goal Deadline Missed')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.startsWith('PATCH ') && c.endsWith('/api/notifications/mark-all-read'))).toBe(true));
    // The badge clears, but this visit still shows which ones were new.
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getAllByText('(new)', { exact: false })).toHaveLength(2);
  });
});
