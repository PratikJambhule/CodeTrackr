# CodeTrackr — Interview Cheat Sheet (Last-Minute Revision)

*Read this the hour before. Rewritten 2026-10-03 against the code after the October roadmap
(`docs/ROADMAP_2026-10.md`). Full detail: `CodeTrackr_Interview_Preparation.md` (its §0 lists what
changed). Short Q&A: `docs/INTERVIEW_PREP.md`. Numbers: `docs/BENCHMARKS.md`.*

> **Why it exists (say this first):** friendly competition inside my college friend group. Make a
> group for a contest week or daily practice, everyone installs the extension once, and the group
> page shows who actually put in the hours, commits — and who hit the most failed commands and
> builds. Solo analytics, insights and goals grew out of that.

> **Be precise about status.** Everything below is **built and tested**. The October work was
> **deployed on 2026-10-03** and Google login works on the live site. Still pending: the live data
> migrations (until then the leaderboard uses the old scan) and publishing extension **2.5.0**
> (2.4.0 is live) — so the extension's queue, sign-in command and keychain are "built", not live.

> **Team:** 3 contributors. I owned the **extension and the backend**.

---

## Architecture in 10 lines

1. Developer-productivity tracker: **VS Code extension → Express/MongoDB API → React dashboard.**
2. **Client–server, REST, modular monolith**, routes + a thin service layer.
3. The extension uploads a summary after ~2 min of real activity; every upload goes through a
   **persisted outbox** with its own idempotency key (`flushId`).
4. Extension auth: a **`ct_<id>_<secret>` key**, stored as SHA-256, from **device-code sign-in**
   (per-device, expiring, revocable) or the Profile page. Web auth: **Google OAuth → JWT in an
   httpOnly cookie**, with an OAuth `state` check.
5. Ingest **credits** time (focus-corroborated, ≤ 600 s per user per 10-minute window), then
   `$inc`-upserts one **10-minute `(user, project, language)` bucket**.
6. The same write `$inc`s a **`userstats`** row per user → the leaderboard is three indexed reads.
7. Dashboard views are one **`$facet` pipeline** in MongoDB; Insights = **statistics + 13 rules,
   not ML**.
8. Scheduler: GitHub Actions calls secret-protected internal routes (hourly sweep, nightly rollup).
9. Deploy: Vercel (frontend) + Render (API) + Atlas. **Vercel forwards `/api` + `/auth` to Render**,
   so the browser sees one site and the login cookie is first-party. CI runs unit + integration
   tests, the build and a Docker health check; deploy-on-green is ready but off until a secret is set.
10. Ops: JSON logs with a **request id** that also appears in error bodies; Sentry if `SENTRY_DSN`.

---

## Tech stack — one page

| Layer | Stack | Note |
|---|---|---|
| Extension | TypeScript, esbuild, axios, VS Code API | 5 trackers; outbox in `globalState`; key in **SecretStorage**; `CodeTrackr: Sign In` |
| Backend | Node 20, **Express 5**, **Mongoose 8**, passport-google-oauth20, jsonwebtoken, helmet, express-rate-limit | services: `apiKeys`, `ingestCredit`, `userStats`, `analyticsViews`, `activityUser`, `logger` |
| DB | MongoDB Atlas | 13 collections; `activities` is the big one, bucketed |
| Frontend | **React 19**, Vite 7, TS, Tailwind, react-router 7, Chart.js, **React Query** | Dashboard, Leaderboard, Insights on `useQuery`; `/device` approval page |
| "ML" | pure JS statistics + rules | no model, no LLM; ML work-type classifier is **designed, not built** |
| Ops | GitHub Actions CI, `Dockerfile`, `docker-compose.yml`, `deploy.yml`, JSON logs, optional Sentry | `docker compose up` = Mongo + API + website locally; CD off until `RENDER_DEPLOY_HOOK_URL` |
| Tests | `node:assert` + **supertest + mongodb-memory-server** | backend unit **26 suites / 369**, integration **36**, extension **6 / 70**; no frontend tests |

**Why MongoDB:** self-contained, schema-evolving activity documents; per-user time-window
queries; no hot-path joins. **Where SQL wins:** groups/goals integrity and the leaderboard
`GROUP BY` — which is why the leaderboard now reads precomputed totals instead.

---

## Data flow — one page

**Ingest**
```
VS Code events → tracker counters → 30 s tick → ≥ 2 min active + real signal? →
  payload { timestamp = interval START, flushId = UUID, 4 analytics blocks } →
  outbox.enqueue (globalState) → drain oldest first:
  POST /api/extension/track  x-api-key: ct_<id>_<secret>
    keyQuota (60/min per key) → verifyApiKey (id lookup, SHA-256 + timingSafeEqual; users then devicetokens)
    → validate (1–3600 s, lengths, timestamp ≤ 24 h old) → receipt {userId, flushId} (dup → 200, skipped)
    → credit = min(duration, focus + 120 s), spread over the 10-min windows it covers,
      each window claimed against an atomic counter capped at 600 s
    → $inc upsert of the bucket (credited seconds; claimedDuration keeps the raw claim)
    → $inc userstats
```
Outbox result: `ok` (sent or duplicate) / `drop` (400) / `retry` (offline, 5xx, no key). Survives
restart; items older than 24 h are pruned (the server would refuse them).

