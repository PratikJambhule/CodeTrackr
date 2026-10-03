# CodeTrackr

CodeTrackr tracks your coding activity in VS Code and turns it into a dashboard, goals, a
global leaderboard and private groups where friends can compare hours, commits and how often
their builds and commands fail. It started as a way to keep friendly competition going in a
college friend group: because every editor is tracked automatically, nobody has to log time
by hand.

- **Live site:** https://code-trackr-frontend.vercel.app (backend on Render's free tier: the
  first request after ~15 idle minutes takes ~22 s)
- **Extension:** `CodeTrackr-ext.codetrackr-vscode` on the VS Code Marketplace (version 2.4.0)

## What it does

| Part | What the user sees |
|---|---|
| VS Code extension | Runs in the background. Every ~2 minutes of active coding it sends one summary: time, language, project, edit counts, terminal commands and their exit codes, commits, focus time. Never file contents, diffs or full paths. |
| Dashboard | Today's hours by hour, the last 7 days, languages, streak, terminal/build success, repeated failing commands. |
| Sign-in for the extension | **CodeTrackr: Sign In** shows a code; approve it on the website and that VS Code gets its own revocable key (or paste a key from Profile). |
| Insights | Statistics over your own data (deep-work ratio, peak 2-hour window, cadence, churn, ...) plus a "What stands out" panel from 13 threshold rules. Each number shows "—" when there is not enough data. **Not machine learning.** |
| Goals | "Spend N hours on X by date". Progress comes from tracked time whose language or project matches X. Deadline reminders run hourly. |
| Leaderboard + Groups | Global ranking by hours, plus private or public groups whose leaderboard shows hours, lines, commits and failed commands/builds per member. |

## Tech stack

| Layer | Stack |
|---|---|
| Extension | TypeScript, esbuild, axios, VS Code API (shell integration, Git extension API) |
| Backend | Node 18, Express 5, Mongoose 8, Passport (Google OAuth 2.0), JWT in an httpOnly cookie, helmet, express-rate-limit |
| Database | MongoDB Atlas |
| Frontend | React 19, Vite 7, TypeScript, Tailwind 3, react-router 7, Chart.js |
| Hosting | Backend on Render, frontend on Vercel, scheduled jobs from GitHub Actions |
| CI / CD | GitHub Actions: unit + integration tests, extension tests, frontend build, Docker image health check; optional deploy-on-green (`deploy.yml`) |
| Ops | JSON logs with request ids, optional Sentry, `backend/Dockerfile` |

## Run it locally

You need Node 18+, a MongoDB connection string and a Google OAuth client
(redirect URI `http://localhost:5050/auth/google/callback`).

```bash
cd backend && npm install && cp .env.example .env
```

Fill in `MONGO_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`GOOGLE_CALLBACK_URL` in `backend/.env`. The API refuses to start without them.

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

The dashboard opens on http://localhost:5173 and talks to http://localhost:5050 unless
`VITE_API_URL` is set. For the extension, run `npm install && npm run build` in `extension/`, then
either `npm run package` and install the `.vsix`, or open the folder in VS Code and start an
Extension Development Host (there is no committed `launch.json`, so VS Code offers to create one).
Then set `codetrackr.apiBase` to `http://localhost:5050` and paste the API key from the
Profile page with the **CodeTrackr: Setup API Key** command.

### Run everything with Docker (easiest)

Install Docker Desktop and start it (wait for "Engine running"). Then, from the project folder:

```bash
docker compose up --build
```

Open http://localhost:5173. Three containers start together:

| Container | What it is | Address |
|---|---|---|
| `mongo` | a real MongoDB 7; your data is kept between runs | `mongodb://localhost:27018/codetrackr` from your laptop |
| `backend` | the API, built from `backend/Dockerfile`; seeds demo data on first start | http://localhost:5050 |
| `frontend` | the website's dev server; edits in `frontend/src` reload the page | http://localhost:5173 |

You are signed in as the demo user "Soham (local)" (Google sign-in is replaced by `AUTH_BYPASS`,
local only). Nothing reads `backend/.env` or touches the live database. Stop with `Ctrl+C`, or
`docker compose down`; add `-v` to also delete the local data. Point the extension at
`http://localhost:5050` to send it real activity (see below).

### Run everything locally without any accounts

```bash
cd backend && npm run dev:local
```

```bash
cd frontend && npm run dev
```

`dev:local` starts the real API on an in-memory MongoDB with `AUTH_BYPASS` on (refused in
production) and seeds two demo users, their activity and a shared group. Open
http://localhost:5173. Data is gone when the process stops. On Windows start it with
`node scripts/dev-local.js` if you will stop it from a script: stopping `npm run` can leave the
server running on port 5050.

To try the extension against this local API without touching your normal VS Code, build it and
open a separate test window with its own profile:

```bash
cd extension && npm run build
```

```bash
code --new-window --user-data-dir ./.vscode-test-profile --extensions-dir ./.vscode-test-ext --extensionDevelopmentPath "$(pwd)/extension" path/to/any/folder
```

In that window set `codetrackr.apiBase` to `http://localhost:5050` (optionally
`codetrackr.flushIntervalSeconds: 10` and `codetrackr.minFlushMinutes: 0.5` to see uploads
quickly), then run **CodeTrackr: Sign In**. With `AUTH_BYPASS` every upload is credited to the
demo user shown on the dashboard.

## Test it

```bash
cd backend && npm test
```

```bash
cd backend && npm run test:int
```

```bash
cd extension && npm test
```

```bash
cd frontend && npm run build
```

Current results (2026-10-03): backend unit 23 suites / 346 assertions, backend integration
35 tests (the real Express app over HTTP against an in-memory MongoDB), extension 6 suites /
70 assertions, frontend type-check + build green. Benchmarks: `docs/BENCHMARKS.md`. Unit tests are plain `node:assert` scripts;
integration tests use `supertest` + `mongodb-memory-server`. There are no frontend tests yet.

## Documentation

| File | Read it for |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, diagrams |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why each major choice was made, and what was rejected |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Dated log of what was built, tested and fixed |
| [docs/INTERVIEW_PREP.md](docs/INTERVIEW_PREP.md) | Likely interview questions with short answers |
| [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) | Every known weakness (H/M/L findings), fixed or open |
| [docs/BENCHMARKS.md](docs/BENCHMARKS.md) | Measured leaderboard and ingest numbers, with how to re-run them |
| [docs/RELEASE.md](docs/RELEASE.md) | Deploy order, live migrations, publishing the extension |
| [docs/ROADMAP_2026-10.md](docs/ROADMAP_2026-10.md) | The October 2026 improvement plan and its status |
| [CODETRACKR_PROJECT_CONTEXT.md](CODETRACKR_PROJECT_CONTEXT.md) | Long-form reference of the whole implementation |
| [docs/INSIGHTS_METRICS.md](docs/INSIGHTS_METRICS.md), [docs/RULES_ENGINE.md](docs/RULES_ENGINE.md) | Every Insights formula and rule |
| [docs/ML_INTEGRATION_PLAN.md](docs/ML_INTEGRATION_PLAN.md) | The machine-learning plan (designed, **not built**, blocked on data) |
| [docs/interview-preparation/](docs/interview-preparation/) | Full interview guide, Q&A bank, cheat sheet |

## Team

Pratik Jambhule, Kartik Kharat, Soham Budhewar.
