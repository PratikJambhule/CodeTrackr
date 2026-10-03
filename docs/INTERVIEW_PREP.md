# CodeTrackr — Interview Prep (short version)

The questions an interviewer is most likely to ask, with answers you can say out loud in under a
minute. Every claim here matches the code on 2026-10-04 (deployed 2026-10-03; extension 2.5.0 and
the live data migrations still pending). The long versions are in `docs/interview-preparation/`
(full guide, Q&A bank, cheat sheet).

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
The cost shows up in the relational parts: no foreign keys, so integrity lives in code; and
`userId` was a string on activities but an ObjectId elsewhere — I'm migrating it to ObjectId in
expand/contract style (reads accept both until a script converts the old rows). (D-01, D-23.)

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
Extension 2.5.0 writes every upload to a small outbox in VS Code's `globalState` before sending,
sends oldest first, and retries with the same `flushId`, so the server applies it once. Closing VS
Code loses nothing; items older than 24 h are pruned because the server would refuse them. The
old version merged held uploads into one, which filed time under the wrong project and dropped
anything over an hour (M-30). Honest status: 2.5.0 is built and tested, not yet published.

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
tagged with that id, so "error id abc123" leads straight to the request. With one environment
variable, every `log.error` also goes to Sentry, grouped and alerting. I first wired Sentry into the
error handler only, then noticed routes that send their own 500, background jobs and crashes
outside a request never got there; now the logger is the single hook, so nothing is missed and
the access line isn't double-reported. The image has a health check, and the deploy workflow waits for
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
throughput from 1.3 to 156 requests a second. Next would be the windowed boards (`?days=`, contest
weeks), which still aggregate activity rows; per-day stats rows would fix that.

**Q: Login didn't work on Safari. Why, and how did you fix it?**
The website and the API were on different sites (`vercel.app` and `onrender.com`), so the login
cookie was a third-party cookie, which Safari, Firefox and private windows block. I made the
browser see one site: Vercel forwards `/api` and `/auth` to the backend, and the site calls its own
address. Moving the backend to its own Vercel project wouldn't have helped — every `*.vercel.app`
is a separate site because `vercel.app` is a public suffix. A side effect I caught in the docs:
Vercel hides visitors' IPs from the backend, so I moved rate limits from per-IP to per-user.

**Q: Did anything go wrong when you deployed it?**
Two config errors on the live Google login. First `redirect_uri_mismatch`: the callback moved to the
website's address, and Google only accepts addresses registered on the OAuth client. Then a 500:
the error page showed a request id, the same id was on a Render log line saying `invalid_client`
— the client secret on Render was stale. I created a new secret, redeployed, and it worked. I also
logged that a failed sign-in should land on the login page, not show JSON (M-33).

**Q: And with a whole college on the same Wi-Fi?**
That used to break: every limit was per IP, so a campus behind one NAT shared about 25 sign-ins
per 15 minutes and 10 group joins (H-20). Now group join authenticates first and is limited per
user, analytics per login session, and `/auth` has only a high flood cap. The extension and
device-sign-in routes still see real IPs because the extension calls Render directly.

## Testing and process

**Q: How did you test it?**
Three layers, all in GitHub Actions on every push: 369 backend unit assertions in 26 plain
`node:assert` suites (logic refactored into pure functions), 36 integration tests that run the
real Express app over HTTP against an in-memory MongoDB (including real CORS preflights), and 70
extension assertions against the built bundle; plus the frontend build and a Docker health check.
The honest gap: no frontend tests. The integration suite paid off on its first run — it found the
goal-window bug (M-31).

**Q: What would you improve next?**
Run the live migrations and publish extension 2.5.0; make a failed sign-in land on the login page
(M-33); confirm Safari login and the cold start behind the proxy; per-day stats for the windowed
boards; frontend tests. Everything from my earlier list (H-19 to H-23, hashed keys, running
totals) is built.

## Numbers to know (and where they come from)

| Number | Source |
|---|---|
| unit 26 suites / 369; integration 36; extension 6 / 70 | `npm test`, `npm run test:int`, 2026-10-04 |
| leaderboard 6.72 s → 62 ms p50 at 1M rows | `bench/leaderboard.bench.js` (local) |
| ingest 4.9× fewer docs, 12.7× less data | `bench/ingest.bench.js` (local) |
| 10-minute buckets, 400-day TTL | `services/activityBucket.js`, `models/Activity.js` |
| 13 rules | `services/rulesEngine.js` |
| ~22 s cold start | measured on Render `/health`, 2026-09-16 |
| 35 accounts, 1 active sender | live database check, 2026-09-16 |
| `buildMetrics` 239 ms cold / 44 ms warm | measured 2026-09-10 |
