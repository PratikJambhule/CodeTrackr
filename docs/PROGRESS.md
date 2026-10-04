# CodeTrackr — Progress Log

Dated log of what was built, what was tested, and the bugs found and how they were fixed.
Newest first. Finding ids (H-/M-/L-) refer to `docs/IMPROVEMENT_PLAN.md`; the hour-by-hour
engineering narrative for August–September is in `docs/SESSION-LOG-2026-08-27.md`.

---

## 2026-10-04 — Website tooling moved to Node 24

`docker compose up --build` printed `npm warn EBADENGINE`: Vitest 5 wants Node `^22.12 || ^24 ||
>=26` and jest-dom 7 wants `>=22`, while the website's dev image and its CI job used Node 20 (the
laptop runs 24, so it never showed here). **Checked** by running the CI frontend steps (clean
`npm ci`, lint, 51 tests, build) in throwaway `node:20-alpine` and `node:24-alpine` containers:
both pass, so nothing was broken yet. Moved the frontend CI job and `frontend/Dockerfile.dev` to
Node 24 anyway (D-38): Node 20 is end-of-life and the tools no longer promise to run on it. The API
still runs Node 20, logged as L-15. Also fixed the last places that called extension 2.5.0
"unreleased" (IMPROVEMENT_PLAN M-30, CODETRACKR_PROJECT_CONTEXT, ROADMAP).

## 2026-10-04 — Frontend lint clean; sign-out bug found and fixed

**Lint.** `npm run lint` in `frontend/` reported 13 problems (12 errors, 1 warning); none broke the
build or a test.
- 11 × `react-refresh/only-export-components`. React Fast Refresh can only hot-swap a file that
  exports nothing but components; a file that also exports a helper reloads the whole page on every
  edit. Helpers moved into plain `.ts` files: `components/ui/buttonClass.ts`,
  `components/ui/toastContext.ts` (`useToast`), `themeContext.ts` (`useTheme`),
  `components/charts/tone.ts` (chart colours), and `cellsSummary` into `lib/standings.ts` (now with
  a test). `NAV`, `CELL_BG` and `resolveTheme` were only used in their own file and are no longer
  exported. `components/ui/index` became a `.ts` file that only re-exports (the components moved to
  `Primitives.tsx`), so pages import from the same place as before.
- `Groups` received a `user` prop it never used (removed). `Goals` built a new `[]` on every render
  while loading, so its sorted list was recomputed each time (now memoised).

Now 0 problems, and CI runs `npm run lint` so it stays clean.

**Bug: signing out landed on the sign-in page.** Checking every moved piece in the browser (local
`dev-local` API + Vite), signing out from a group board ended on `/login`, with that board remembered
as the page to return to after the next sign-in. Cause: sign-out cleared the signed-in user and then
navigated to `/`, but React drew the current page first with no user, and its guard did its job
(remember the page, go to sign-in). Fix: sign-out ends the session and loads `/` fresh (D-37). A
routing test reproduces it (failed before the fix, passes after); in the browser, signing out from
Goals now lands on the landing page with nothing remembered.

**Tested (2026-10-04):** frontend lint 0 problems, `tsc -b` clean, Vitest 51 (6 files: +1
`cellsSummary`, +1 sign-out), `npm run build` green (entry chunk 306.54 kB, gzip 97.20 kB); backend
unit 27 suites / 375, integration 39, extension 6 suites / 70. Seen in the browser: dashboard, groups,
group board (screen-reader row summaries), a toast, theme switch, goals, profile, sign-out.

## 2026-10-04 — Extension 2.5.0 is live on the Marketplace

The user published 2.5.0 with `vsce publish` early on 2026-10-04 (IST); the Marketplace kept showing
2.4.0 while it verified the upload. **Checked later the same day:** `npx vsce show
CodeTrackr-ext.codetrackr-vscode` lists 2.5.0 (uploaded 2026-10-03 22:00 UTC) as the newest version,
and the listing page shows the 2.5.0 README with **94 installs** (an install count, not active users).
So Sign In, the offline outbox and the keychain are now live for everyone whose VS Code updates the
extension. Docs that still said "submitted" or "unpublished" were corrected: README, ARCHITECTURE,
CODETRACKR_PROJECT_CONTEXT, INTERVIEW_PREP, RELEASE (§4 marked done), the update box of each long
interview guide, the cheat sheet, Q&A, Quick Wins and the resume notes; PDFs rebuilt. Not done:
Open VSX (optional, `docs/RELEASE.md` §4).

## 2026-10-04 — Website redesign: "the weekly race"

