#!/usr/bin/env node
/**
 * Build a training table for the contest-rating forecast from the official Codeforces API.
 *
 * Question: given a person's last 4 weeks of practice (how much, how hard, which topics, how often
 * submissions failed) and their rating so far, how much will their rating change over the next
 * 4 weeks? Codeforces is used because, unlike LeetCode, it publishes every submission (failed ones
 * too) with the problem's tags and difficulty, through an official public API.
 *
 *   node ml/fetch_codeforces.js                  300 people, ~25 min (the API allows 1 call / 2 s)
 *   node ml/fetch_codeforces.js --users 40       a quick check
 *   node ml/fetch_codeforces.js --build-only     rebuild the table from what was downloaded
 *   CF_HORIZON_DAYS=84 node ml/fetch_codeforces.js --build-only   predict 12 weeks ahead instead of 4
 *
 * Downloads are cached per person in ml/data/codeforces/raw/, so a stopped run resumes where it
 * left off. Output: ml/data/codeforces_rating_rows.csv. Public data only; no login.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://codeforces.com/api/';
const OUT = path.join(__dirname, 'data', 'codeforces');
const RAW = path.join(OUT, 'raw');
const CSV = path.join(__dirname, 'data', 'codeforces_rating_rows.csv');
const PAUSE_MS = 2100;
const DAY = 86400;
const WINDOW = 28 * DAY;      // practice window before a contest
const HORIZON = (Number(process.env.CF_HORIZON_DAYS) || 28) * DAY; // forecast horizon after it
const MIN_CONTESTS = 6;       // skip the first contests: new accounts' ratings are still provisional
const TAGS = ['dp', 'greedy', 'math', 'graphs', 'data structures', 'constructive algorithms', 'binary search',
  'strings', 'number theory', 'implementation', 'brute force', 'sortings', 'trees', 'dfs and similar', 'two pointers'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

/** One API call, at most one every 2.1 s, retrying when Codeforces says the call limit was hit. */
async function call(method, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(`${API}${method}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(60000) });
      const body = await res.json();
      if (body.status === 'OK') return body.result;
      if (/limit/i.test(body.comment || '')) { await sleep(5000 * (attempt + 1)); continue; }
      throw new Error(`${method}: ${body.comment}`);
    } catch (err) {
      if (attempt === 4 || /not found|should contain/i.test(err.message)) throw err;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error(`${method}: gave up`);
}

/** Seeded shuffle, so the same run picks the same people. */
function shuffle(items, seed = 20261104) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** People to download: from recent rated rounds, spread evenly over rating bands. */
async function pickHandles(n) {
  const contests = (await call('contest.list', { gym: 'false' }))
    .filter((c) => c.phase === 'FINISHED' && /Div\. [1234]|Educational/.test(c.name))
    .slice(0, 6);
  const seen = new Map();
  for (const c of contests) {
    for (const r of await call('contest.ratingChanges', { contestId: c.id })) {
      if (!seen.has(r.handle)) seen.set(r.handle, r.oldRating);
    }
    if (seen.size > n * 20) break;
  }
  const bands = new Map();
  for (const [handle, rating] of shuffle([...seen])) {
    const band = Math.min(Math.floor(rating / 300), 9);
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(handle);
  }
  const picked = [];
  for (let i = 0; picked.length < n && i < seen.size; i++) {
    for (const list of bands.values()) if (list[i] && picked.length < n) picked.push(list[i]);
  }
  return picked;
}

async function download(handle) {
  const file = path.join(RAW, `${handle}.json`);
  if (fs.existsSync(file)) return;
  const rating = await call('user.rating', { handle });
  const subs = rating.length >= MIN_CONTESTS + 1 ? await call('user.status', { handle, from: 1, count: 10000 }) : [];
  fs.writeFileSync(file, JSON.stringify({
    handle,
    rating: rating.map((r) => ({ contestId: r.contestId, t: r.ratingUpdateTimeSeconds, oldRating: r.oldRating, newRating: r.newRating })),
    subs: subs.map((s) => ({ t: s.creationTimeSeconds, ok: s.verdict === 'OK', key: `${s.problem.contestId}${s.problem.index}`, rating: s.problem.rating || null, tags: s.problem.tags || [] })),
  }));
}

/**
 * Pure: one row per (person, contest) with features from the 28 days BEFORE the contest's rating
 * update and the label from the 28 days AFTER it. Nothing after the contest leaks into the features.
 */
function rowsFor({ handle, rating, subs: unsorted }) {
  const rows = [];
  // Sorted once, then each window is found by binary search: scanning every submission for every
  // contest is too slow for people with 10,000 submissions (the 61k-user Kaggle set).
  const subs = [...unsorted].sort((a, b) => a.t - b.t);
  const firstAtOrAfter = (t) => {
    let lo = 0;
    let hi = subs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (subs[mid].t < t) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const inWindow = (from, to) => subs.slice(firstAtOrAfter(from), firstAtOrAfter(to));
  for (let i = MIN_CONTESTS - 1; i < rating.length; i++) {
    const now = rating[i];
    const after = rating.filter((r) => r.t > now.t && r.t <= now.t + HORIZON);
    if (!after.length) continue; // no contest within the horizon: nothing to predict
    const recent = inWindow(now.t - WINDOW, now.t);
    const before = inWindow(now.t - 2 * WINDOW, now.t - WINDOW);
    const solvedKeys = new Map();
    for (const s of recent) if (s.ok && !solvedKeys.has(s.key)) solvedKeys.set(s.key, s);
    const solved = [...solvedKeys.values()];
    const rated = solved.filter((s) => s.rating);
    const r = now.newRating;
    const share = (n, d) => (d ? n / d : 0);
    const row = {
      handle,
      t: now.t,
      rating: r,
      prev_delta: now.newRating - now.oldRating,
      contests_so_far: i + 1,
      contests_60d: rating.filter((x) => x.t <= now.t && x.t > now.t - 60 * DAY).length,
      days_since_prev_contest: i > 0 ? Math.round((now.t - rating[i - 1].t) / DAY) : 0,
      subs_28d: recent.length,
      solved_28d: solved.length,
      solved_prev_28d: new Set(before.filter((s) => s.ok).map((s) => s.key)).size,
      fail_ratio_28d: share(recent.filter((s) => !s.ok).length, recent.length),
      active_days_28d: new Set(recent.map((s) => Math.floor(s.t / DAY))).size,
      solved_rating_mean: rated.length ? Math.round(rated.reduce((a, s) => a + s.rating, 0) / rated.length) : 0,
      solved_rating_max: rated.length ? Math.max(...rated.map((s) => s.rating)) : 0,
      hard_share: share(rated.filter((s) => s.rating >= r + 100).length, rated.length),
      easy_share: share(rated.filter((s) => s.rating <= r - 300).length, rated.length),
    };
    for (const tag of TAGS) row[`tag_${tag.replace(/\W+/g, '_')}`] = share(solved.filter((s) => s.tags.includes(tag)).length, solved.length);
    row.future_contests = after.length;
    row.y_delta = after[after.length - 1].newRating - r;
    rows.push(row);
  }
  return rows;
}

function writeCsv(rows) {
  if (!rows.length) throw new Error('no rows: download more people');
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => (typeof r[c] === 'number' ? +r[c].toFixed(4) : `"${r[c]}"`)).join(','))];
  fs.writeFileSync(CSV, `${lines.join('\n')}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const n = Number(args[args.indexOf('--users') + 1]) || 300;
  fs.mkdirSync(RAW, { recursive: true });
  if (!args.includes('--build-only')) {
    const handles = await pickHandles(n);
    console.log(`downloading ${handles.length} people (cached ones are skipped), about ${Math.ceil(handles.length * 2 * PAUSE_MS / 60000)} min`);
    let done = 0;
    for (const h of handles) {
      try { await download(h); } catch (err) { console.log(`  skip ${h}: ${err.message}`); }
      if (++done % 10 === 0) console.log(`  ${done}/${handles.length}`);
    }
  }
  const rows = fs.readdirSync(RAW).flatMap((f) => rowsFor(JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'))));
  writeCsv(rows);
  console.log(`${rows.length} rows from ${new Set(rows.map((r) => r.handle)).size} people → ${path.relative(process.cwd(), CSV)}`);
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });

module.exports = { rowsFor, TAGS, WINDOW, HORIZON, MIN_CONTESTS };
