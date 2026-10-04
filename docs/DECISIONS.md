# CodeTrackr — Decisions

One entry per decision: **what** was chosen, **why**, the **alternatives** rejected, and the
**trade-offs** accepted. Numbers follow the order decisions were made (D-01 is the oldest); from
D-42 down to D-16 the October 2026 entries are listed newest first. Created 2026-10-03 by collecting
decisions that were previously spread across the session log, specs and interview docs; dates
are when the decision was made.

---

## D-01. MongoDB as the only datastore (original design)

- **What:** MongoDB Atlas via Mongoose for everything.
- **Why:** activity summaries are self-contained documents whose shape keeps growing (three
  analytics sub-documents were added without a migration). The hot query is "one user's
  documents in a time window, then aggregate", which needs no joins. Atlas has a free tier.
- **Rejected:** PostgreSQL. Better for the relational parts (group membership, goal ownership)
  and for the leaderboard's `GROUP BY user`, but every schema change to the activity payload
  would have needed a migration.
- **Trade-off:** no foreign keys or transactions; `activities.userId` ended up a String while
  everything else uses ObjectId (M-6), so joins happen in Node.

## D-02. Two credentials: JWT cookie for the browser, API key for the extension (original design)

- **What:** Google OAuth → a JWT in an httpOnly cookie for the dashboard; a random 64-hex API key
  in an `x-api-key` header for the extension.
- **Why:** the extension cannot run a browser OAuth flow easily, and an httpOnly cookie keeps the
  web token out of reach of JavaScript (XSS cannot read it).
- **Rejected:** JWT in `localStorage` (readable by any injected script); OAuth device flow for the
  extension (correct, but much more work for a student project).
- **Trade-off:** the API key is a non-expiring, unscoped bearer token (plaintext until D-17). Anyone who has
  it can upload activity as that user (though not read their dashboard). The documented fix is
  hash-at-rest with a key id prefix, rotation with a grace period and per-device keys. Also,
  because the frontend and API live on different sites, the cookie is third-party (H-19).

## D-03. Group passwords hashed with Node's built-in `crypto.scrypt` (2026-08-28)

- **What:** `scrypt$salt$hash`, verified with a constant-time compare; legacy plaintext rows still
  verify and are upgraded on the next successful join.
- **Why:** no native dependency, so the build stays simple on any host and the tests run without
  `npm install`.
- **Rejected:** bcrypt (native module, build issues on serverless); argon2 (same).
- **Trade-off:** none worth noting at this scale; scrypt is a recognised password KDF.

## D-04. Bucket-on-write: one document per 10 minutes (2026-09-08)

- **What:** each upload `$inc`s a document keyed by `(user, project, language, 10-minute start)`
  with an atomic upsert; a partial unique index guards races. Empty uploads are skipped at the
  extension. A `DailySummary` rollup and a 400-day TTL were added in the same batch.
- **Why:** one document per ~30 s upload grew the collection fastest of anything and every read
  path then summed them again. Merging at write time cuts documents by roughly the number of
  uploads per 10 minutes and keeps every counter exact.
- **Rejected:** a nightly compaction job (the raw data still has to be written first); a queue
  plus batch writer (correct at scale, unnecessary infrastructure now); a time-series collection
  (would have forced a migration of all reads at once).
- **Trade-off:** time-of-day precision is now 10 minutes; `$inc` makes ingest non-idempotent
  inside a bucket (a resent upload double-counts in that bucket).

## D-05. Validation as a pure function, not `express-validator` (2026-09-09)

- **What:** `services/ingestValidation.js` returns `{ ok, errors }` with no I/O.
- **Why:** it can be unit-tested with plain asserts (23 cases) and slots in front of the existing
  normalise → plan pipeline.
- **Rejected:** `express-validator` middleware (installed, but tests then need an HTTP harness).
- **Trade-off:** hand-written checks must be kept in step with the schema manually.

## D-06. Scheduler driven from outside the process (2026-09-09)

- **What:** `app.listen` and node-cron start only when `app.js` is run directly. Hosted
  schedules call `POST /api/internal/run-notifications` and `/run-rollup` with a shared secret,
  from GitHub Actions.
- **Why:** an in-process cron runs once per instance (or never, on serverless), and the free
  Render instance sleeps.
- **Rejected:** Render cron jobs (paid); keeping node-cron in-process.
- **Trade-off:** the secret must match in two places; a mismatch returns 404 by design, which is
  quiet. The hourly call also wakes the free instance.

