# Release checklist

Everything in the October 2026 roadmap is built and tested but **not deployed**. These are the
steps only the account owner can do, in order. Every script has a dry run (no flag) — run that
first and read its counts.

> `backend/.env` points at the **live** database. The scripts below read it. Run them from
> `backend/` on purpose, never by accident.

## 1. Push and let CI pass

```bash
git push origin main
```

CI (`.github/workflows/ci.yml`) runs backend unit + integration tests, extension tests, the
frontend build, and builds the Docker image and checks its `/health` against a throwaway MongoDB.
CI runs on Node 20 (the integration-test library needs it).

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
| Error reporting | Render env `SENTRY_DSN` (free Sentry project). Errors are sent with the request id; no user PII | the variable exists |
| Log verbosity | Render env `LOG_LEVEL=debug` / `warn` (default `info`) | — |

## 6. Numbers for the resume

```bash
cd backend && node scripts/usage-report.js
```

Read-only: prints accounts, weekly/monthly active users and groups with 2+ members (counts only).
Benchmarks are in `docs/BENCHMARKS.md`; re-run with `node bench/leaderboard.bench.js` and
`node bench/ingest.bench.js` (local, in-memory, no live data).
