import { API_URL } from '../../config';

/**
 * Ends the session on the server, then loads the landing page fresh.
 *
 * A full page load on purpose, not an in-app navigation: clearing the signed-in
 * user first made the page you were on redraw as "signed out", which sent you to
 * /login and remembered that page for the next sign-in. A fresh load also leaves
 * nothing from this session in memory (cached data, page state).
 */
export async function signOut() {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch {
    /* the cookie expires on its own; leave either way */
  }
  window.location.replace('/');
}