## D-07. Plain `node:assert` test scripts, no framework (2026-08-27 onwards)

- **What:** each suite is a Node script that prints PASS/FAIL and exits non-zero on failure.
- **Why:** zero setup, fast, and the code under test was refactored into pure modules so it needs
  no database or server.
- **Rejected:** Jest/Mocha (worth it once there are integration tests).
- **Trade-off:** no coverage report, no watch mode, and no test touches a real database or HTTP
  (Quick-Wins #24 is the next step).

## D-08. Insights are statistics and rules, deliberately not ML (2026-09-10)

- **What:** `metricsDerive.js` computes medians, MAD and ratios; each metric carries a confidence
  level and sample size, and anything below its minimum renders "—". `rulesEngine.js` has 13
  declarative threshold rules that only fire on confident metrics and show the numbers behind
  each finding.
- **Why:** with one active user there is nothing to train on. Explainable numbers survive
  interview follow-ups; a model with no data does not.
- **Rejected:** k-means "coding styles" (no data, no ground truth, nothing to evaluate);
  an LLM narration layer (designed with a numbers-must-be-grounded check, not built).
- **Trade-off:** the insights only describe; they do not predict.

## D-09. Robust statistics: median and MAD instead of mean and standard deviation (2026-09-10)

- **What:** `volumeStability = 1 − MAD/median`; calibration uses the median ratio with range.
- **Why:** one 10-hour hackathon day would dominate a mean-based figure.
- **Rejected:** coefficient of variation (it was the original formula and measured the wrong
  thing: it only saw active days, so it could not measure cadence).
- **Trade-off:** less familiar to explain; needs a minimum sample.

## D-10. Relative leaderboard scores kept (2026-09-10)

- **What:** scores stay `value / best value × 5`, now clamped to [0, 5] and computed with a fold.
- **Why:** it is the product's existing behaviour; the batch fixed correctness (real commits,
  no negative impact, no spread crash), not the scoring idea.
- **Rejected:** absolute targets for every score (only `commitScore` uses one, 20 commits).
- **Trade-off:** your score moves when someone else codes; in a one-user install everyone is 5.0.

## D-11. Replace `main` with the feature branch by force-push (2026-09-12)

- **What:** `main` was reset to `feat/security-and-insights`; the old `main` is kept as tag
  `backup-main-4c1ae25`.
- **Why:** the two branches had no common ancestor; a merge produced 35 add/add conflicts, and
  the only files unique to old `main` were dead code already deleted as H-12.
- **Rejected:** `--allow-unrelated-histories` merge (35 manual conflict resolutions for no gain).
- **Trade-off:** history before the branch lives only in the tag.

## D-12. Deferred: `UserStats` running totals for the leaderboard (2026-09-09)

- **What:** decided to fix H-7 with a per-user running total updated on ingest, not a cache.
- **Why:** reads become O(users) and always current.
- **Rejected:** a Redis or in-memory cache (stale numbers, another service); reading
  `dailysummaries` alone (still O(days × users)).
- **Status:** not built. The leaderboard is correct but still scans everything.

## D-13. Machine-learning plan: classify the session's work type (2026-09-17, not built)

- **What:** one question for ML — was this session DSA practice, project building, debugging,
  learning or setup? — answered by multinomial logistic regression on 18 session attributes,
  trained on one-tap user labels (20% asked blind so labels do not copy the rules), tested on
  people it never saw, shipped only if macro-F1 beats the rules by ≥ 0.05. Personas and weekly
  group titles are plain rules on top.
- **Why:** the question has a ground truth the user can supply in one tap, and a wrong answer is
  harmless.
- **Rejected:** skill levels (no ground truth, a harmful public label, easy to game); k-means as
  the main model (kept only as optional discovery on "Not sure" sessions).
- **Status:** blocked on data — about 300 labelled sessions from 10+ people are needed; one
  person sends data today. Full plan in `docs/ML_INTEGRATION_PLAN.md`.

## D-15. Integration tests with supertest + mongodb-memory-server (2026-10-03)

- **What:** `tests/integration/` starts an in-memory MongoDB, imports the real `app.js`, and
  sends HTTP requests with `supertest`. Same PASS/FAIL style as the unit suites; separate
  `npm run test:int` script, run in CI.
- **Why:** the unit suites test pure functions and source text; nothing checked that the
  routes, middleware, indexes and queries work together. The first run found a real bug (M-31).
