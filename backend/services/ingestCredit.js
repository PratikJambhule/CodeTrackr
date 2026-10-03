'use strict';

/**
 * Anti-cheat planning for ingest (roadmap item 5, closes H-21). Pure: no I/O.
 *
 * Leaderboards rank by summed `duration`, and the client says how long it
 * coded. Three limits bound how much a scripted client can claim:
 *
 *  1. Corroboration: an upload is credited at most its window-focus time plus
 *     a 120 s grace. The grace covers honest gaps: activity keeps counting for
 *     up to 2 minutes after the editor loses focus, before the idle pause.
 *  2. Window cap: at most 600 s per user per 10-minute window, summed across
 *     every project and language. Enforced with an atomic counter, so two
 *     concurrent uploads cannot both fill the same window.
 *  3. Spreading: a long upload (e.g. after being offline) is split across the
 *     windows it actually covers, so a legitimate hour is credited in full
 *     instead of being cut to 600 s.
 *
 * None of this makes a scripted client impossible (it can fake focus time and
 * pace itself), but it caps the damage at real-time speed: one hour of
 * leaderboard credit costs one hour of wall clock.
 */

const BUCKET_MS = 600000;
const WINDOW_CAP_SECONDS = 600;
const FOCUS_GRACE_SECONDS = 120;

/**
 * Split `seconds` of activity starting at `startMs` into 10-minute windows.
 * A span that would end in the future is shifted back to end at `nowMs`.
 * Returns [{ bucketStart: Date, seconds: int }] whose seconds sum exactly to
 * Math.round(seconds).
 */
function spreadAcrossWindows(startMs, seconds, nowMs = Date.now(), bucketMs = BUCKET_MS) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return [];
  let start = Number(startMs);
  if (!Number.isFinite(start)) start = nowMs - total * 1000;
  if (start + total * 1000 > nowMs) start = nowMs - total * 1000;

  const out = [];
  let cursor = start;
  let remaining = total;
  while (remaining > 0) {
    const bucketStart = Math.floor(cursor / bucketMs) * bucketMs;
    const room = Math.max(1, Math.round((bucketStart + bucketMs - cursor) / 1000));
    const take = Math.min(remaining, room);
    out.push({ bucketStart: new Date(bucketStart), seconds: take });
    remaining -= take;
    cursor = bucketStart + bucketMs;
  }
  return out;
}

/** Seconds of an upload that window-focus time can vouch for. */
function corroboratedSeconds(duration, focusAnalytics) {
  const d = Math.max(0, Number(duration) || 0);
  const focusedSec = Math.max(0, Number(focusAnalytics && focusAnalytics.focusedMs) || 0) / 1000;
  return Math.min(d, Math.round(focusedSec) + FOCUS_GRACE_SECONDS);
}

/**
 * Credit for one increment of `added` seconds, given the counter's value
 * AFTER the atomic $inc. Only the part that still fit under the cap counts.
 */
function creditFromCounter(added, totalAfter, cap = WINDOW_CAP_SECONDS) {
  const before = totalAfter - added;
  return Math.max(0, Math.min(added, cap - before));
}

module.exports = {
  spreadAcrossWindows, corroboratedSeconds, creditFromCounter,
  WINDOW_CAP_SECONDS, FOCUS_GRACE_SECONDS,
};
