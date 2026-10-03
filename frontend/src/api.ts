import { QueryClient } from '@tanstack/react-query';
import { API_URL } from './config';

/**
 * One fetcher for every React Query read (roadmap item 11). Sends the auth
 * cookie, and throws on a non-2xx so the query lands in its error state
 * instead of rendering an error body as data.
 */
export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`GET ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Shared cache. Data is treated as fresh for 30 s: switching tabs or views
 * inside that window re-uses the cached answer instead of refetching (the
 * Dashboard used to fire three requests on every mount, one of them a
 * duplicate — M-11). Refetches when the window regains focus.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
