# CodeTrackr — Interview Prep (short version)

The questions an interviewer is most likely to ask, with answers you can say out loud in under a
minute. Every claim here matches the code on 2026-10-03. The long versions are in
`docs/interview-preparation/` (full guide, 1,270-line Q&A bank, cheat sheet).

**Rule for every answer:** say what is built and verified, and say "designed, not built" for
anything else. The ML plan in particular is **not built**.

---

## The project

**Q: What is CodeTrackr, in one breath?**
A VS Code extension records coding activity — time, language, project, edits, terminal commands
and whether they failed, commits — and sends a small summary every couple of minutes to an
Express/MongoDB backend. A React dashboard shows your stats, goals, a global leaderboard and
groups where friends compare hours and failure rates. It started as friendly competition in my
college friend group.

**Q: What was the hardest part?**
Making the numbers true. An audit found the extension silently discarded every failed upload,
the leaderboard's "commits" were really upload counts, goal progress was 60× too high, and one
cadence metric could only ever return 1. Each was a small code change; finding them meant
tracing the data from the editor event to the chart and asking what each number really measures.

## Design choices

**Q: Why MongoDB?**
The activity summary is a self-contained document whose shape keeps growing, and the main query
is "one user's documents in a time window, then aggregate". I did not need joins on that path.
The cost shows up in the relational parts: no foreign keys, and `userId` is a string on
activities but an ObjectId elsewhere, so joins happen in Node. (`DECISIONS.md` D-01.)

**Q: Did bucketing actually help? By how much?**
Measured, not guessed: replaying an 8-hour day for 10 users, the extension's 2-minute cadence
produced 2,400 documents without bucketing and 492 with it — about 5× fewer, and 13× less data
because bucket documents only store non-zero counters. Against the old 30-second cadence it is
~20× fewer documents. Throughput was the same (408 vs 458 req/s locally). I'd quote "~5× at the
current cadence", not the "~10×" I had guessed before measuring.

**Q: How do you stop the database growing with every upload?**
Bucket-on-write. Each upload does one atomic `$inc` upsert into a document for that user,
project, language and 10-minute window. A partial unique index makes concurrent upserts safe.
That turns every upload in a 10-minute window (up to about five at the current 2-minute
cadence, and many more under the old 30-second one) into one document while keeping every
counter exact. The cost: 10-minute
time resolution, and a resent upload double-counts inside its bucket. (D-04.)

**Q: How does the extension authenticate? Is that secure?**
An API key of the form `ct_<id>_<secret>` in a header. The server stores only the id and a SHA-256
of the secret: it finds the row by id and compares hashes with `timingSafeEqual`, so a database
leak gives out no working keys. The key is shown once when created, and the extension keeps it in
VS Code SecretStorage (the OS keychain). Why SHA-256 and not bcrypt: bcrypt protects guessable
passwords; a 256-bit random secret can't be guessed, so a fast hash is enough. Old keys still work
— they're looked up by their hash and converted on first use. Since then I also built device-code
sign-in (like `gh auth login`): VS Code shows a short code, you approve it on the website, and
that install gets its own ingest-only key that expires in a year and can be revoked on its own.
(D-02, D-17, D-24.)

**Q: Is the Insights page machine learning?**
No. It is medians, MAD and ratios over your own data, each with a confidence level; anything
without enough data shows "—". On top sits a 13-rule engine that says what stands out and shows
the numbers that triggered it. I chose that because there was one active user — nothing to train
on — and every number has to be explainable. (D-08.)

**Q: Then where would ML fit?**
I designed one place where it makes sense: classifying what kind of work a session was (DSA,
project, debugging, learning, setup) with logistic regression trained on one-tap labels from
users, evaluated on people it never saw, and shipped only if it beats the rules. It is **not
built**: it needs ~300 labelled sessions from 10+ people and today one person sends data. (D-13.)

## Failure cases

**Q: What happens when the user is offline?**
The extension keeps the unsent summary in memory and merges it into the next upload, so short
outages lose nothing. Known gaps: nothing is written to disk, so closing VS Code loses it; and
the merge is lossy (M-30) — merged time takes the newest project and timestamp, and if it adds up
to more than an hour the extension drops it as a suspected clock jump. The fix is a small
persisted queue of separate payloads.

**Q: Did you use Docker?**
Yes, in two ways. `backend/Dockerfile` builds a small production image (Node 20 Alpine,
production dependencies only, non-root user, a health check on `/health`), and CI builds it and
waits for it to report a connected database. For development, `docker compose up` starts MongoDB,
the API and the website together with demo data, and the database keeps its data between runs.
Production on Render still runs Node directly — I'd switch to the image only with a reason, like
moving off Render.

