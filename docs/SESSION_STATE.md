# Session state (handoff)

_Snapshot for the next session. Read this first. History is in `docs/PROGRESS.md`._
_Last updated: 2026-10-04 (deployed; live login works; L-13 error reporting built, uncommitted)._

## 🟢 Right now: deployed, live Google login works (2026-10-03, late evening)

Commit `11040c5` is live on Render + Vercel. Live login hit two config errors, both fixed by the
user: `redirect_uri_mismatch` (new callback URL not registered) and `invalid_client` (Render's
`GOOGLE_CLIENT_SECRET` was stale; user added a new secret in Google and pasted it into Render).
Full story: `docs/PROGRESS.md` top entry. All docs + interview-prep were updated to "deployed"
(2026-10-04), then a full stale-fact audit (counts, INTERVIEW_PREP answers, ARCHITECTURE §4, new
Q13/Q14 in the Q&A bank); PDFs rebuilt. Resume bullet 1 wording flagged to the user (2.5.0 unpublished).

**Latest code change (2026-10-04, uncommitted, not deployed): L-13 error reporting.** New
`backend/services/errorReporter.js` hooks the logger so every `log.error` goes to Sentry when
`SENTRY_DSN` is set; `app.js` handles unhandledRejection/uncaughtException; access lines use
`log.access` (not reported). Tests: new `tests/errorReporter.test.js` (9), integration +1 (36),
flaky key-split test fixed. Unit 26 / 369, integration 36, extension 6 / 70, build green. Docs
(D-30, L-13, PROGRESS, RELEASE §5, interview prep) and PDFs updated. User step: create a Sentry
Node.js project, put the DSN in Render `SENTRY_DSN`, redeploy, enable email alerts.

**Next, user's steps (in order):**
1. Log in from Safari / a private window (real H-19 proof) and after ~15 min idle (cold start
   behind the Vercel proxy). Then mark H-19 ✅ in `IMPROVEMENT_PLAN.md` + cheat sheet + update boxes.
2. In Google, disable then delete the OLD client secret; optionally copy the new one into
   `backend/.env`. Check consent screen is "In production".
3. Live migrations from `backend/`, dry run first, then `--apply`: `migrate-hash-api-keys.js` →
   `migrate-activity-userid.js` → `backfill-userstats.js` (quiet time). Record counts in PROGRESS.
4. Publish extension 2.5.0 (`docs/RELEASE.md` §4), then update resume notes + update boxes.
5. Commit the doc changes (I hand over the `git add` list).

**Offered, not started:** M-33 — a thrown OAuth error (e.g. `invalid_client`) shows raw JSON; fix
with a custom `passport.authenticate` callback in `routes/auth.js` that logs + redirects to
`/login?error=signin`, plus an integration test stubbing a failing token exchange.

**Diagnosis tips:** Render logs are JSON lines with `requestId`; the `id` in an error body equals
it. Bash `curl` is blocked by a context-mode hook — use `ctx_execute` with JS `fetch`.

## What this project is

CodeTrackr: VS Code extension (TypeScript) → Express 5 / Mongoose 8 / MongoDB Atlas API on
Render (`codetrackr-backend-uckp.onrender.com`) → React 19 + Vite dashboard on Vercel
(`code-trackr-frontend.vercel.app`). Built for friendly competition in a college friend group.
Team of 3; the user (Soham) owns extension + backend. Repo remote: `PratikJambhule/CodeTrackr`.

## What was done in this session (2026-10-03), all in commit 11040c5

1. **Full audit** of code vs docs; standard docs created (README, ARCHITECTURE, DECISIONS,
   PROGRESS, INTERVIEW_PREP) and root `CLAUDE.md` (working rules: read this file first, keep
   docs + interview-prep folder current, honesty, verify, git rules).
2. **The 18-item roadmap** from the user's `CodeTrackr_Improvement_Plan.docx` →
   `docs/ROADMAP_2026-10.md` (all ✅ except the README demo GIF, which needs a real recording):
   integration tests (supertest + mongodb-memory-server, `npm run test:int`); hashed API keys
   `ct_<id>_<secret>` (SHA-256, shown once); device-code sign-in with per-device keys
   (`routes/device.js`, `/device` page, Profile → Connected devices, extension command
   "CodeTrackr: Sign In"); idempotent ingest (`flushId`); anti-cheat crediting (focus + 120 s,
   600 s per 10-min window, atomic counter); `userstats` running totals for leaderboard + group
   boards; contest-week group boards; group admin; extension 2.5.0 persisted outbox +
   SecretStorage; `$facet` dashboard pipeline (oracle-tested); `activities.userId` String →
   ObjectId expand step; React Query; Teams deleted; benchmarks; JSON logs + request ids +
   optional Sentry; Dockerfile + deploy-on-green workflow (off until `RENDER_DEPLOY_HOOK_URL`).
3. **Bugs found and fixed:** H-22 (IST "today"), M-28/M-29 (emails), M-31 (goal window), M-32
   (weekly window), H-23 (**CORS lacked PATCH → goal complete / mark-read never worked in
   browsers**), L-11 (OAuth state), L-12 (key fields in logs), M-30 root cause, flushCount on
   spread docs, flaky tests. Profile: Copy button hidden when only a key hint is shown.
