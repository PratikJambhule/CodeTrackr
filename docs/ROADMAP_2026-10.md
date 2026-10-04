# Improvement roadmap — October 2026

Source: the user's `CodeTrackr_Improvement_Plan.docx` (17 items), merged with the open findings
from the 2026-10-03 audit (`docs/IMPROVEMENT_PLAN.md`). Status is updated as each slice lands.

**User decisions (2026-10-03):** resume ownership = extension + backend (team of 3); private
groups stay visible in Discover, joined with the password (the "hide private groups" part of
item 11 is dropped); anything needing an account or a live action (Sentry, Open VSX, Render
deploy hook, extension publish, live-DB migrations) is built **off by default** behind an env var
or flag, with written steps for the user to switch it on.

**Not building:** k-means clustering, the LLM summary layer, Redis (plan's own "don't build").

## Order and status

Integration tests come first because every later change is verified with them.

| # | Item | Plan ref | Status |
|---|---|---|---|
| 0 | Fix contradictions in the interview guides; make the resume match | doc §0 | ✅ 2026-10-03 |
| 1 | Integration tests: supertest + mongodb-memory-server, track → analytics → leaderboard → group join, in CI | T1-4 | ✅ 2026-10-03 — 7 tests; found M-31 |
| 2 | Quick correctness fixes found in the audit: H-22 today window, M-28/M-29 emails, M-26 cancel redirect, M-25 Marketplace link, L-11 OAuth state | audit | ✅ 2026-10-03 (M-27 moves to item 3: the key flow changes there) |
| 3 | Hash API keys (`ct_<id>_<secret>`, lookup by id, compare hash with `timingSafeEqual`); old plaintext keys keep working until migrated; extension stores the key in SecretStorage | T1-1 | ✅ 2026-10-03 (backend + frontend; extension 2.5.0 live since 2026-10-04; live migration is the user's step) |
| 4 | Idempotency key per flush (client UUID, unique index with TTL, resend ignored) | T1-2 | ✅ 2026-10-03 (server + extension 2.5.0) |
| 5 | Anti-cheat: cap each user's 10-minute window at 600 s (H-21), per-key ingest quota, leaderboard hours count only with corroborating edits/focus | T1-5 | ✅ 2026-10-03 (window cap + spreading, focus corroboration, per-key quota, batch cap) |
| 6 | `UserStats` running totals updated on write; leaderboard reads them; all-time reads move to `dailysummaries` | T1-3 | ✅ 2026-10-03 (`userstats` + fallback; backfill is the user's step; windowed reads still scan, bounded by the window) |
| 7 | Contest-week group boards: `?from=&to=` on group details | T1-6 | ✅ 2026-10-03 (+ all-time group board on `userstats`, closes H-8) |
| 8 | Extension: persisted per-interval queue in `globalState`, replayed on activation (fixes M-30 + restart loss) | T2-7 | ✅ 2026-10-03 (extension 2.5.0, live since 2026-10-04; also sends `flushId`) |
| 9 | Move remaining JS-side analytics to `$group` pipelines (M-1) | T2-8 | ✅ 2026-10-03 daily + weekly (timeslot stays in JS: a 2-hour window); found M-32 |
| 10 | `activities.userId` String → ObjectId, with a dual-read window and a dry-run migration | T2-9 | ✅ expand + migration script 2026-10-03; live `--apply` and the contract step are the user's |
| 11 | React Query; delete Teams page + backend; Goals to-dos already removed | T2-10 | ✅ 2026-10-03 (Dashboard, Leaderboard, Insights on React Query; Teams page/route/model deleted; fixes M-11, M-12 partly) |
| 12 | Group admin: creator can rename and remove members | T2-11 | ✅ 2026-10-03 (+ ownership passes on when the creator leaves); found H-23 |
| 13 | Device-code login for the extension (scoped token) | T2-12 | ✅ 2026-10-03 (per-device, ingest-only, revocable, 1-year expiry; extension 2.5.0) |
| 14 | Load test leaderboard before/after rollup on seeded data (autocannon) | T3-13 | ✅ 2026-10-03 — 1M rows: p50 6.72 s → 62 ms (`docs/BENCHMARKS.md`) |
| 15 | Measure ingest throughput with and without bucketing | T3-14 | ✅ 2026-10-03 — same throughput; 4.9× fewer docs / 12.7× less data at 2-min cadence |
| 16 | Weekly-active-users metric; README demo GIF; Open VSX publish steps | T3-15 | 🟡 2026-10-03 — `scripts/usage-report.js` + Open VSX steps in `docs/RELEASE.md`; the demo GIF is the user's (needs a real VS Code screen recording) |
| 17 | Dockerfile + CD workflow (deploy hook, off until secret set) | T3-16 | ✅ 2026-10-03 — image built and health-checked locally via `docker-compose.yml` (mongo + backend + frontend); CD still off until the secret is set |
| 18 | Observability: structured JSON logs with correlation id; Sentry behind `SENTRY_DSN` | T3-17 | ✅ 2026-10-03 (Sentry path untested without a DSN) |

## Rules for every slice

Test first for logic; run backend, extension and frontend checks; update `docs/PROGRESS.md`,
`docs/DECISIONS.md`, `docs/IMPROVEMENT_PLAN.md`, `docs/INTERVIEW_PREP.md`, the resume file
(`docs/interview-preparation/CodeTrackr_Resume_Current.tex`) and `docs/SESSION_STATE.md`.
Resume numbers are added only after they are measured.
