# Release checklist

**Status 2026-10-04:** §1, §1b, §2 and §4 are done (deployed, Google login works live, extension
2.5.0 live on the Marketplace). Still to do: §1b Safari/cold-start check, §2b once the website
redesign is pushed, §3 migrations. These are the steps only the account owner can do, in order. Every script has a dry run (no flag) — run that
first and read its counts.

> `backend/.env` points at the **live** database. The scripts below read it. Run them from
> `backend/` on purpose, never by accident.

## 1. Push and let CI pass

```bash
git push origin main
```

CI (`.github/workflows/ci.yml`) runs backend unit + integration tests, extension tests, the
frontend lint, tests and build, and builds the Docker image and checks its `/health` against a throwaway MongoDB.
CI runs the backend and extension on Node 20 (the integration-test library needs at least 20) and
the website on Node 24 (Vitest 5 needs 22.12+; D-38).

## 1b. Two settings for the login fix (H-19) — do these BEFORE deploying

The website now forwards `/api` and `/auth` to Render, so Google must send users back through the
website's address.

1. **Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0 client →
   *Authorized redirect URIs* → **add**
   `https://code-trackr-frontend.vercel.app/auth/google/callback`. Keep the old Render URI until
   the new one is confirmed working, then remove it.
2. **Render** → the backend service → Environment → set
   `GOOGLE_CALLBACK_URL` = `https://code-trackr-frontend.vercel.app/auth/google/callback`.
3. Optional: **Vercel** → project → Settings → Environment Variables → delete `VITE_API_URL`
   (production builds no longer read it).
4. While in Google Cloud: OAuth consent screen → Publishing status must be **In production**,
   otherwise only listed test users can sign in.
5. Check that Render's `GOOGLE_CLIENT_SECRET` belongs to the **same** OAuth client as
   `GOOGLE_CLIENT_ID` (compare the last 4 characters Google shows). Google shows a secret in full
   only once: if they differ, **Add secret**, copy it from the popup, paste it into Render, then
   disable the old one after login works. Changing a Render variable needs a redeploy.

Errors seen at go-live and what they meant: `redirect_uri_mismatch` (Google page) → step 1 or 2
missing; a 500 on `/auth/google/callback` with `TokenError: invalid_client` in Render's log → step 5.
The `id` in the browser's error body is the `requestId` on the matching Render log line.

After deploying, sign in from **Safari or a private/incognito window**. Also try the first visit
after the backend has been idle ~15 minutes: if Vercel gives up before Render wakes (~22 s), the
first request fails — report it and we add a keep-warm ping or a "waking up" message.

## 2. Deploy backend and frontend together

Render auto-deploys `main`; Vercel builds `main` (if production is pinned by an Instant Rollback,
promote the newest build — see `docs/ARCHITECTURE.md` §6). **Both must ship together:** the new
Profile/Onboarding pages expect `hasApiKey`/`apiKeyHint` and the API no longer returns the key
itself.

Check: `GET https://codetrackr-backend-uckp.onrender.com/health` → `{"status":"ok","db":true}`,
and in a browser, goal **Mark complete** now works (H-23).

## 2b. Shipping the website redesign (built 2026-10-04)

The redesigned website calls three new API routes (`/api/analytics/history/:userId`, the `daily`
field on group details, `/api/groups/:id/preview`). Push the backend and frontend changes in the
same commit. Vercel usually finishes before Render, so for a minute or two the new site can show
"This did not load" on the year heatmap or group board; it recovers on refresh once Render is live.
After deploying: open the landing page signed out, sign in, check the dashboard, a group board,
`/join/<group id>` and the light theme, and run CodeTrackr: Sign In once to check `/device`.

## 3. Migrations (live database)

```bash
cd backend && node scripts/migrate-hash-api-keys.js
```

Then with `--apply`. Hashes every plaintext API key; installed extensions keep working.

```bash
cd backend && node scripts/migrate-activity-userid.js
```

Then with `--apply`. Converts `activities.userId` to ObjectId; reads already handle both forms.

```bash
cd backend && node scripts/backfill-userstats.js
```

Then with `--apply`, when uploads are quiet. Until this runs the leaderboard keeps the old scan
(correct, just slow); afterwards it reads running totals (`X-Leaderboard-Source: userstats`).

## 4. Publish extension 2.5.0

**Done 2026-10-04** on the VS Code Marketplace (check: `npx vsce show CodeTrackr-ext.codetrackr-vscode`).
Open VSX is optional and not done. The steps stay here as the recipe for the next version.

```bash
cd extension && npm ci && npm test && npx vsce package
```

- **VS Code Marketplace:** `npx vsce publish` (publisher `CodeTrackr-ext`, Azure DevOps token;
  see `PUBLISHING_v2.0.0.md`).
- **Open VSX** (VSCodium, Cursor, Gitpod users): create a namespace once at open-vsx.org with an
  access token, then `npx ovsx publish codetrackr-vscode-2.5.0.vsix -p <token>`.
- After publishing: in VS Code run **CodeTrackr: Sign In**, approve the code, and check Profile →
  Connected devices lists it.

## 5. Optional switches

| What | How | Off until |
|---|---|---|
| Continuous deployment | GitHub secret `RENDER_DEPLOY_HOOK_URL` (Render → Settings → Deploy Hook); then turn off Render auto-deploy so only green CI deploys | the secret exists |
| Error reporting | sentry.io → new **Node.js** project → copy the DSN → Render env `SENTRY_DSN` → save and redeploy. Every server error (requests, background jobs, crashes) then appears under Issues, grouped, with the request id; no user ids or emails. Turn on email alerts for new issues | the variable exists |
| Log verbosity | Render env `LOG_LEVEL=debug` / `warn` (default `info`) | — |

## 6. Numbers for the resume

```bash
cd backend && node scripts/usage-report.js
```

Read-only: prints accounts, weekly/monthly active users and groups with 2+ members (counts only).
Benchmarks are in `docs/BENCHMARKS.md`; re-run with `node bench/leaderboard.bench.js` and
`node bench/ingest.bench.js` (local, in-memory, no live data).