**Q: How would you debug a production error?**
Every request gets an id, returned as `X-Request-Id` and printed in the error body the user sees.
The server writes JSON log lines (one access line per request, plus the stack trace for a 5xx)
tagged with that id, so "error id abc123" leads straight to the request. Sentry can be switched on
with one environment variable. The image has a health check, and the deploy workflow waits for
`/health` to report the database connected.

**Q: What happens when MongoDB is down?**
The process keeps running; `GET /health` returns 503 so the platform can stop routing to it,
and each request fails through a central error handler that logs the full error with an id and
returns only `{ error, id }` to the client.

**Q: Can someone cheat the leaderboard?**
Not quickly any more. Ingest credits time instead of trusting it: an upload counts only as far as
window-focus time vouches for it (+120 s grace), and each user gets at most 600 s per 10-minute
window, enforced with an atomic `$inc` counter so two parallel requests can't both fill a window.
A long legitimate upload (after being offline) is spread over the windows it covers, so honest
time isn't cut. The raw claim is kept, so an inflated client is visible. Honest limit: a script
that fakes focus and paces itself can still earn an hour per real hour — client telemetry can't
be made unforgeable, only bounded. (D-19.)

**Q: Any bug you found that the tests did not?**
Two good ones. First, goal "Mark complete" and notification "mark as read" had never worked in a
browser: the API's CORS allow-list had no PATCH, so the browser's preflight blocked them, while
every API test passed because test clients don't send preflights. I found it when a new rename
button failed in the browser console, and it explains why production had zero completed goals.
Now a test sends real preflights (H-23). Second, the Dashboard's "today" was yesterday between
midnight and 5:30 AM in India, because the code took the UTC date and shifted it instead of
taking the local date (H-22); the "today" window had no test. Both are fixed with tests.

## Scaling

**Q: What breaks first with 10,000 users?**
It used to be the leaderboard: every request aggregated every activity document and loaded every
user (H-7). I replaced that with a per-user running-totals row updated with `$inc` on every write,
so the all-time board is three indexed reads (top N by time, plus the two maxima the scores divide
by), and a rebuild script reconciles drift — a test proves the rebuild equals the live totals.
Measured locally at 1M activity rows: median latency went from 6.7 s to 62 ms (p99 7.2 s → 111 ms),
throughput from 1.3 to 156 requests a second. Second, the older analytics routes load documents into Node
and sum them there (M-1); they should be pipelines like the metrics service.

**Q: Login didn't work on Safari. Why, and how did you fix it?**
The website and the API were on different sites (`vercel.app` and `onrender.com`), so the login
cookie was a third-party cookie, which Safari, Firefox and private windows block. I made the
browser see one site: Vercel forwards `/api` and `/auth` to the backend, and the site calls its own
address. Moving the backend to its own Vercel project wouldn't have helped — every `*.vercel.app`
is a separate site because `vercel.app` is a public suffix. A side effect I caught in the docs:
Vercel hides visitors' IPs from the backend, so I moved rate limits from per-IP to per-user.

**Q: And with a whole college on the same Wi-Fi?**
All rate limits are per IP, so a campus behind one NAT shares one budget: about 25 sign-ins per
15 minutes and 10 group joins (H-20). Join should be limited per user after authentication.
Separately, the login cookie is third-party because the frontend and API are on different
domains, which Safari and Firefox block (H-19); the fix is to proxy the API through the frontend's
domain.

## Testing and process

**Q: How did you test it?**
296 backend assertions in 18 plain `node:assert` suites and 52 for the extension, run in GitHub
Actions with the frontend build on every push. Most logic was refactored into pure functions so
it tests without a database. The honest gap: no frontend tests and nothing runs against a real
database or over HTTP; `supertest` plus an in-memory MongoDB is the next step.

**Q: What would you improve next?**
In order: fix H-22 and M-29 (small, user-visible), cap bucket duration (H-21), make login work on
every browser (H-19, H-20), hash the API key, then the leaderboard running totals.

## Numbers to know (and where they come from)

| Number | Source |
|---|---|
| unit 23 suites / 346; integration 35; extension 6 / 70 | `npm test`, `npm run test:int`, 2026-10-03 |
| leaderboard 6.72 s → 62 ms p50 at 1M rows | `bench/leaderboard.bench.js` (local) |
| ingest 4.9× fewer docs, 12.7× less data | `bench/ingest.bench.js` (local) |
| 10-minute buckets, 400-day TTL | `services/activityBucket.js`, `models/Activity.js` |
| 13 rules | `services/rulesEngine.js` |
| ~22 s cold start | measured on Render `/health`, 2026-09-16 |
| 35 accounts, 1 active sender | live database check, 2026-09-16 |
| `buildMetrics` 239 ms cold / 44 ms warm | measured 2026-09-10 |
