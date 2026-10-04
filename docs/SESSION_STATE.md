# Session state (handoff)

_Snapshot for the next session. Read this first. History is in `docs/PROGRESS.md`._
_Last updated: 2026-10-04 (frontend lint clean, sign-out bug fixed; ready for the user to commit)._

## 🟡 Right now: website redesign PUSHED 2026-10-04 as `f462444` (deploying); live checks pending

Pushed by me at the user's request. Render + Vercel deploy `main` automatically. Next: CI result,
then `docs/RELEASE.md` §2b checks on the live site, then flip "built, not deployed" → "deployed"
for the website in every doc, the interview-prep boxes, cheat sheet and resume notes; rebuild PDFs.
The notes below describe what that commit contains.

**After `f462444` (uncommitted, 2026-10-04):** (1) **H-24 fixed** — the live all-time leaderboard and
group boards showed only people who uploaded since the deploy, because they switched to `userstats`
once it had any row; now `rebuildAll({apply:true})` records `userstats-backfill` in a new `migrations`
collection and the boards switch only then (D-39; `models/Migration.js`, `services/userStats.js`
`statsComplete()`, regression test; integration 40). Needs a push to go live; the backfill (user's step)
then turns on the fast path. (2) **Top navigation bar** replaces the sidebar on desktop, phones keep
bottom tabs (D-40, `components/layout/AppShell.tsx`), checked at desktop + 375 px.

**Live:** commit `13569e7` on Render + Vercel (the OLD website; Google login works; the Sentry hook is
in and switches on once `SENTRY_DSN` is set on Render). **Extension 2.5.0 is live on the Marketplace**
(checked 2026-10-04: `npx vsce show CodeTrackr-ext.codetrackr-vscode` lists 2.5.0; the listing page
shows the 2.5.0 README and 94 installs). All docs were corrected from "submitted/unpublished" to live.

**Uncommitted in the working tree (~90 entries, all from this work):** the website redesign "the
weekly race" — spec `docs/specs/2026-10-04-frontend-redesign.md`, decisions D-31..D-36, PROGRESS
entries of 2026-10-04.
- Backend: `services/historyView.js` (`GET /api/analytics/history/:userId`), `services/groupDaily.js`
  (`daily` cells on group details, viewer's time zone, ≤ 62 days), `GET /api/groups/:id/preview`
  (invite links), `tests/localDays.test.js`, 3 integration tests, richer `scripts/dev-local.js` seed.
- Frontend: new `src/` — `lib/` (format, standings, calendar; unit-tested), `hooks/queries.ts`,
  `components/ui|charts|layout`, `pages/public/*` (landing, guide, privacy, login, 404),
  `pages/dashboard/*`, `GroupBoard`, `JoinGroup`, `theme.tsx`, `types.ts`, Vitest tests. Old effects,
  28 themes, Chart.js, three/ogl/gsap removed (22 deletions already staged with `git rm`).
- Extension 2.5.0 Marketplace files (README, CHANGELOG, icon, package.json links): already published
  from this tree, not yet committed.
- Docs: all updated for the redesign (README, ARCHITECTURE §8, DECISIONS, PROGRESS, IMPROVEMENT_PLAN,
  INTERVIEW_PREP "The website", CONTEXT, RELEASE §2b, CI frontend-test step, CLAUDE.md §5, interview-prep
  update boxes + cheat sheet + Q&A + guides, resume frontend bullets).

**Verified 2026-10-04 (latest run):** frontend lint 0 problems, `tsc -b` clean, Vitest 51 (6 files),
`npm run build` green; backend unit 27 suites / 375, integration 40, extension 6 suites / 70. Every
page seen in a browser on desktop and at 307–375 px, light + dark; flows tested by hand are listed in
PROGRESS. Landing first visit 358,681 B raw / 114,167 B gzip vs 747,989 / 231,590 before.

**Done since (2026-10-04):** lint 13 → 0 (helpers moved to `.ts` files: `ui/buttonClass.ts`,
`ui/toastContext.ts`, `themeContext.ts`, `charts/tone.ts`, `cellsSummary` → `lib/standings.ts`;
`ui/index.tsx` → `ui/Primitives.tsx` + a re-export-only `ui/index.ts`); CI now runs `npm run lint`.
Bug found in the browser and fixed: sign-out landed on `/login` and remembered the page → sign-out
now ends the session and reloads `/` (`layout/signOut.ts`, D-37, routing test). Docs, interview
prep (counts 49 → 51, the new bug story, stale 2.5.0 caveat in the cheat sheet) updated; PDFs rebuilt.
Then the website's CI job and `frontend/Dockerfile.dev` moved to Node 24 (D-38; Vitest 5 needs 22.12+;
both 20 and 24 pass in clean containers); the API on end-of-life Node 20 is logged as L-15.

## Next steps — mine, in order

1. ✅ Handover written 2026-10-04: message in `.git/COMMIT_DRAFT.txt`, the 104 files (no directories,
   not the three permanently-dirty files) in `.git/COMMIT_FILES.txt`; the 22 deletions are already
   staged. The user runs `git add --pathspec-from-file=.git/COMMIT_FILES.txt` then
   `git commit -F .git/COMMIT_DRAFT.txt` and pushes; **pushing deploys the redesign**.
2. Tell the user `THEME_USER_GUIDE.md` (teammates' guide to the old 28 themes) is obsolete. It is not
   edited (project rule).
3. After the user pushes: `docs/RELEASE.md` §2b checks, then change "built, not deployed" to
   "deployed" for the website in every doc, the update boxes, cheat sheet and resume notes; rebuild PDFs.

## Next steps — the user's, in order

1. Commit + push the redesign (after my step 1), then the §2b checks on the live site.
2. Log in from Safari / a private window and after ~15 min idle (H-19 proof; cold start behind the
   proxy). Then mark H-19 ✅ in `IMPROVEMENT_PLAN.md` + cheat sheet + update boxes.
3. In Google, delete the OLD client secret; check the consent screen is "In production".
4. Live migrations from `backend/`, dry run first, then `--apply`: `migrate-hash-api-keys.js` →
   `migrate-activity-userid.js` → `backfill-userstats.js` (quiet time). Record counts in PROGRESS.
5. Sentry: confirm `SENTRY_DSN` is set on Render (was being set up 2026-10-04) and email alerts are on.
6. With 2.5.0 installed: run **CodeTrackr: Sign In** against the live site; check Profile → Connected devices.

## Open findings (detail in `docs/IMPROVEMENT_PLAN.md`)

M-33 a failed Google sign-in shows raw JSON (offered fix: custom `passport.authenticate` callback in
`routes/auth.js` → `/login?error=signin`, plus an integration test with a failing token exchange);
M-35 goal progress stops at 00:00 UTC of the deadline day; L-14 no self-serve data deletion; L-10
cold start (now explained on screen); H-19 Safari proof pending; L-15 Node 20 is end of life: the website's CI
job + dev image moved to Node 24 (D-38); the API (Dockerfile, backend/extension CI, Render) is still on
20, the user's call since it changes production. Others: M-5 dead files, M-7 root
`package.json`, L-6 extension strict TS, L-7 idle ≤ 2 min counted, `SameSite=Lax` once every browser
uses the proxy, the `userId` contract step, no end-to-end browser tests.

## ⏸ Parked task (user asked 2026-10-04, then said "keep it for next time")

**Remove the profile API key completely; "CodeTrackr: Sign In" becomes the only way to connect.**
Not started. Already done by the redesign (D-36): Onboarding leads with Sign In; the key lives on
Profile under "Advanced: connect with an API key". **Ask first:** what happens to existing profile
keys? 2.5.0 (with Sign In) is now live, but people only move once VS Code updates the extension.
Options: (A, recommended) stop issuing keys and remove the UI/commands, keep accepting existing keys
until a cleanup script runs once most uploads come from device keys; (B) hard cutoff now (401);
(C) reject after a date, extension shows "please sign in" on rejection.
Touchpoints (2026-10-04 grep):
- Backend: `routes/user.js` (`hasApiKey`/`apiKeyHint`/`legacyApiKey`, `POST /regenerate-api-key`);
  `middleware/auth.js:78` issues a key at login; `findUserByApiKey` checks `users` then
  `devicetokens`; `models/user.js` key fields + `issueApiKey`/`apiKeyHint`;
  `scripts/migrate-hash-api-keys.js`; tests `tests/apiKeys.test.js` + integration "regenerate/legacy".
- Frontend: `pages/Profile.tsx` `ApiKeySection`; `pages/Onboarding.tsx` fallback link to it.
- Extension: command `codetrackr.setupApiKey` + setting `codetrackr.apiKey`; `src/extension.ts`
  `setupApiKey()`, its prompts, the settings→SecretStorage move, the config listener; `secretKey.test.js`.
- Docs after: DECISIONS, ARCHITECTURE §4, README, RELEASE, CHANGELOG, interview prep, resume bullet 1.

## What this project is

CodeTrackr: VS Code extension (TypeScript) → Express 5 / Mongoose 8 / MongoDB Atlas API on Render
(`codetrackr-backend-uckp.onrender.com`) → React 19 + Vite website on Vercel
(`code-trackr-frontend.vercel.app`, which forwards `/api` + `/auth` to Render). Built for friendly
competition in a college friend group. Team of 3; the user (Soham) owns extension + backend.
Repo remote: `PratikJambhule/CodeTrackr`.

## User decisions on record

- Resume: ownership = extension + backend (team of 3); keep those bullets as they are and add the
  frontend bullets below them (2026-10-04).
- Redesign (2026-10-04, "go with all recommended options"): "the weekly race" direction; three small
  backend additions; 28 themes → dark + light (+ system); Vitest frontend tests.
- Private groups stay visible in Discover (password-protected). External services built
  off-by-default; the user switches them on. Login fix: Vercel rewrites (not a custom domain).
- Docker: Compose with the frontend dev server.
- Standing rule: keep every doc current with every change, the interview-prep folder first
  (CLAUDE.md §3). The user commits and pushes (pushed `13569e7` on request).

## Gotchas

- `backend/.env` = LIVE settings (Atlas). Tests/bench/dev scripts set their own env first;
  migration + usage scripts DO use it (user's action only).
- Windows: stopping a background `npm run …` orphans the `node` child (holds port 5050, serves stale
  code). Start `node scripts/dev-local.js` directly. This session left the local API (5050) and Vite
  (5173) running — check `netstat -ano | grep -E ':(5050|5173)'` before starting new ones.
- Never stage `THEME_USER_GUIDE.md`, `extension/extension.js`, `extension/index.html`.
- `supertest(app)` starts a server per request — listen once for bulk requests.
- Bash `curl` is blocked by a context-mode hook — use `ctx_execute` with JS `fetch`.
- Render logs are JSON lines with `requestId`; the `id` in an error body equals it.
- Python heredocs in bash mangle `\n` escapes; write scripts to the scratchpad with Write instead.
- `build_pdfs.sh` needs `cygpath -m` for its temp dir under Git Bash (already in the script).