- **Rejected:** a shared Atlas test cluster (network, credentials in CI, shared state); Docker
  `mongo` service in CI (works in CI but not on a laptop without Docker); Jest (a framework
  switch for no gain).
- **Trade-off:** first run downloads a ~100 MB mongod binary; needs Node ≥ 20.19, so CI moved
  from Node 18 (end-of-life) to 20. `app.js` reads `MONGO_TLS=false` to allow a non-TLS server;
  production behaviour is unchanged when the variable is unset.

## D-25. Benchmarks are local, like-for-like, and quoted with their setup (2026-10-03)

- **What:** both benchmarks run the real app against an in-memory MongoDB on one laptop and
  compare two code paths on identical data; results are committed as JSON next to the scripts.
- **Why:** the resume needs numbers that can be re-derived; the comparison (scan vs running
  totals; bucketed vs legacy) is what the claim is about.
- **Rejected:** load-testing production (free Render tier, shared Atlas cluster, real users);
  quoting p95 (autocannon reports p90/p97.5/p99 — the numbers are reported as measured).
- **Trade-off:** absolute latencies are not production latencies; every quote says "local
  benchmark" and names the data size.

## D-26. A 30-line JSON logger instead of a logging library (2026-10-03)

- **What:** `services/logger.js` writes one JSON object per line; a middleware adds a request id
  and an access line; Sentry is optional behind `SENTRY_DSN`.
- **Why:** Render's log search filters JSON fields; one id ties the user's error message, the
  access line and the stack trace together. The code is small enough to explain line by line.
- **Rejected:** pino/winston (faster and richer, but configuration surface the app does not need
  yet); OpenTelemetry tracing (one service, no downstream calls to trace).
- **Trade-off:** synchronous `stdout.write` per line; fine at this traffic, the first thing to
  swap for pino if log volume grows.

## D-41. Each goal notification is sent once, recorded on the goal and claimed atomically (2026-10-04)

- **What:** the goal carries `reminderSent` and `missedNotified`. The hourly sweep claims a flag with
  one `findOneAndUpdate({ _id, flag: false }, { $set: { flag: true } })` and creates the
  notification only if it won. "Deadline missed" covers deadlines missed in the last 48 hours.
- **Why:** the missed-deadline sweep decided "already sent?" by looking for the notification row, so
  deleting a notice made the next hourly run send it again (found live: four came back at 07:00 UTC).
  And two sweeps run every hour (the in-process cron and the GitHub Actions call), so find-then-create
  could send twice. An atomic claim is the standard fix for "exactly one worker does this".
- **Rejected:** a unique index on `(goalId, type)` (deleting the row would still re-arm it); turning
  off one of the two schedulers (the in-process one covers GitHub outages, the external one covers a
  sleeping server); a distributed lock (more moving parts than one conditional update).
- **Trade-off:** a goal whose deadline passes while the server is down for more than 48 hours gets no
  missed notice; the 48-hour window also stops old deleted notices from returning after this deploy.

## D-42. Wide screens: a 1600 px page and a 12-column dashboard (2026-10-04)

- **What:** signed-in pages are up to 1600 px wide (was 1240). From 1280 px the dashboard is a
  12-column grid that pairs cards of similar height: race + insight; the five numbers; last 7 days +
  languages/when-you-code + build health; your year + goals. From 1536 px the group board puts the
  standings tower beside the race chart, and the leaderboard puts the podium beside the table.
  Narrower screens keep the stacked layout.
- **Why:** on a 1920 px screen a third of the page was empty margin (the user's feedback, with a
  screenshot). Pairing by height avoids cards that stretch around empty space.
- **Rejected:** a fluid full-width page (lines of text and table rows get too long to read on 2560 px
  screens); only widening the container without regrouping (cards stretched across half-empty rows).
- **Trade-off:** the card order on wide screens differs a little from the reading order on phones.

## D-39. The all-time boards switch to running totals only after the backfill says it finished (2026-10-04)

- **What:** `rebuildAll({ apply: true })` (`scripts/backfill-userstats.js`) writes a row
  `{ _id: 'userstats-backfill', completedAt }` to a small `migrations` collection when it finishes.
  The all-time leaderboard and group boards read `userstats` only when that row exists
  (`statsComplete()` in `services/userStats.js`); until then they scan `activities` as before.
