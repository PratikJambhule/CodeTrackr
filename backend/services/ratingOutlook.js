'use strict';

/**
 * Rating outlook (D-63): a RANGE for a person's Codeforces rating 12 weeks from now.
 *
 * The model is three gradient-boosting regressors (10th, 50th and 90th percentile of the rating
 * change) trained in Python on ~37k Codeforces users (ml/train_rating_outlook.py) and exported as
 * plain trees to backend/ml/ratingOutlookModel.json. This file evaluates those trees, so there is no
 * Python in production. On 7,474 held-out people, 79.8% of real outcomes fell inside the 10–90% range.
 *
 * Inputs are the same 14 numbers the model was trained on, computed here from the person's contest
 * history and submissions exactly as ml/fetch_codeforces.js rowsFor() does (a test checks this).
 */
const fs = require('fs');
const path = require('path');

const MODEL_FILE = path.join(__dirname, '..', 'ml', 'ratingOutlookModel.json');
const DAY = 86400;
const WINDOW = 28 * DAY;
const MIN_CONTESTS = 6;       // the first contests are provisional; the model never saw them
const ACTIVE_WITHIN = 120 * DAY; // no contest for 4 months: nothing recent to forecast from

let cached;
function model() {
  if (!cached) cached = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
  return cached;
}

/** One tree: walk from the root; `<= threshold` goes left; a missing value follows `m`. */
function tree(t, x) {
  let i = 0;
  while (!t.leaf[i]) {
    const v = x[t.f[i]];
    i = v == null || Number.isNaN(v) ? (t.m[i] ? t.l[i] : t.r[i]) : (v <= t.t[i] ? t.l[i] : t.r[i]);
  }
  return t.v[i];
}

/** Pure: the three percentiles of the 12-week rating change for one feature object. */
function predict(features, m = model()) {
  const x = m.features.map((f) => (features[f] == null ? null : Number(features[f])));
  const out = {};
  for (const q of m.quantiles) {
    const part = m.models[String(q)];
    out[String(q)] = part.trees.reduce((sum, t) => sum + tree(t, x), part.baseline);
  }
  return out;
}

/**
 * Pure: the model's 14 inputs at time `nowSec`, from the Codeforces API's user.rating and
 * user.status answers. Same definitions as ml/fetch_codeforces.js rowsFor(): practice in the 28
 * days before `nowSec`, contests up to and including `nowSec`.
 */
function features(ratingHistory, submissions, nowSec) {
  const contests = ratingHistory.filter((r) => r.ratingUpdateTimeSeconds <= nowSec).sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds);
  if (!contests.length) return null;
  const last = contests[contests.length - 1];
  const prev = contests[contests.length - 2];
  const subs = submissions
    .map((s) => ({ t: s.creationTimeSeconds, ok: s.verdict === 'OK', key: `${s.problem.contestId}${s.problem.index}`, rating: s.problem.rating || null }))
    .sort((a, b) => a.t - b.t);
  const inWindow = (from, to) => subs.filter((s) => s.t >= from && s.t < to);
  const recent = inWindow(nowSec - WINDOW, nowSec);
  const before = inWindow(nowSec - 2 * WINDOW, nowSec - WINDOW);
  const solvedKeys = new Map();
  for (const s of recent) if (s.ok && !solvedKeys.has(s.key)) solvedKeys.set(s.key, s);
  const solved = [...solvedKeys.values()];
  const rated = solved.filter((s) => s.rating);
  const r = last.newRating;
  const share = (n, d) => (d ? n / d : 0);
  return {
    rating: r,
    prev_delta: last.newRating - last.oldRating,
    contests_so_far: contests.length,
    contests_60d: contests.filter((x) => x.ratingUpdateTimeSeconds > nowSec - 60 * DAY).length,
    days_since_prev_contest: prev ? Math.round((last.ratingUpdateTimeSeconds - prev.ratingUpdateTimeSeconds) / DAY) : 0,
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
}

/**
 * The outlook stored on a Codeforces account: the range in rating points, the "harder problems"
 * what-if, and why there is no outlook when there is none. `now` in ms.
 */
function outlook(ratingHistory, submissions, now = Date.now()) {
  const m = model();
  const nowSec = Math.floor(now / 1000);
  const base = { modelVersion: m.version, horizonDays: m.horizonDays, coverage: m.metrics.coverage_80, heldOutPeople: m.metrics.people_test };
  if (ratingHistory.length < MIN_CONTESTS) return { ...base, eligible: false, reason: `needs ${MIN_CONTESTS} rated contests (you have ${ratingHistory.length})` };
  const lastT = Math.max(...ratingHistory.map((r) => r.ratingUpdateTimeSeconds));
  if (lastT < nowSec - ACTIVE_WITHIN) return { ...base, eligible: false, reason: 'no rated contest in the last 4 months' };

  const f = features(ratingHistory, submissions, nowSec);
  const q = predict(f, m);
  // Three separate models can cross by a point or two; keep low <= middle <= high.
  const [lo, mid, hi] = [q['0.1'], q['0.5'], q['0.9']].sort((a, b) => a - b);
  const harder = predict({ ...f, hard_share: Math.min(1, f.hard_share + 0.25), easy_share: Math.max(0, f.easy_share - 0.25) }, m)['0.5'];
  const round = (v) => Math.round(v);
  return {
    ...base,
    eligible: true,
    asOf: new Date(now),
    rating: f.rating,
    change: { low: round(lo), mid: round(mid), high: round(hi) },
    range: { low: round(f.rating + lo), mid: round(f.rating + mid), high: round(f.rating + hi) },
    whatIfHarder: round(harder - mid),
    inputs: { solved28d: f.solved_28d, activeDays28d: f.active_days_28d, hardShare: Math.round(f.hard_share * 100) / 100, contests60d: f.contests_60d },
  };
}

module.exports = { predict, features, outlook, MIN_CONTESTS };
