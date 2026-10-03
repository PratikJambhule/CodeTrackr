# Session state (handoff)

_Snapshot for the next session. Overwrite stale parts; history goes in `docs/PROGRESS.md`._
_Last updated: 2026-10-03 — roadmap items 0–18 built and tested; nothing committed or deployed._

## What we are doing

Working through `docs/ROADMAP_2026-10.md` (from the user's `CodeTrackr_Improvement_Plan.docx`).
Its status column is the source of truth. User decisions (2026-10-03): resume ownership =
extension + backend (team of 3); private groups stay visible in Discover with a password;
external items (Sentry, Open VSX, Render deploy hook, extension publish, live-DB migrations) are
built off by default and the user switches them on.

## Status

- **All 18 items done** except two partials that need the user: item 16's README demo GIF (needs
  a real VS Code recording) and item 17's local Docker build (Docker Desktop was not running; the
  CI `docker` job builds and health-checks the image on the next push).
- Last full run (2026-10-03): backend unit 23 suites / 346, integration 35 / 35, extension 6
  suites / 70, frontend build green.
- Bugs found while building, all fixed: M-31, M-32, H-23 (browsers blocked every PATCH — goal
  completion never worked in production), spread-doc flushCount, the real M-30 mechanism, two
  flaky integration tests (clock boundaries).
- Measured: leaderboard 6.72 s → 62 ms p50 at 1M rows; bucketing 4.9× fewer docs / 12.7× less
  data at the 2-minute cadence, same throughput (`docs/BENCHMARKS.md`).

## Login fix H-19 + H-20 (2026-10-03, built + tested, not deployed)

Vercel forwards `/api` + `/auth` to Render (`frontend/vercel.json`); production site calls its own
address; rate limits per user/session (`services/rateLimitKeys.js`). Spec:
`docs/specs/2026-10-03-first-party-api-proxy.md`. **User must, before deploying:** add Google
redirect URI and set Render `GOOGLE_CALLBACK_URL` to
`https://code-trackr-frontend.vercel.app/auth/google/callback` (`docs/RELEASE.md` §1b), then test
Safari/private window and a cold-start visit. Last run: unit 25 / 360, integration 35, ext 70.

## Docker (added 2026-10-03, verified)

`docker compose up --build` from the repo root runs mongo (host port 27018 — 27017 belongs to a
MongoDB installed on this laptop), backend (AUTH_BYPASS, seeded once by `scripts/seed-local.js`)
and frontend (Vite dev, live reload). Containers may still be running: `docker compose down` to
stop, `-v` to wipe data. Item 17 is now ✅.

## Interview-prep folder

Updated 2026-10-03 (see PROGRESS). Rebuild the PDFs after editing the guides:
`cd docs/interview-preparation && bash build_pdfs.sh`.

## Next (the user's steps, in order — `docs/RELEASE.md`)

1. Review, then commit with `.git/COMMIT_DRAFT.txt` and push (CI must be green, Node 20).
2. Deploy backend + frontend together.
3. `migrate-hash-api-keys.js` → `migrate-activity-userid.js` → `backfill-userstats.js`
   (each: dry run first, then `--apply`).
4. Publish extension 2.5.0 (Marketplace + Open VSX).
5. Optional: `RENDER_DEPLOY_HOOK_URL`, `SENTRY_DSN`; run `scripts/usage-report.js` for WAU.

Possible follow-ups (not started): contract step of the userId migration; per-day stats for
windowed boards; React Query for Groups/Goals/Profile; H-19/H-20 launch blockers; frontend tests.

## Notes and gotchas

- `backend/.env` holds LIVE settings (MONGO_URI etc.). Every test/bench/dev script sets its own
  env first, so nothing has touched live data. The migration and usage scripts DO use it.
- On Windows, stopping a background `npm run …` leaves its `node` child alive (it held port 5050
  and served stale code). Start `node scripts/dev-local.js` directly; check with
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`.
- `supertest(app)` starts a server per request; for bulk requests listen once (see ingest bench).
- Leave-alone files, never staged: `THEME_USER_GUIDE.md`, `extension/extension.js`,
  `extension/index.html`. `.claude/launch.json` is local preview config (stage it or not).

## Open questions for the user

- Is the Google OAuth consent screen "In production" or "Testing"?
- H-19 fix choice: (A) proxy the API through Vercel rewrites, (B) custom domain, (C) leave it.