- **Why:** the old switch was "the `userstats` collection is not empty". Ingest creates a row for
  everyone who uploads, so after the deploy the first upload flipped the switch while the table held
  only the people who had uploaded since. Live, the all-time board showed one person (H-24). Whether
  a one-off job has finished is a fact the job should record, not something to guess from the data.
- **Rejected:** "count of userstats rows = count of users with activity" (a full scan on every
  request, and wrong for users with no activity); an environment variable flipped by hand after the
  backfill (easy to forget, differs between Render and local); running the backfill inside the
  deploy (it should run when uploads are quiet, by the operator).
- **Trade-off:** one extra indexed read by `_id` per all-time request; the boards stay on the slower
  scan until someone runs the backfill.

## D-40. A top navigation bar instead of a left sidebar (2026-10-04)

- **What:** signed-in pages have one sticky top bar: logo, the five sections in a row (Dashboard,
  Groups, Leaderboard, Goals, Insights), notifications and the account menu. Phones keep the bottom
  tab bar. The sidebar's "Tracking from VS Code" box is gone; Profile → Connected devices is in the
  account menu.
- **Why:** the user asked for it after using the site. Five sections fit comfortably in a row, and
  pages (the group board's tower and race chart especially) get the sidebar's 248 px back.
- **Rejected:** a top bar on phones too (five labels do not fit at 375 px; a scrolling tab strip hides
  sections); keeping the sidebar collapsible (more code for the same result).
- **Trade-off:** adding a sixth or seventh section would need a "More" menu.

## D-38. The website's tooling runs on Node 24; the API stays on Node 20 for now (2026-10-04)

- **What:** the CI frontend job and `frontend/Dockerfile.dev` use Node 24 (the current LTS, the same
  as the development laptop). The backend and extension jobs and `backend/Dockerfile` stay on Node 20.
- **Why:** Vitest 5 and jest-dom 7 declare Node 22 or newer. On Node 20 npm prints `EBADENGINE` and
  the tools work only because nothing they use is missing yet (all 51 tests passed on 20.20 in a
  clean container on 2026-10-04), so any patch release could break CI. Node 20 itself has been out
  of support since April 2026.
- **Rejected:** pinning older Vitest and jest-dom that still support Node 20 (holding the tools back
  to suit an end-of-life runtime); moving the API to Node 24 in the same change (that changes what
  runs in production on Render, so it gets its own change, test run and redeploy: L-15).
- **Trade-off:** CI runs two Node versions until L-15 is done.

## D-37. Sign-out reloads the page instead of navigating inside the app (2026-10-04)

- **What:** Sign out calls `POST /auth/logout`, then `window.location.replace('/')`: a fresh page
  load of the landing page (`frontend/src/components/layout/signOut.ts`).
- **Why:** The first version cleared the signed-in user from the React Query cache and then
  navigated to `/`. React drew the current page first with no user (the cache update is urgent,
  React Router's navigation is a transition), so that page's sign-in guard remembered it and sent
  the person to `/login`; whoever signed in next on that tab would have been sent to the previous
  user's page. A full page load has no such race and guarantees nothing from the old session
  (cached data, component state) stays in memory, which matters on shared lab computers. Found
  while checking the redesign in a browser; a routing test covers it.
- **Rejected:** ordering tricks (navigate first and clear later, or clear inside a transition):
  they depend on React's scheduling and on how fast the landing page's chunk loads. A "signing
  out" flag read by the guard: one more piece of state to keep right.
- **Trade-off:** sign-out reloads the app (the JavaScript comes from the browser cache, so it is
  quick). In local `AUTH_BYPASS` mode the reload signs the demo user straight back in.

## D-36. Sign In is the main way to connect VS Code; the profile key moves to "Advanced" (2026-10-04)

- **What:** Onboarding, Profile, the guide and the landing page lead with **CodeTrackr: Sign In**.
  Onboarding no longer creates a profile API key by itself; the key (create, show once, copy) sits
  in a collapsed "Advanced: connect with an API key" section on Profile.
- **Why:** Sign In gives each computer its own expiring, revocable key and nobody copies secrets by
  hand (D-24). Showing a key first taught people the old way.
- **Rejected:** removing the profile key now. Everyone on extension 2.4.0 connects with one and 2.4.0
  has no Sign In; that removal is parked until 2.5.0 is widely installed (docs/SESSION_STATE.md).
- **Trade-off:** two ways to connect still exist, so the docs explain both.

## D-35. Backend additions for the redesign: one history pipeline, day cells in the viewer's time zone, an invite preview (2026-10-04)

- **What:** `GET /api/analytics/history/:userId` (one `$facet` over 365 local days: seconds per day,
  per hour of day and per project over 7 days, commits over 7 days); a `daily` field on group details
  (seconds per member per local day of the window, or the last 7 days; none beyond 62 days); and
  `GET /api/groups/:id/preview` for invite links. All additive; integration-tested.
- **Why:** the year heatmap, "when you code", the tower's day cells, the race chart and invite links
  had no data source. The old `/summary` endpoint groups by UTC day and scans all history, so a
  late-night session in India landed on the wrong day.
- **Rejected:** one endpoint per chart (more round trips, more code); computing day cells on the
  client from per-upload data (far more data over the wire); each member's own time zone for day
  cells (a board is read by one person, and mixed boundaries would make cells disagree with each
  other); a public, unauthenticated preview (it would list every group to anyone).
- **Trade-off:** a friend in another time zone sees day boundaries in their own zone, so two people
  can see a session on different days. The preview shows a group's name to any signed-in user
  with the link, which Discover already did.

## D-34. Frontend tests: Vitest + Testing Library in jsdom, pinned to India's time zone (2026-10-04)

- **What:** `npm test` in `frontend/` runs Vitest with jsdom and Testing Library. Pure logic (local
  dates, standings, day cells, label layout, heatmap levels, streaks) has unit tests; components are
  tested through what a person or screen reader gets (an ordered list read as "2nd, Soham (you),
  +30m"); routing is tested with the API mocked. `TZ=Asia/Kolkata` for every run. Runs in CI.
- **Why:** "no frontend tests" was a known gap. Both date bugs found in this project (H-22 and the
  goal-date bug) only happen east of UTC, so the tests run where the users are.
- **Rejected:** Jest (needs its own TypeScript and ESM setup alongside Vite); Playwright end-to-end
  tests now (much slower and needs a running API; the right next step, not the first).
- **Trade-off:** jsdom has no layout or animation, so visual checks (overflow at 320 px, the slide
  animation, contrast) were done by hand in a browser and recorded in PROGRESS.

## D-33. Every page is its own chunk (2026-10-04)

- **What:** pages load with `React.lazy`, each layout wraps its outlet in `Suspense` with a
  skeleton, and public pages render without waiting for the sign-in check.
- **Why:** the old site shipped one 712 kB JavaScript file to everyone, including people reading
  the landing page. Measured after: the landing page's first visit is 359 kB (114 kB gzipped), down
  about half (see PROGRESS 2026-10-04).
- **Rejected:** manual `manualChunks` tuning (more config for a small extra gain).
- **Trade-off:** the first visit to each signed-in page fetches a small extra file (a skeleton shows
  briefly). The shared core (React, router, React Query) is still 307 kB.

## D-32. Hand-made SVG/HTML charts instead of Chart.js (2026-10-04)

- **What:** seven small components (`StandingsTower`, `RaceChart`, `Bars`, `YearHeatmap`,
  `HourStrip`, `Ring`, `Sparkline`) replace Chart.js, react-chartjs-2 and the datalabels plugin.
- **Why:** every chart here is bars, lines or a grid. SVG/HTML reads the theme's CSS variables
  directly, so dark and light need no JavaScript re-styling; it renders in jsdom, so it can be
  tested; labels can sit on the data (names at line ends, pushed apart so they never overlap); and
  each chart can carry a text summary or a hidden data table for screen readers.
- **Rejected:** Chart.js (canvas: no CSS variables, nothing for tests or screen readers to read,
  and the largest dependency after the 3D libraries); Recharts (another library to learn and size
  for the same few chart types).
- **Trade-off:** we maintain tooltips, axes and resizing ourselves (about 600 lines); adding an
  unusual chart type later means writing it.

## D-31. Website redesign: "the weekly race" (2026-10-04)

- **What:** a new design built around one idea, every week is a race between friends. The
  signature is a standings tower borrowed from F1 timing (position, name, one cell per day coloured
  like timing sectors, gap to the leader). Dark by default with a full light theme; three typefaces
  with one job each (Big Shoulders Display for headings and positions, Instrument Sans for text,
  Martian Mono for numbers); one animated moment (rows sliding into new positions); new public pages
  (landing, guide, privacy) and invite links. Spec: `docs/specs/2026-10-04-frontend-redesign.md`;
  the user approved the proposal board before any code changed.
- **Why:** the user found the old site flashy (3D background, glitch text, custom cursor, 28
  themes), confusing (a 1,150-line dashboard) and generic, and there was no page explaining the
  product. The product exists for friendly competition, so the competition leads.
- **Rejected:** a clean, quiet dev-tool look (the user chose "playful and competitive"); keeping the
  28 themes (two done properly instead); restyling only (the layouts were the problem).
- **Trade-off:** the typefaces load from Google Fonts (a third-party request; system fonts are the
  fallback). A teammate's `THEME_USER_GUIDE.md` now describes a theme system that no longer exists.

## D-30. Report every `log.error` to Sentry, from one place (2026-10-04)

- **What:** `services/errorReporter.js` registers itself with the logger, so any `log.error` —
  the central error handler, routes that catch their own errors, background jobs, and new
  `unhandledRejection` / `uncaughtException` handlers in `app.js` — is sent to Sentry when
  `SENTRY_DSN` is set. The per-request access line uses `log.access`, which is never reported.
- **Why:** Sentry used to be called only from the central error handler. Four route-level 500s
  (`routes/user.js` ×3, `routes/metrics.js`), the scheduler's job failures and process crashes
  went only to the Render log, so a dashboard would have shown an incomplete picture.
- **Rejected:** calling Sentry at each catch site (easy to forget at the next one); rewriting
  every catch to `next(err)` (changes response bodies the frontend reads, and doesn't cover jobs);
  Sentry's Express integration (needs the SDK loaded before Express and still misses jobs).
- **Trade-offs:** "error" now means "worth a human looking", so a new `log.error` must be a real
  problem, not noise. Only `method`, `path`, `status` and the request id are attached — no user
  ids or emails go to a third party. After an uncaught exception the process exits (after up to
  2 s to send the report) and Render restarts it, because its state is unknown.

## D-29. One site for the browser: forward the API through Vercel (2026-10-03)

- **What:** `frontend/vercel.json` rewrites `/api/*` and `/auth/*` to Render; the production site
  calls its own address; Google's callback goes through the website. Spec:
  `docs/specs/2026-10-03-first-party-api-proxy.md`.
- **Why:** the website and API were on different sites, so the login cookie was third-party and
  Safari, Firefox, Brave and private windows block those (H-19).
- **Rejected:** moving the backend to its own Vercel project (two `*.vercel.app` addresses are still
  two sites — `vercel.app` is a public suffix); a custom domain (costs money, more setup, adds
  nothing for login); moving the API into the Vercel project as functions (fixes cold starts too,
  but a much bigger move: per-instance rate limiters, connection reuse, and the published
  extension still points at Render).
- **Trade-offs:** Render's cold start now sits behind Vercel's proxy (wait limit undocumented —
  checked after deploy); Vercel hides visitor IPs from Render, so limits had to move from per-IP to
  per-user/session (which also fixed H-20); the cookie stays `SameSite=None` during the switch
  (tighten to `Lax` later).

## D-28. Docker Compose for local development (2026-10-03)

- **What:** `docker-compose.yml` runs MongoDB, the API (same image as `backend/Dockerfile`) and
  the website's dev server with one command; demo data is seeded once by `scripts/seed-local.js`.
- **Why:** one command instead of several terminals; a real, persistent database instead of the
  in-memory one; anyone with Docker can run the project without installing Node or MongoDB; and
  it finally exercises the production Dockerfile on a laptop.
- **Rejected:** a production-build (nginx) frontend container (no live reload while developing);
  running Google sign-in in Compose (needs a localhost OAuth client — `AUTH_BYPASS` keeps it
  local-only and is refused in production); publishing Mongo on 27017 (clashes with a MongoDB
  installed on the laptop, which this machine had).
- **Trade-off:** first build downloads a few hundred MB; file watching through a Windows bind
  mount needs polling (`CHOKIDAR_USEPOLLING`); the API inside Compose accepts any extension key
  (bypass), so key revocation can't be tested there.
- **Safety:** the seed script refuses any host except `mongo`/`localhost`/`127.0.0.1`, so it
  cannot write demo data into Atlas.

## D-27. Docker image and CD off by default (2026-10-03)

- **What:** a production Dockerfile and a CI job that builds it and health-checks it; a deploy
  workflow that triggers Render only after green CI, inert until a secret exists.
- **Why:** reproducible builds and "only green builds deploy"; the image also makes the app
  portable off Render.
- **Rejected:** switching Render to the Docker runtime now (a hosting change the user did not ask
  for); pushing images to a registry (nothing consumes them yet).
- **Trade-off:** until the user adds the hook and disables Render's auto-deploy, Render still
  deploys every push to `main`, green or not.

## D-24. Device-code sign-in issuing per-device keys (2026-10-03)

- **What:** the extension gets its key through the OAuth device-grant pattern (short user code
  approved on the website) instead of the user copying a key. Each approval creates a separate
  `ct_` key in `devicetokens`, ingest-only, valid for a year, revocable one by one.
- **Why:** copying a long secret between apps is error-prone and trains people to paste keys
  around; per-device keys mean a lost laptop does not force rotating every install; an expiry
  bounds a leaked key's life.
- **Rejected:** a localhost redirect OAuth flow inside VS Code (needs a local port and a second
  OAuth client); reusing the profile key (one key for every device, no per-device revoke);
  short-lived access + refresh tokens (correct, but a refresh store and rotation logic for an
  upload-only credential).
- **Trade-off:** device-code phishing — someone can trick a user into approving the attacker's
  code. Impact is limited to uploading fake activity as that user (the key is ingest-only), and
  the page warns to approve only a code shown in your own editor. The profile key still exists as
  a fallback.

## D-23. Group ownership passes to the longest-standing member (2026-10-03)

- **What:** only the creator (`createdBy`) can rename a group or remove members; when the
  creator leaves, `createdBy` moves to the member with the earliest `joinedAt`.
- **Why:** one admin is enough for a friend-group product, and an admin-less group could never
  be renamed or cleaned up.
- **Rejected:** a roles table with several admins (more UI and rules than the use case needs);
  deleting the group when the creator leaves (punishes everyone else); hiding private groups
  from Discover (the user chose to keep them visible with a password).
- **Trade-off:** no way to hand ownership to a chosen member; a removed member can rejoin a
  public group (no ban list).

## D-22. userId type change as expand/contract with a merge (2026-10-03)

- **What:** reads accept both String and ObjectId and group on the string form; writes switch to
  ObjectId immediately; a script converts old documents and merges same-window bucket pairs;
  later the string branch is removed.
- **Why:** a one-shot `updateMany` with `$toObjectId` would fail on the unique bucket index the
  moment new-style buckets exist, and a big-bang deploy + migration would leave a window where
  reads miss data.
- **Rejected:** keep strings forever (blocks `$lookup`, keeps every join in Node); write strings
  until after the migration (new strings written after the run still need a second pass with the
  same collision handling); a `Mixed` schema forever (no type safety).
- **Trade-off:** during the window a user can have two documents for one 10-minute bucket (both
  counted, never double-counted); every read pays an `$in` of two values; `Mixed` disables
  casting, so code must pass the right type (the helper does).

## D-21. Refactor proven by an oracle, not by reading (2026-10-03)

- **What:** before moving the dashboard aggregation into MongoDB, the old JavaScript was copied
  verbatim into a test helper; the test runs old and new on the same seeded data and requires the
  same output.
- **Why:** the routes return nested shapes (24-hour and 7-day grids, terminal summaries, top-5
  failures) with no prior tests; reading the code is not proof.
- **Rejected:** snapshot files (depend on "now", day labels and timezone, so they go stale);
  rewriting without a safety net.
- **Trade-off:** the oracle is dead code kept only for the test, and it encodes old behaviour
  including bugs — where the new code is intentionally different (M-32's window), the test feeds
  both the new window and a separate test asserts the new behaviour.

## D-20. Leaderboard on write-time running totals (2026-10-03)

- **What:** `userstats`, one row per user, `$inc`ed on every credited write; the leaderboard reads
  `find().sort({totalSeconds:-1}).limit(N)` plus `findOne` sorted by commits and by code changes
  for the score maxima — all indexed. Falls back to the old scan when the collection is empty.
- **Why:** the old endpoint aggregated the whole `activities` collection and loaded every user on
  each request (H-7) — it grows with total history, the new one with N.
- **Rejected:** a cache in front of the scan (stale, and still pays the full scan on a miss); Redis
  sorted sets (another service; worth it only for "my rank among millions", which nobody needs
  yet); reading `dailysummaries` (still O(days × users) for all-time).
- **Trade-off:** two copies of the truth that can drift (a crash between the bucket write and the
  stats write). `backfill-userstats.js` reconciles; the test proves a rebuild equals the live
  totals. Windowed boards still scan, bounded by the window. Users with no activity no longer
  appear (they used to show as zero rows).

## D-19. Anti-cheat: credit time, don't trust it (2026-10-03)

- **What:** three limits on ingest — focus corroboration (≤ focus time + 120 s), a 600 s cap per
  user per 10-minute window via an atomic `$inc` counter, and spreading long uploads across the
  windows they cover — plus a per-key quota. `duration` = credited, `claimedDuration` = claimed.
- **Why:** leaderboards rank on duration and the client reports it. Without a cap, a script could
  add hundreds of hours a minute (H-21).
- **Rejected:** read-then-write cap (two concurrent uploads both see room → over the cap);
  truncating long uploads at 600 s (punishes honest offline work); server-side timestamps only
  (offline work would land at upload time); "anomaly detection" (no data to tune it on yet).
- **Trade-off:** client telemetry can always be forged; this bounds a forger to real-time speed
  and keeps the evidence (`claimedDuration`). The counter is not rolled back if a later bucket
  write fails, so a failed upload can slightly reduce what that window credits on retry.

## D-18. Idempotency with a receipt row, not a transaction (2026-10-03)

- **What:** before applying an upload with a `flushId`, insert `{userId, flushId}` into
  `ingestreceipts` (unique index, 48 h TTL). Duplicate key → already applied → skip. If applying
  fails, delete the receipt.
- **Why:** the bucket write is a `$inc`, so replaying an upload double-counts. The client cannot
  know whether a timed-out request was applied; an id lets it retry safely.
- **Rejected:** a multi-document transaction (needs a replica set in every environment, including
  tests, for a two-write sequence); storing applied ids inside the bucket document (unbounded array,
  and an upload can span buckets once item 5 spreads long uploads).
- **Trade-off:** a crash between the receipt insert and the bucket write (process killed, not an
  exception) leaves a receipt with no data, so that one upload is lost rather than doubled. 48 h
  TTL > the 24 h ingest window, so an expired receipt cannot be replayed into the window.

## D-17. API keys: `ct_<id>_<secret>`, SHA-256 at rest, shown once (2026-10-03)

- **What:** a public id for lookup plus a 256-bit secret; only SHA-256(secret) is stored and
  checked with `timingSafeEqual`. The key is shown once at creation. Legacy keys are looked up by
  their own SHA-256 and converted lazily. The extension stores the key in SecretStorage.
- **Why:** a database leak should not hand out working credentials, and the key should not sit
  in plaintext in `settings.json`. The id lets the server find the row without comparing secrets
  across users.
- **Rejected:** scrypt/bcrypt for the secret (made for low-entropy passwords; for a random
  256-bit secret it only adds latency to every upload); encrypting keys (the server would still
  hold the decryption key); forcing every user to regenerate (breaks every installed extension at
  once).
- **Trade-off:** a lost key cannot be recovered, only replaced; users must copy it the moment it
  is shown. Still no expiry or scope (device-code login, roadmap item 13).

## D-16. OAuth `state` kept in a cookie, not a session (2026-10-03)

- **What:** a custom passport-oauth2 state store writes a random nonce to a 10-minute httpOnly
  `SameSite=Lax` cookie on `/auth/google` and checks it with `timingSafeEqual` on the callback.
- **Why:** passport's built-in `state: true` needs `express-session`, and the app is deliberately
  stateless (JWT cookie, no session store; it also runs serverless-safe).
- **Rejected:** adding `express-session` with a Mongo store (a new collection and middleware for
  one nonce); a signed JWT as the state (works, but a cookie comparison is simpler to explain).
- **Trade-off:** a login started in one browser tab and finished in another browser fails
  (correct behaviour); cookies must be enabled for the API host.

## D-14. Standard doc set (2026-10-03)

- **What:** `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md` and
  `docs/INTERVIEW_PREP.md` are the short, always-current entry points; the long-form files
  (`CODETRACKR_PROJECT_CONTEXT.md`, `docs/IMPROVEMENT_PLAN.md`, `docs/interview-preparation/`)
  stay as the detailed reference.
- **Why:** the README was an 11-line stub and the architecture file described a design that no
  longer existed; a reader had to know which of ~30 docs to trust.
- **Rejected:** deleting the long-form docs (they hold the evidence behind each fix).
- **Trade-off:** some facts appear in two places; the short docs point to the long ones instead
  of repeating detail.