**Read (dashboard)**
```
useQuery → GET /api/analytics/:id?timezone=… (cookie JWT) → ownership check (403) →
  ONE $facet pipeline over today (or the last 7 local days): timeline, languages, terminal summary,
  top repeated failures → laid out on a 24-hour / 7-day grid → Chart.js
```

**Leaderboard**
```
userstats.find().sort({totalSeconds:-1}).limit(N) + two indexed maxima → scores 0–5
(?days= window, or before the backfill: the old activity scan)
```

---

## Extension — one page

- **Trackers:** Editor (gross edits, churn, saves, read vs write time), Focus (window focus, flow
  blocks), Git (commits via the Git extension API), Terminal (commands, exit codes, builds,
  repeated failures; sanitised), Debug (sessions).
- **Privacy:** never sends file contents, diffs, commit messages or full paths.
- **Sign in:** `CodeTrackr: Sign In` → copies `WXYZ-2345`, opens `/device?code=…`, polls until you
  approve → stores the per-device key in SecretStorage. `Setup API Key` still works.
- **Offline:** every upload is persisted before sending; FIFO; same `flushId` on retry.
- **Version story:** 2.1.0 was uploaded before 2.0.x, so the Marketplace served stale code for
  months; 2.4.0 fixed silent data loss; 2.5.0 (built, unpublished) adds the outbox, keychain and
  sign-in.

---

## Database — one page

| Collection | Key facts |
|---|---|
| `activities` | one doc per 10-min `(user, project, language)` bucket; `duration` = **credited** seconds, `claimedDuration` = raw claim; sparse sub-docs; `userId` String → ObjectId **mid-migration** (reads accept both); partial-unique bucket index; 400-day TTL |
| `userstats` | one row of running totals per user; leaderboard + group boards |
| `windowusages` / `ingestreceipts` | anti-cheat window counters / idempotency receipts, both 48 h TTL |
| `users` | `apiKeyId` + `apiKeyHash` (select:false), never the plain key |
| `devicetokens` / `deviceauths` | per-device keys (1-year expiry) / pending sign-ins (10-min TTL), hashes only |
| `groups` / `groupmembers` | scrypt passwords; join table with unique `(groupId, userId)`; creator = admin |
| `goals`, `notifications`, `dailysummaries`, `userinsights` | as before |

**Concurrency:** bucket upsert is atomic; the window cap uses `$inc` and reads its own
post-increment value, so two parallel uploads can't both fill a window; device codes are consumed
with `findOneAndDelete` (exactly one key per code).

---

## Security — one page

**Fixed in October 2026:** hashed keys (shown once), per-device keys with expiry and revoke,
OAuth `state` (L-11), cancelled sign-in no longer 404s (M-26), no emails in group routes
(M-28/M-29), **CORS now allows PATCH (H-23)**, user document no longer logged with key fields (L-12),
per-key ingest quota, idempotency, window cap (H-21), batch cap.

**Fixed earlier:** auth + ownership on analytics (H-1), legacy open endpoints deleted (H-2), scrypt
group passwords (H-9), `AUTH_BYPASS` refused in prod (H-10), IDORs (H-11), regex DoS (H-16),
leaderboard email leak (M-23), helmet + rate limits, `JWT_SECRET` required, central error handler.

**Still open — say these yourself:**
- **H-19 (live):** the login cookie was third-party (`vercel.app` vs `onrender.com`). Now Vercel
  forwards `/api` + `/auth` to Render so the browser sees one site. Deployed; Google login works
  live. Safari/private-window check still to do.
- **M-33:** a failed Google sign-in (e.g. a wrong client secret) shows raw JSON with an error id
  instead of returning to the login page. Found during go-live.
- **H-20 (fixed):** limits are per user / per session, not per IP (a campus shares one IP, and the
  Vercel proxy hides IPs anyway).
- Ingest timestamps are still client-chosen (bounded to 24 h); a scripted client can still earn
  one hour per real hour.
- No refresh token / server-side session revocation for the web JWT (1-day expiry).

---

## Numbers to know

| Claim | Number | Source |
|---|---|---|
| Leaderboard at 1M rows | p50 **6.72 s → 62 ms**, p99 7.17 s → 111 ms, 1.3 → 156 req/s | `bench/leaderboard.bench.js` (local) |
| Bucketing | **4.9× fewer docs, 12.7× less data** at the 2-min cadence (19.6× / 51× vs old 30 s); same throughput | `bench/ingest.bench.js` (local) |
| Tests | unit 26 / 369, integration 36, extension 6 / 70 | 2026-10-04 runs |
| Insights | 11 metrics, 13 rules | `metricsDerive.js`, `rulesEngine.js` |

Never quote the old "~10× fewer writes": it was a guess. Always say "local benchmark".

