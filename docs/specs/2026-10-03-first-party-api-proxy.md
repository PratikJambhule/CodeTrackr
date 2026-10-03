# Spec: serve the API through the website's own address (fixes H-19, H-20)

_2026-10-03. User chose option A (keep Render, forward through Vercel). Status: deployed 2026-10-03; Google login works live._

## Problem

The website is `code-trackr-frontend.vercel.app`; the API is `codetrackr-backend-uckp.onrender.com`.
Browsers treat these as different sites, so the login cookie is a third-party cookie. Safari,
iOS, Firefox, Brave and incognito block those, so login loops back to the login page (H-19).

## Design

1. **Vercel forwards** `/api/*` and `/auth/*` on the website's address to Render
   (`frontend/vercel.json` rewrites, before the SPA fallback, with caching off). The browser only
   ever talks to `code-trackr-frontend.vercel.app`; the cookie becomes first-party.
2. **The production website calls its own address** (`API_URL = ''` in production builds). Local
   development and Docker keep calling `http://localhost:5050`.
3. **Google sends users back through Vercel:** the OAuth callback becomes
   `https://code-trackr-frontend.vercel.app/auth/google/callback`, so the login cookie and the
   OAuth `state` cookie are set on the website's address.
4. **The extension is unchanged.** It authenticates with a key, not a cookie, and keeps calling
   Render directly.

## Consequence to handle: client IPs

Vercel overwrites `X-Forwarded-For` and does not pass the visitor's IP to an external origin
(Vercel docs, "request headers"). Behind the proxy, Render sees Vercel's IPs, so per-IP rate limits
would lump every website user together — worse than H-20. So, in the same change:

- group join: authenticate first, then limit **per user** (10 / 15 min);
- `/api/analytics`: limit **per signed-in session** (hash of the JWT cookie), IP only as fallback;
- `/auth`: it only starts a Google redirect or receives Google's callback — not a guessing
  surface — so the cap rises from 50 to 1000 / 15 min as a flood brake only.
- `/api/extension` and the device sign-in endpoints are called by the extension directly, so
  their IP limits still see real IPs; ingest also has the per-key quota.

## Not changed

Render keeps hosting the API (cold start ~22 s, L-10). The cookie stays `SameSite=None; Secure`
for now so a browser still running the old page keeps working during the switch; tightening it to
`Lax` is a follow-up once every browser uses the proxy.

## Risks and checks after deploy

- Vercel's wait limit for an external origin is not documented; a cold Render start may make the
  first request fail. Check after deploy; mitigations: React Query retries reads once; a keep-warm
  ping or a "waking up" message if needed.
- Set-Cookie must pass through the rewrite: check that Safari / a private window can log in.

## User steps (cannot be done from code)

1. Google Cloud Console → OAuth client → Authorized redirect URIs: **add**
   `https://code-trackr-frontend.vercel.app/auth/google/callback` (keep the old one until done).
2. Render → environment: `GOOGLE_CALLBACK_URL` = that same URL.
3. Deploy backend and frontend; test login in Safari / Firefox / an incognito window.
4. Optional: delete `VITE_API_URL` in Vercel (production builds no longer read it).
5. Make sure the OAuth consent screen is **In production**, not **Testing**.

## Tests

- Unit: `frontend/vercel.json` forwards `/api` and `/auth` before the SPA fallback, to the Render
  host, with caching off.
- Integration: the join limit is per user (one user's attempts don't block another), and the
  analytics limit keys by session. Rate limiters are skipped in test mode, so the keying logic is
  tested as pure functions.
