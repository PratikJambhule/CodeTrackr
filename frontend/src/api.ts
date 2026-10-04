import { QueryClient } from '@tanstack/react-query';
import { API_URL } from './config';

/** A non-2xx answer. `message` is the API's own message when it sent one. */
export class ApiError extends Error {
  status: number;
  id?: string;
  constructor(status: number, message: string, id?: string) {
    super(message);
    this.status = status;
    this.id = id;
  }
}

async function readError(res: Response, fallback: string): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const message = body?.message || body?.error || fallback;
  return new ApiError(res.status, message, body?.id);
}

/**
 * One fetcher for every React Query read. Sends the auth cookie and throws an
 * ApiError on a non-2xx, so a query lands in its error state instead of
 * rendering an error body as data.
 */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw await readError(res, `Could not load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

/** Writes (POST/PATCH/DELETE). Throws ApiError with the server's message. */
export async function apiSend<T = unknown>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res, 'Something went wrong. Try again.');
  return res.json().catch(() => ({})) as Promise<T>;
}

/** Text for an error shown to a person: the server's message, or a plain fallback. */
export function errorText(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof ApiError) {
    // 401 also means "wrong group password"; only the generic answer means signed out.
    if (err.status === 401 && (!err.message || err.message === 'Unauthorized')) return 'Your session has ended. Sign in again.';
    return err.message || fallback;
  }
  if (err instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return fallback;
}

/**
 * Shared cache. Data is fresh for 30 s, so switching pages re-uses answers
 * instead of refetching (M-11). A 401 is not retried: it means signed out.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
      refetchOnWindowFocus: true,
    },
  },
});