---

## Top questions — quick answers

1. **Tell me about it** → friendly competition for a friend group: auto-tracked hours, commits and
   failures per member, contest-week boards; extension + Express/Mongo API + React dashboard.
2. **Architecture?** → client–server REST, modular monolith, thin service layer.
3. **Why MongoDB?** → document-shaped activity, per-user windows, no joins on the hot path.
4. **How does the extension authenticate?** → `ct_<id>_<secret>`; DB stores SHA-256 of the secret;
   lookup by id, `timingSafeEqual`; shown once; per-device keys via device-code sign-in.
5. **Why SHA-256 and not bcrypt?** → bcrypt protects guessable passwords; a 256-bit random secret
   can't be guessed, so a slow hash only adds latency to every upload.
6. **Device-code flow?** → like `gh auth login`: code in the editor, approve on the site, poll;
   one key per approval (atomic consume); risk = phishing a code, impact = upload-only key.
7. **Offline?** → persisted outbox, FIFO, same id on retry; nothing lost on restart.
8. **Duplicate upload?** → `flushId` receipt with a unique index → applied once.
9. **Cheat the leaderboard?** → credited time: focus + 120 s, ≤ 600 s per window (atomic counter),
   long uploads spread; raw claim kept. A paced script still gets 1 h per real hour.
10. **Leaderboard at scale?** → was O(all activity); now `userstats` running totals: 6.7 s → 62 ms
    at 1M rows; rebuild script proven equal to live totals by a test.
11. **Analytics in JS?** → moved to a `$facet` pipeline; proven equal to the old code by running
    both on the same data (oracle test).
12. **Did bucketing help?** → measured ~5× fewer docs, 13× less data at today's cadence.
13. **Type migration?** → `userId` String → ObjectId as expand/contract: dual reads, a merge for
    same-window bucket pairs, contract later.
14. **Bug your tests missed?** → **H-23**: no PATCH in CORS → goal completion never worked in a
    browser; API tests send no preflight. Found by using the feature; now a test sends preflights.
15. **Testing?** → unit (pure functions + source scans), integration (real app + in-memory Mongo
    over HTTP), extension tests against the built bundle; all in CI. No frontend tests yet.
15a. **Safari login?** → cookie was third-party (`vercel.app` vs `onrender.com`); Vercel now
    forwards `/api` + `/auth`, site calls its own address → first-party. Separate Vercel project
    wouldn't help (`vercel.app` is a public suffix). Limits moved to per-user (Vercel hides IPs).
15c. **Production issue you debugged?** → go-live: `redirect_uri_mismatch` (new callback not
    registered), then a 500 whose request id led to `invalid_client` in Render's logs (stale client
    secret) → new secret, redeploy, works. Logged M-33 (failed sign-in shows JSON).
15b. **Docker?** → production image (`backend/Dockerfile`, non-root, health check) built and
    checked in CI; `docker compose up` runs MongoDB + API + website locally with persistent data.
    Production on Render still runs Node directly.
16. **Debug production?** → request id in the header and error body → grep the JSON logs; with
    `SENTRY_DSN` every `log.error` (requests, route 500s, jobs, crashes) goes to Sentry from one
    hook in the logger; `/health` checks the DB.
17. **Is Insights ML?** → no: confidence-gated statistics + 13 rules. ML work-type classifier is
    designed, blocked on labelled data.
18. **Biggest remaining weakness?** → client-chosen timestamps (bounded, credited, but still
    trusted), no web refresh token, Render cold starts behind the proxy, no frontend tests.
19. **What would you do next?** → run the live migrations, publish extension 2.5.0, friendly
    OAuth-failure page (M-33), per-day stats for windowed boards, frontend tests.

---

## Things NOT to claim / traps

- The backend + website changes are deployed (2026-10-03). Don't say extension 2.5.0 features
  (outbox, Sign In, keychain) are live until it's published, or that the leaderboard reads
  running totals live until `backfill-userstats` has run.
- Don't call Insights AI/ML. Don't say the ML classifier exists.
- Don't quote "~10×"; quote the measured 5×/13× with the cadence, and say "local benchmark".
- Don't claim the leaderboard can't be gamed — it's bounded, not impossible.
- Don't claim frontend tests.
- Don't claim solo authorship — 3 contributors; you owned extension + backend.

---

## Sentences that make you sound senior

1. "I measure before I claim: the leaderboard went from 6.7 s to 62 ms at a million rows in a
   local benchmark, and bucketing turned out to save 5× documents, not the 10× I'd guessed."
2. "Keys are stored like GitHub tokens — an id for lookup and a hash of the secret — because a
   database leak shouldn't hand out working credentials."
3. "You can't make client telemetry unforgeable; you can bound it. Credited time is capped per
   window with an atomic counter, so the best a script can do is real time."
4. "Before refactoring the analytics I copied the old code into a test as an oracle and required
   identical output — that's how I found the weekly-window bug."
5. "My API tests all passed while the browser blocked every PATCH — CORS is part of the contract,
   so now a test sends real preflights."