**Why.** The user did not like the site: flashy effects, confusing layouts, a dated look, and no page
explaining the product. A proposal (5 boards: direction, chart kit, landing, dashboard, group board)
was approved before any code changed; spec `docs/specs/2026-10-04-frontend-redesign.md`, decisions
D-31 to D-36.

**Backend (test first).** `GET /api/analytics/history/:userId` (year of local days, hours of day,
top projects, commits; one `$facet`, `services/historyView.js`); group details gained `daily`
(seconds per member per local day, viewer's time zone, `services/groupDaily.js`); `GET
/api/groups/:id/preview` for invite links. 3 integration tests (39 total), `tests/localDays.test.js`
(6). `scripts/dev-local.js` now seeds a year of demo data, five friends, four groups, goals and
notifications, so every page can be checked locally.

**Frontend.** Design tokens as CSS variables (dark default, light, system); three Google typefaces;
UI kit (Button, Modal with focus trap, Toast replacing `alert()`, fields, Segmented); chart kit
(StandingsTower with a FLIP slide, RaceChart with non-overlapping end labels, Bars, YearHeatmap,
HourStrip, Ring, Sparkline); AppShell (sidebar; bottom tab bar on phones) and PublicLayout. Pages:
landing (animated example week), guide, privacy, sign-in, 404, dashboard (race strip, stat tiles,
week/today charts with the old two-hour drill-down kept, year heatmap, languages and projects, when
you code, build health, goals, top insight), groups, group board (own route; tower, race chart,
highlights, contest dates in the URL, admin rename/remove, leave), invite page, leaderboard (podium +
tower), goals (rings + calendar), insights, profile (devices, preferences, API key under Advanced),
onboarding checklist that ticks itself, device approval, notifications. Every page lazy-loaded.
Removed three, ogl, postprocessing, gsap, chart.js, react-chartjs-2, chartjs-plugin-datalabels,
axios, clsx, tailwind-merge, the 28-theme context and the effect components.

**Bug found in the old code (fixed): the Goals calendar created goals a day early in India.** It
built the deadline from local midnight with `toISOString()`, which is the previous day in UTC
before 05:30 IST, so clicking 10 Oct saved 9 Oct. Now dates are local keys (`lib/format.ts`
`localDateKey`); a test pins `TZ=Asia/Kolkata` and asserts both the old and new behaviour. Checked
in the browser: clicking 20 Oct saved a goal due Tue 20 Oct. (M-34)

**Found while checking in the browser (all fixed before hand-over):** tower names squeezed to zero
width beside the race chart (board now stacks; names have a minimum width); race chart text too
small when the chart is narrow (it now lays out in real pixels from its measured width); a hidden
data table widened the page (tables ignore the screen-reader-only width; wrapped in a div); dense
bar labels and the notifications panel overflowed on phones; card grids overflowed at 320 px
(`minmax(min(300px,100%),1fr)`); a wrong group password showed "Your session has ended" because
every 401 was treated as signed out (`errorText` now uses the server's message; unit test added).

**Verified.** Desktop: every page screenshotted with headless Chrome against the local API. Phone:
every page at 307-375 px, no horizontal scroll anywhere, dark and light. Flows: join a private group
(wrong password, then right), approve a device code, collect the key, see it under Connected
computers, disconnect it; create a goal from the calendar; set contest dates (URL updates, 10 day
cells, race chart redraws); open an hour of today; notifications; theme switch. Keyboard: Escape
closes dialogs and focus returns to the control that opened them.

**Measured** (`npm run build`, gzip level 9 via Node zlib): first visit to the landing page 358,681
bytes (114,167 gzipped) against 747,989 (231,590) for the old single bundle: about 52% / 51% less.
First visit to the dashboard 367,411 (116,774). Largest chunk (React, router, React Query, shared
UI) 306.55 kB, 97.04 kB gzipped.

**Tested.** Frontend Vitest 49 (6 files); backend unit 27 suites / 375; integration 39; extension
6 / 70; frontend build green. CI now runs the frontend tests.

**Not done / not verifiable here.** Real Google sign-in and the Vercel proxy (local mode bypasses
login); Safari/iOS rendering (checked in Chromium only); the change is not deployed.

---

## 2026-10-04 — Extension 2.5.0 packaged for the Marketplace

`npm ci` + tests (6 / 70) + `vsce package` → `extension/codetrackr-vscode-2.5.0.vsix` (99.7 KB).
Before packaging, checked what the Marketplace page would show and fixed it:
- **README** was 2.0-era (v2.0.11 badge, Teams, "copy the key from Profile", a duplicated second
  half) and claimed file names are tracked — they are not. Rewritten for Sign In, with an accurate
  sent / never-sent list taken from the trackers and `sanitizeCommand`.
- **Icon** was a 35-byte blank placeholder (also in 2.4.0). New 256×256 icon generated with Pillow
  (stopwatch + `</>` on a violet→pink tile), checked at 256 and 32 px; matching `galleryBanner`.
- **Links:** `repository`/`author`/`homepage` pointed at `Soham-Official/CodeTrackr`; the real
  repo is `PratikJambhule/CodeTrackr` (added `bugs`); homepage is now the dashboard.
- CHANGELOG 2.5.0 dated 2026-10-04.

The website got the same icon as its favicon (it showed Vite's default), and its tab title is now
"CodeTrackr" instead of "frontend". Frontend build green.

**Not done (user's step):** `npx vsce login CodeTrackr-ext` + `npx vsce publish --packagePath
codetrackr-vscode-2.5.0.vsix`.

---

## 2026-10-04 — Error reporting covers every error (L-13)

**Why:** while explaining Sentry to the user I found it was only called from the central error
handler. Four routes answer 500 themselves (`routes/user.js` ×3, `routes/metrics.js`), the
in-process scheduler logs its job failures, and nothing caught crashes outside a request — all of
those reached only the Render log.

**Built (test first):** `services/errorReporter.js` hooks into the logger, so every `log.error`
is reported when `SENTRY_DSN` is set (D-30); only method, path, status and the request id are
attached. `app.js` handles `unhandledRejection` and `uncaughtException` (log, report, flush up to
2 s, exit). The access line moved to `log.access` so a 5xx isn't reported twice — the first
integration run caught that duplicate. The MongoDB connection error now logs the full error, not
just its message.

**Also fixed:** a flaky integration test — it split the API key on `_`, which base64url secrets can
contain; it failed once in this run.

**Tested:** new `errorReporter` suite (9); integration test: a route-level 500 is reported with the
same request id the client saw, a 400 is not. Real `@sentry/node` 11.4 sent one event to a local
stand-in server: error, request id and path present, user id absent. Unit 26 suites / 369,
integration 36 / 36 (three runs), extension 6 / 70, frontend build green. Sentry stays off until the
user adds `SENTRY_DSN` on Render (`docs/RELEASE.md` §5).

---

## 2026-10-04 — Doc audit after go-live

Re-ran everything: backend unit **25 suites / 360**, integration **35**, extension **6 / 70**,
frontend build green. Then searched every doc for facts the October work made stale and fixed
them: test counts (many still said 23 / 346), `docs/INTERVIEW_PREP.md` answers that still
described the old offline merge, per-IP limits, the cross-site cookie, the old test suite and the
old "next steps"; `docs/ARCHITECTURE.md` §4 (rate limits, open weaknesses); README and
PROJECT_CONTEXT (`VITE_API_URL` is dev-only now). Interview prep: a "Web login / API address" row
in all four update boxes, Q13 (Safari login) and Q14 (Docker) in the Q&A bank, two quick answers
in the cheat sheet; PDFs rebuilt.

---

## 2026-10-03 (evening) — Go-live of the October work

**Deployed.** The user pushed commit `11040c5` to `main`; Render and Vercel deployed it (Render log:
"mongodb connected", "Your service is live"; one `/health` 503 during boot, before MongoDB had
connected, is expected).

**Live login, two config errors, both fixed by the user:**
1. Google showed `Error 400: redirect_uri_mismatch`. The login callback now goes through the
   website (H-19), so `https://code-trackr-frontend.vercel.app/auth/google/callback` had to be added
   to the OAuth client's redirect URIs and set as Render's `GOOGLE_CALLBACK_URL`.
2. The callback then returned 500 `{"error":"Internal server error","id":"3a75b10b5100"}`. The id
   matched a Render log line: `TokenError: The provided client secret is invalid` (`invalid_client`)
   during the code-for-token exchange. Render's `GOOGLE_CLIENT_SECRET` was not the client's current
   secret (last 4 characters differed). Google shows a secret only once, so the user added a new
   secret, set it on Render and redeployed. **Login works on the live site.**

**What this showed:** the request id in error bodies (added this month) turned a vague 500 into one
log search. New finding **M-33**: a thrown OAuth error shows raw JSON instead of the login page.
`docs/RELEASE.md` §1b now lists the secret check and the error→cause table.

**Not done yet:** Safari/private-window login check, cold-start check, live migrations, extension
2.5.0 publish.

---

## 2026-10-03 — Roadmap started (`docs/ROADMAP_2026-10.md`)

**Step 0 — docs consistent.** Fixed the contradictions the external review found in the
condensed interview guide (group error comparison, email leak, join rate limit, Repeated
Failures, ReDoS, test count 104 vs 296, metric count 5/7 vs 11). Resume entry rewritten:
"co-built (team of 3)", ownership = extension + backend, overclaims removed.

**Step 1 — integration tests.** `backend/tests/integration/` boots the real `app.js` against
`mongodb-memory-server` and drives it with `supertest`: track (bucket merge, 401, 400) →
analytics (owner 200, other 403, anonymous 401) → leaderboard (rank, no email) → groups (private
join, duplicate, members-only details) → goals (progress, owner-only complete) → error handler.
**7 tests, all pass.** CI runs them; backend and extension CI moved to Node 20 (the library
needs ≥ 20.19; Node 18 is end-of-life). `app.js` gained `MONGO_TLS=false` for test servers only.

**Bug found by it — M-31 (fixed).** Goal progress ignored the 10-minute window in which the
goal was created, because bucket timestamps are floored to the window start. Fixed in
`routes/goals.js` and `services/metricsService.js`; the test fails without the fix.

**Tested.** Unit 18 suites / 296, integration 7 / 7.

**Step 11 — React Query + dead code.** `@tanstack/react-query` had been installed and unused;
`src/api.ts` adds one fetcher and a shared `QueryClient` (30 s stale time). Dashboard (fixes
M-11's duplicate request), Leaderboard and Insights now use `useQuery`. Deleted the unrouted
Teams page and the live-but-unused `/api/teams` route and model; `routeGuards.test.js` now asserts
they stay gone. **Seen in the browser:** two analytics requests per Dashboard mount; Insights,
Leaderboard render; no console errors. **Tested:** unit 22 / 339, frontend build green.

**Login fix for every browser (H-19) + per-user rate limits (H-20).** User chose option A.
Spec first (`docs/specs/2026-10-03-first-party-api-proxy.md`). `frontend/vercel.json` forwards
`/api` and `/auth` to Render; `config.ts` uses the site's own address in production. Checked the
Vercel docs first and found that Vercel hides visitor IPs from an external origin — per-IP limits
would have lumped every user together — so the same change keys limits by user/session
(`services/rateLimitKeys.js`): join after authentication per user, analytics per session, `/auth`
cap raised. **Verified locally:** production bundle has no API host; served behind a local
stand-in for Vercel (a small Node proxy) the dashboard loaded with every request on the site's own
address; in Docker, one user hitting the join limit (429 on attempt 11) did not block another user
on the same IP. **Tests:** unit 25 suites / 360 (new `rateLimitKeys` 6, `vercelProxy` 8),
integration 35, extension 70, build green. **Not verifiable before deploy:** a real Safari login,
and Vercel's wait limit vs Render's cold start. User steps in `docs/RELEASE.md` §1b.

**Docker Compose (user request).** `docker-compose.yml` (mongo + backend + frontend),
`frontend/Dockerfile.dev`, `frontend/.dockerignore`, `backend/scripts/seed-local.js` (local-only
guard, runs once). **Verified on this laptop (first time Docker ran here):** images built; MongoDB
and the API report healthy (the `backend/Dockerfile` HEALTHCHECK works); the website served from
the container shows the seeded data with no console errors; a goal created through the API
survived `docker compose down` + `up` (seed skipped the second time); an edit to
`frontend/src/config.ts` triggered a page reload in the container (edit reverted). **Hit:** port
27017 was already taken by a MongoDB installed on Windows, so the container's database is
published on 27018 instead.

**Local test run + Profile fix (found by the user).** Ran backend (`dev-local`), frontend and
extension 2.5.0 together (VS Code test window with its own profile; recipe in README). The user saw
the Profile key box showing `ct_<id>_…last4` with a Copy button that looked active but did nothing:
the button was only `disabled`, styled as enabled. Now Copy appears only right after a key is
created, and otherwise a line explains it is a hint and how to connect (Sign In or regenerate).
Checked in the browser.

**Interview-prep folder brought up to date.** The roadmap work had only reached the top-level docs.
Now: the cheat sheet is rewritten against the current code; the full guide, condensed guide, Q&A
bank and architecture deep-dive carry an "October 2026 update — read this first" table that
overrides older text; inline fixes to the full guide's known limitations (§21), roadmap (§22),
complexity table (§23) and §28; the condensed guide's weakness list; a new Q&A section (Q1–Q12);
Quick Wins items 9/10/13/24 marked built; measured numbers in the write-reduction doc. Both PDFs
rebuilt (`build_pdfs.sh`: pandoc → HTML → headless Chrome; 61 and 19 pages). Older sections deeper
in the long guides still use past-tense descriptions of the old design — the update box at the top
of each says which wins.

**Step 14 — leaderboard benchmark.** `backend/bench/leaderboard.bench.js`: 1,000 users, 1,000,000
activity documents, real `app.js`, autocannon 10 connections × 20 s per path. Full scan: p50
6,720 ms, p99 7,172 ms, 1.3 req/s. `userstats`: p50 62 ms, p99 111 ms, 155.7 req/s. Rebuild of the
running totals from 1M documents: 8.7 s. Details and caveats in `docs/BENCHMARKS.md`.

**Step 15 — ingest benchmark.** `backend/bench/ingest.bench.js`, each mode in its own process.
Throughput equal within noise (legacy 408 req/s p50 23 ms; bucketed 458 req/s p50 20 ms). Storage
for 10 users × an 8-hour day: 2,400 uploads → 2,400 vs 492 documents (4.9×), 3.02 MB vs 0.24 MB
(12.7×); at the old 30 s cadence 9,600 → 490 documents (19.6×), 51× less data. **The first run
was killed at the 40-minute limit:** `supertest(app)` starts a new ephemeral server per request;
fixed by replaying against one listening server with users in parallel (run then took minutes).
The old resume claim "~10× fewer writes" had never been measured — now replaced by these numbers.

**Step 16 — real usage.** `backend/scripts/usage-report.js` (read-only: accounts, WAU, MAU,
daily actives, groups with 2+ members; counts only), checked on seeded data (a user with mixed
String/ObjectId activity counts once). `docs/RELEASE.md`: deploy order, migrations, Marketplace +
**Open VSX** publishing, optional switches. Not done: a README demo GIF (needs a real VS Code
recording).

**Step 17 — Docker + CD.** `backend/Dockerfile` (Node 20 Alpine, prod deps only, non-root,
`HEALTHCHECK` on `/health`) + `.dockerignore`; CI `docker` job builds it and waits for `/health`
with `db:true` against a `mongo:7` container; `.github/workflows/deploy.yml` calls a Render deploy
hook after green CI on `main`, then waits for `/health` — off until `RENDER_DEPLOY_HOOK_URL` is
set. **Not verified locally:** Docker Desktop was not running; first real check is CI.

**Step 18 — observability (L-3).** `services/logger.js` (JSON lines, levels, `LOG_LEVEL`),
`middleware/requestId.js` (`X-Request-Id`, one access line per request, no query strings, unsafe
incoming ids replaced), the error handler logs 5xx with the same id the client sees, optional
Sentry (`@sentry/node`, only when `SENTRY_DSN` is set, PII off). Every `console.*` in app code is
gone (the per-request user-id logs in analytics included). **Tested:** integration 35 / 35 (new
request-id test); unit 23 / 346; extension 6 / 70; frontend build green.

**Step 13 — device-code sign-in.** OAuth device-grant style (RFC 8628): `POST /api/device/code`
→ the extension copies `WXYZ-2345`, opens `/device?code=…`; the signed-in user approves; the
extension polls `POST /api/device/token` (428 pending → 200 key, single-use, 410 after) and stores
a **per-device** `ct_` key (`devicetokens`: hashed, ingest-only scope, 1-year expiry, `lastUsedAt`)
in SecretStorage. Profile lists devices with Disconnect; a signed-out visitor to `/device` is
returned there after login. Pending codes live 10 minutes (TTL index); only a hash of the device
code is stored. **Tested:** unit 23 / 345 (new `deviceAuth`, 6; routeGuards checks auth on the
approve/manage routes and rate limits on the open ones); integration 34 / 34 (full flow, single
use, revoke one device without the others, expiry, garbage input); extension 6 suites / 70 (new
`signIn`, against a fake API). **Seen in the browser:** approval page shows the device and
approves; Profile lists the connected device.

**Step 12 — group admin (+ H-23).** `PATCH /api/groups/:id` (rename/description, creator only,
length-checked) and `DELETE /api/groups/:id/members/:userId` (creator only, not self); when the
creator leaves, the longest-standing member becomes admin. Groups modal shows Rename / Remove to
the admin only. **Bug found — H-23 (production):** the first browser rename failed with "Method
PATCH is not allowed by Access-Control-Allow-Methods". The CORS list never included PATCH, so goal
**Mark complete** (since 2026-09-10) and notification **mark-as-read** have never worked in a
browser — all tests passed because `supertest` sends no preflight. Fixed; new integration test
sends real preflights. **Process mistake found at the same time:** stopping `npm run dev:local`
from my background tasks left the child `node` process running on Windows, so four servers
were alive and the oldest (pre-item-9 code) answered every request. The browser checks I
recorded for steps 9–11 therefore ran the new frontend against the OLD backend. Killed the
orphans, restarted with `node` directly, and re-checked: Dashboard daily/weekly against the
current backend (1.17 h, 2/7 days, no errors), group rename, goal complete and mark-all-read all
200. **Tested:** integration 31 / 31.

**Step 10 — `activities.userId` String → ObjectId, expand/contract (M-6).** Ingest now writes
an ObjectId; all reads (analytics, views, goals, metrics, rollup, leaderboard and group scans,
userstats rebuild) match both forms via `services/activityUser.js` and group on
`$toString: '$userId'`; the schema is `Mixed` during the transition. Migration
(`services/activityUserMigration.js` + `scripts/migrate-activity-userid.js`, dry run by default)
converts strings and, where a legacy bucket and a new bucket share a window (the unique index would
reject the conversion), folds one into the other. **Hit on the way:** the streak test evaluates
the route's source in a sandbox and needed the new helper injected; a one-off Windows file-lock
error interrupted a batch edit (re-run cleanly). **Tested:** unit 22 / 339; integration 28 / 28,
including mixed data before/after migration with every number unchanged.

**Step 9 — dashboard aggregation in MongoDB (M-1).** Daily and weekly views now come from one
`$facet` pipeline (`services/analyticsViews.js`); the daily view reads today only instead of 7
days. **Safety net:** the old JavaScript was extracted verbatim into
`tests/helpers/legacyAnalytics.js` and an integration test feeds both versions the same ~60
seeded documents (IST): identical output, except hour values on a .xx5 rounding tie (the old code
summed per-document fractions; the pipeline divides the exact sum). **Bug found — M-32:** the
weekly window started at the server's midnight 7 days back, not the user's, so totals could
include a day the chart did not show; fixed and tested. Seen in the browser: Daily and Weekly
views render, no console errors *(correction: that check hit a stale server — see step 12; redone
against the current backend after step 12)*. **Tested:** unit 22 / 339, integration 27 / 27.

**Step 8 — persisted extension queue (M-30).** `extension/src/outbox.ts`: uploads with signal are
saved to `globalState` before sending, drained oldest first (stop on a transient failure, drop on
400, prune anything older than the server's 24 h window, cap 500), and each carries a
`crypto.randomUUID()` `flushId`, so the server's receipts make retries count once. Signal-less
intervals still merge into the next interval, now starting at the earlier timestamp. While
writing the test I found the real M-30 mechanism: `mergeAnalytics` re-stamped every merge as
`now − total duration`; the plan entry is corrected. **Tested:** extension 5 suites / 65 (new
`outbox`, 10: survives restart, FIFO, stops at retry, keeps the id, never merges, drops 400s,
prunes > 24 h, cap, no double send under concurrent drains, corrupt storage ignored).

**Step 7 — contest-week group boards (+ H-8).** `GET /api/groups/:id/details?from=&to=`
(`services/boardWindow.js`: ISO dates, `to` after `from`, ≤ 400 days, `from` floored to the
bucket grid). Without a window the board reads members' `userstats` (O(members), closes H-8).
The Groups page has an All time / This week / Last 7 days selector. **Tested:** unit 22 suites /
339 (new `boardWindow`, 8), integration 25 / 25 (contest window flips the ranking; a contest
starting mid-window still counts that window; bad window → 400).

**Seen working in the browser.** New `npm run dev:local` (backend) runs the real API on an
in-memory MongoDB with `AUTH_BYPASS` and demo data; with the Vite dev server, the Groups board
(emails gone, join dates shown, period selector refetching with `?from=`), Profile (key hint,
regenerate shows the key once), Onboarding (existing-key message, real Marketplace link) and the
leaderboard (served from `userstats`) were checked, with no console errors. Not checkable
locally: the Login page message (`AUTH_BYPASS` skips login) — covered by an integration test.
First seed attempt showed wrong totals: the seed itself was wrong (bypass ignores API keys and
one upload was > 24 h old), not the app.

**Step 6 — `userstats` leaderboard (H-7).** Every credited write `$inc`s one row per user
(`models/UserStats.js`, pure update builder in `services/userStats.js`). The all-time leaderboard
now reads the top N rows plus two indexed maxima instead of aggregating every activity
(`?limit=`, default 100, max 500); `?days=` windows and an empty `userstats` (before the backfill)
still use the scan, and `X-Leaderboard-Source` says which path answered.
`scripts/backfill-userstats.js` (dry run by default) rebuilds the rows. **Bug found:** the
time-only documents created when spreading a long upload had no `flushCount`, so the scan
counted each as an upload — caught because the test compares both leaderboard paths; fixed with
`flushCount: 0`. **Test flakiness fixed:** integration uploads defaulted to `now − duration`
and could straddle a 10-minute boundary; they now start one minute into a fixed window.
**Tested:** unit 21 suites / 331 (new `userStats`, 7), integration 24 / 24 (stats vs scan
identical; rebuild reproduces the live totals exactly; dry run writes nothing).

**Step 5 — anti-cheat (H-21).** Upload time is now credited, not trusted: at most focus
time + 120 s, at most 600 s per user per 10-minute window (atomic counter in `windowusages`),
spread over the windows a long upload covers. Raw claims kept as `claimedDuration`. Per-key
quota (60/min) and a 100-item batch cap. **Bug avoided:** the first version would have cut a
legitimate offline hour to 600 s; spreading fixes that and a test proves it. **Tested:** unit
20 suites / 324, integration 22 / 22, quota by hand.

**Step 4 — idempotent ingest (server).** `/track` and `/track/batch` accept an optional
`flushId` (8–64 letters, digits, dashes). A unique `(userId, flushId)` row in `ingestreceipts`
(TTL 48 h) makes a resend a no-op (`200 {duplicate:true}`); if applying the flush fails the
receipt is deleted so the retry is not lost. **Tested:** 4 new validation cases; 4 new integration
tests (duplicate counted once; distinct/no ids applied; ids are per user; a failed apply does not
block the retry). Unit 19 / 313, integration 18 / 18. The extension starts sending ids with the
persisted queue (item 8), because today's merge of held payloads would give a retry a new id.

**Step 3 — hashed API keys (+ M-27).** Keys are now `ct_<id>_<secret>`; the database stores the
id and SHA-256 of the secret, compared with `timingSafeEqual`. Legacy plaintext keys still work and
are converted to a hash on first use; `scripts/migrate-hash-api-keys.js` converts all of them
(dry run by default, verified against an in-memory database). The profile never returns the key;
Onboarding and Profile show a new key once. Extension 2.5.0 (unreleased) keeps the key in
SecretStorage and moves an old `settings.json` key there. **Tested:** unit 19 suites / 308 (new
`apiKeys` suite, 8), integration 14 / 14 (hash at rest, profile hides key, tampered key 401,
regenerate revokes, legacy conversion), extension 4 suites / 55 (new `secretKey` suite), frontend
build green. **Deploy note:** backend and frontend must ship together (the old Onboarding page
reads `user.apiKey`, which the profile no longer returns).

**Step 2 — audit fixes.** H-22 (today window, test-first: 4 new streak-suite cases), M-28/M-29
(no emails from any group route; the page shows join dates), M-26 (cancelled sign-in returns to
the frontend login with a message), M-25 (real Marketplace link), L-11 (OAuth `state` nonce in a
short-lived cookie, custom passport store), and L-12 found on the way: the OAuth callback logged
the full user document including the API key. **Tested:** unit 18 suites / 300, integration
11 / 11, frontend build green.

## 2026-10-03 — Full re-audit and doc reset (no code changed)

**Done.** Re-read every backend route, the ingest pipeline, auth, the extension's flush and merge
logic and the frontend routing, and compared them with the docs.

**Tested.** Backend `npm test`: 18 suites, 296 assertions, 0 failures. Extension `npm test`:
3 suites, 52 assertions, 0 failures. Frontend `npm run build`: green (one warning: a 669 kB
JavaScript chunk; code-splitting would remove it).

**Bugs found (all open, none fixed yet):**
- **H-22** The Dashboard's "today" is the previous day from 00:00 to 05:30 IST. The handlers take
  the UTC date and shift it by the offset instead of taking the local date. Reproduced with
  `node -e`: at 02:00 IST on 3 Oct the window starts at `2026-10-01T18:30Z` (2 Oct IST).
- **M-29** `GET /api/groups/discover` returns each group creator's email to any signed-in user,
  with no membership needed (wider than M-28).
- **M-30** The extension's held-payload merge sums duration and then drops anything over
  3600 s whole, and files the merged time under the newest interval's project, language and time.
- **L-11** Google sign-in has no OAuth `state` check (login CSRF).

**Docs fixed.** README rewritten (was an 11-line stub). `docs/ARCHITECTURE.md` rewritten (it
described per-upload documents, the removed `date` field and unauthenticated analytics).
`docs/DECISIONS.md`, `docs/PROGRESS.md` and `docs/INTERVIEW_PREP.md` created. In
`CODETRACKR_PROJECT_CONTEXT.md`: the claim that 2.4.0 was unpublished (it is the live
Marketplace version) and that a `.vsix` is committed (they are gitignored); the finding-register
range; the rate-limit list; the long-term plan still asking for CI that already exists.
In `docs/IMPROVEMENT_PLAN.md`: L-5 "no tests of any kind", L-4 line counts, M-6's reference to
code that was removed, the moot H-5 backfill note, and the H-21 claim that held payloads keep
their start time. `backend/.env.example` no longer mentions a `JWT_SECRET` fallback that was
removed on 2026-09-09.

**Process.** Added a root `CLAUDE.md` (rules Claude Code loads every session: read the handoff
first, keep docs current, honesty rules, verify commands, git rules) and `docs/SESSION_STATE.md`
(a handoff snapshot updated during work, so context compaction loses nothing).

## 2026-09-17 — Machine-learning plan redesigned (docs only)

Designed the work-type classifier (D-13 in `DECISIONS.md`): logistic regression on one-tap labels,
personas and group titles as rules, skill levels rejected. Wrote `ML_INTEGRATION_PLAN.md`,
`ML_INTEGRATION_CHANGES.md`, `ML_INTEGRATION_GUIDE.md` and figures 6–7. **Not built**, blocked
on data. Found H-21 (leaderboard hours can be inflated by script) and M-28 (group details expose
member emails).

## 2026-09-16 — Launch-readiness audit (docs only)

Walked the path a new college student would take. Found H-19 (cross-site auth cookie likely
breaks login on Safari, iOS, Firefox, Brave and incognito), H-20 (IP-keyed rate limits shared by a
whole campus), M-26 (cancelling Google sign-in shows an API 404, verified), M-27 (onboarding fails
silently), L-10 (~22 s cold start, measured). Deferred by decision. Data check: 4 bucketed
documents from 1 user, 0 completed goals.

## 2026-09-12 — Deployed, small-fix batch (`92b899b`)

**Deployed.** `main` replaced by the feature branch (D-11). Vercel had been pinned by an Instant
Rollback, so new builds never reached the domain; fixed by promoting the newest build. Render
auto-deployed; `GET /health` → 200. End-to-end check: extension 2.4.0 → Render → validation →
10-minute bucket. GitHub Actions cron wired; a manual run wrote 98 `dailysummaries`.
Ran `migrate-drop-date.js --apply` on the live database.

**Fixed.** M-22 `activeDaysRatio` could only ever be 1 (found by reading real output: 27 of 30
days reported 1.0; now 0.48 for the same account). M-23 the leaderboard returned every user's
email. M-24 rate limits on group join and analytics. L-1 notification panel stale closure.

**Correction found.** The ~140 analytics documents the 09-10 audit counted were demo data from
`seed-demo-insights.js`; real rich analytics first arrived on this date.

**Tested.** Backend 18 suites / 296 assertions.

## 2026-09-10 — Production-readiness batch, social sweep, rules engine

**Extension 2.4.0.** H-14: four code paths reset the trackers and then bailed out, losing the
interval; added carry-forward merge. H-15: focus and read-time samplers kept counting through
idle pauses, which is why `deepWorkRatio` read ≈0.

**Insights.** M-16: four formulas measured the wrong thing (two different clocks in
`deepWorkRatio`; "consistency" computed over active days only; peak window with no sample floor;
calibration needing two goals). Added confidence gating, sessionization, a 90-day baseline.
M-17: nothing could ever mark a goal complete; added the route and button.

**Social.** H-16 regex injection / ReDoS in group search; H-17 the leaderboard reported upload
counts as commits; H-18 `Math.max(...spread)` throws past ~100k users; M-18 to M-21. Added the
13-rule engine.

**Tested.** Backend 18 suites / 292 assertions; extension 3 / 52.

## 2026-09-09 — Quick-wins Tier 1 + security

`JWT_SECRET` required at boot (M-9), helmet + rate limits (M-3), 409 on duplicate join (M-14),
`/health` (L-8), real "Repeated Failures" data (M-15), 29 frontend type errors fixed (M-13),
GitHub Actions CI (L-9), central error handler (M-10), ingest bounds-check (M-4), scheduler moved
out of process (H-13). Backend suites 10 → 12.

## 2026-09-08 — Database write reduction

10-minute bucket-on-write (D-04), extension 2.3.0 skips empty uploads and waits for 2 minutes of
activity, sparse sub-documents, dropped the dead `date` field, `DailySummary` rollup, 400-day TTL.
Built test-first in 9 tasks (`docs/superpowers/plans/2026-09-08-db-write-reduction.md`).

## 2026-08-28 — Security batch and Insights page

H-1 analytics routes required no auth and trusted `:userId`; H-2 legacy open endpoints deleted;
H-9 group passwords hashed; H-10 `AUTH_BYPASS` refused in production; H-11 IDOR on goals and
teams. Extension 2.1.0–2.2.0 trackers (editor, focus, git). First `/insights` page.

## 2026-08-27 — Data accuracy and extension cleanup

H-3 goal progress was 60× overstated (minutes vs seconds); H-4 a summary endpoint always returned
zero; H-5 backdated activity filed under today; H-6 streak wrong three ways; H-12 a dead sync
pipeline posted to a route that did not exist. Extension 2.0.11. First test suite (`streak`).