4. **Measured** (`docs/BENCHMARKS.md`, local): leaderboard p50 6.72 s → 62 ms at 1M rows;
   bucketing 4.9× fewer docs / 12.7× less data at the 2-min cadence, same throughput.
5. **Docker Compose** (`docker-compose.yml`: mongo on host port 27018 — 27017 is a MongoDB
   installed on this laptop — backend with AUTH_BYPASS + `scripts/seed-local.js`, frontend Vite
   dev with live reload). Verified: health, persistence across restart, live reload.
6. **Login fix H-19 + H-20** (`docs/specs/2026-10-03-first-party-api-proxy.md`):
   `frontend/vercel.json` forwards `/api/*` and `/auth/*` to Render; production site calls its
   own address (`config.ts` `API_URL = ''` in production); rate limits keyed by user/session
   (`services/rateLimitKeys.js`) because Vercel hides visitor IPs. Verified locally with a
   stand-in proxy. Live since 2026-10-03 (after fixing the Google redirect URI and a stale
   client secret).
7. **Interview prep** folder updated (cheat sheet rewritten, update boxes, new Q&A, PDFs rebuilt
   via `docs/interview-preparation/build_pdfs.sh`). Resume entry:
   `docs/interview-preparation/CodeTrackr_Resume_Current.tex` (claims = measured; notes say
   deployed, migrations + extension 2.5.0 pending).

Last full test run (2026-10-04): backend unit 26 suites / 369, integration 36 / 36, extension 6 suites / 70,
frontend build green.

## User decisions on record

- Resume ownership: extension + backend (team of 3).
- Private groups stay visible in Discover (password-protected).
- External services built off-by-default; user switches them on.
- Login fix: option A (Vercel rewrites), not moving the backend or a custom domain.
- Docker: Compose with the frontend dev server.
- The user commits/pushes normally; this session the user asked me to commit, and pushed after.

## ⏸ Parked task (user asked 2026-10-04, then said "keep it for next time")

**Remove the profile API key completely; "CodeTrackr: Sign In" becomes the only way to connect.**
Not started, no code changed. **Blocking decision to ask first:** what happens to existing profile
keys? Everyone on the live extension 2.4.0 uses one, and 2.4.0 has no Sign In command, so a hard
cutoff before 2.5.0 is published would silently stop their tracking. Options prepared:
(A, recommended) stop issuing keys and remove all UI/commands, but keep accepting existing keys
until a cleanup script runs after 2.5.0 is out; (B) hard cutoff now (401); (C) reject after a date,
extension shows "please sign in" on rejection.

Touchpoints found (2026-10-04 grep):
- Backend: `routes/user.js` (profile fields `hasApiKey`/`apiKeyHint`/`legacyApiKey`, route
  `POST /regenerate-api-key`); `middleware/auth.js:78` issues a key to new users at login, and
  `findUserByApiKey` checks `users` (id+hash, legacy hash, plaintext) before `devicetokens`;
  `models/user.js` fields `apiKey`, `legacyApiKeyHash`, `apiKeyId/Hash/Last4/CreatedAt`, methods
  `issueApiKey`/`apiKeyHint`; `scripts/migrate-hash-api-keys.js` (becomes moot under A/B); tests
  in `tests/apiKeys.test.js`, integration "regenerate/legacy" cases.
- Frontend: `pages/Onboarding.tsx` (auto-creates and shows a key → replace with Sign In steps),
  `pages/Profile.tsx` (key box, Copy, Regenerate → keep only Connected devices).
- Extension: `package.json` command `codetrackr.setupApiKey` + setting `codetrackr.apiKey`;
  `src/extension.ts` `setupApiKey()` (~l.642), prompts at l.350 and l.775, settings→SecretStorage
  migration (l.90), config listener (l.850); tests `secretKey.test.js`.
- Docs after: DECISIONS (new entry), ARCHITECTURE §4, README setup steps, RELEASE, CHANGELOG,
  interview prep (key answers mention "Profile page"), resume bullet 1.

## Offers still open (not started)

- Make local/Docker mode check extension keys (bypass only the web login) so key revocation
  can be tested locally.
- Make Sign In the main option on Profile/Onboarding; move the copy-paste key to "Advanced".
- Remaining weaknesses: M-5 dead files, M-7 root package.json, L-4 big pages, L-6 extension
  strict TS, L-7 idle ≤2 min counted, L-10 cold start, no frontend tests, React Query on
  Groups/Goals/Profile, `SameSite=Lax` once all browsers use the proxy, userId contract step.

## Gotchas

- `backend/.env` = LIVE settings (Atlas). Tests/bench/dev scripts set their own env first;
  migration + usage scripts DO use it (user's action only).
- Windows: stopping a background `npm run …` orphans the `node` child (held port 5050 and served
  stale code). Start `node scripts/dev-local.js` directly; check `Get-CimInstance Win32_Process`.
- Never stage `THEME_USER_GUIDE.md`, `extension/extension.js`, `extension/index.html`.
- `supertest(app)` starts a server per request — listen once for bulk requests.
- Docker containers from this session may still be running: `docker compose down` to stop.
- Python heredocs in bash mangle `\n` escapes; write scripts to the scratchpad with Write instead.
