# Benchmarks

Measured, not estimated. Every number here comes from a script in `backend/bench/` and the raw
JSON it wrote next to it. All runs: one Windows laptop (12 logical cores, 15.7 GB RAM),
in-memory MongoDB 7 (`mongodb-memory-server`, WiredTiger cache capped at 1 GB), the real
`app.js`, and `autocannon` with 10 connections, all on the same machine. **Use them to compare
two code paths on identical data, not as production latency** (production adds network, a free
Render instance and Atlas).

## Leaderboard: full scan vs running totals (roadmap item 14) — 2026-10-03

`node bench/leaderboard.bench.js 1000000 1000 20` → `bench/leaderboard-2026-10-03-1000000.json`

Data: 1,000 users, **1,000,000 activity documents**, all-time leaderboard (`GET /api/leaderboard`),
20 s per path.

| Path | Requests in 20 s | Throughput | p50 | p90 | p97.5 | p99 |
|---|---|---|---|---|---|---|
| Old: aggregate every activity + load every user | 25 | 1.3 req/s | 6,720 ms | 6,922 ms | 7,172 ms | 7,172 ms |
| New: `userstats` running totals | 3,113 | 155.7 req/s | 62 ms | 82 ms | 96 ms | 111 ms |

- **Median latency 6.72 s → 62 ms (~108× lower); throughput ~120× higher.**
- Rebuilding `userstats` from the 1M documents (`rebuildAll`, the backfill) took **8.7 s**.
- The old path's latency includes queueing: with 10 concurrent clients each request waits for
  the scans ahead of it. That is exactly what happens to a slow endpoint under load.
- autocannon reports p50/p90/p97.5/p99, not p95, so p95 is not quoted.
- A small run (20k rows, 200 users) showed the same direction: 160 ms → 70 ms p50.

**Resume line this supports:** "replaced a full-collection leaderboard scan with write-time
running totals, cutting median latency from 6.7 s to 62 ms at 1M activity rows (local benchmark)".

## Ingest: bucketing on vs off (roadmap item 15) — 2026-10-03

`node bench/ingest.bench.js` → `bench/ingest-2026-10-03.json`. Each mode runs in its own process
(`ACTIVITY_BUCKET_MS=0` = legacy one document per upload; `600000` = 10-minute buckets).

**Throughput** — autocannon, 10 connections, 15 s, `POST /api/extension/track`:

| Mode | Requests | Throughput | p50 | p90 | p99 |
|---|---|---|---|---|---|
| Legacy (insert per upload) | 6,121 | 408 req/s | 23 ms | 28 ms | 39 ms |
| Bucketed (`$inc` upsert + window counter + stats) | 6,875 | 458 req/s | 20 ms | 25 ms | 40 ms |

Bucketing does more work per request (window counter, `userstats`, the bucket upsert) yet is not
slower: an update to an existing small document is cheaper than growing the collection and its
indexes. Treat the two as equal within noise.

**Storage** — 10 users each replay an 8-hour coding day:

| Upload cadence | Uploads | Legacy docs | Bucketed docs | Docs saved | Legacy bytes | Bucketed bytes | Bytes saved |
|---|---|---|---|---|---|---|---|
| every 2 min (extension ≥ 2.3.0) | 2,400 | 2,400 | 492 | **4.9×** | 3.02 MB | 0.24 MB | **12.7×** |
| every 30 s (extension < 2.3.0) | 9,600 | 9,600 | 490 | **19.6×** | 12.07 MB | 0.24 MB | **50.8×** |

- Bucketed storage is flat (~490 documents = 10 users × 48 ten-minute windows, plus boundaries)
  whatever the upload rate; legacy grows linearly with uploads.
- Bytes shrink more than documents because bucket documents are sparse (only non-zero counters
  are written) while legacy documents carried every field.
- **What this means for the old "~10× fewer writes" claim:** it was never measured. Measured:
  about **5× fewer documents** at today's 2-minute cadence and **~20×** versus the old 30-second
  cadence; **13×–51× less data**. Quote these, with the cadence.

**Resume line this supports:** "bucketed ingest stores ~5× fewer documents and 13× less data at
the extension's 2-minute upload cadence (20× / 51× vs the old 30-second cadence) with no
throughput cost (local benchmark)".
