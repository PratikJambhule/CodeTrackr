'use strict';

/**
 * Parse the optional contest window for a group board (roadmap item 7):
 *   ?from=<ISO date>[&to=<ISO date>]
 * Pure; unit-tested in tests/boardWindow.test.js.
 *
 * `from` is floored to the 10-minute bucket grid, because bucketed activity is
 * stamped with its window start: an unfloored bound would drop the window the
 * contest starts in (the same bug as M-31 in goal progress).
 */
const { bucketStartFor } = require('./activityBucket');

const MAX_WINDOW_DAYS = 400; // matches the Activity TTL; beyond it there is no data

function parseDate(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseBoardWindow(query, now = new Date()) {
  const q = query || {};
  const hasFrom = q.from !== undefined;
  const hasTo = q.to !== undefined;
  if (!hasFrom && !hasTo) return { ok: true, from: null, to: null };
  if (!hasFrom) return { ok: false, error: 'to needs a from' };

  const fromRaw = parseDate(q.from);
  const to = hasTo ? parseDate(q.to) : new Date(now);
  if (!fromRaw || !to) return { ok: false, error: 'from and to must be ISO dates' };
  if (to <= fromRaw) return { ok: false, error: 'to must be after from' };
  if (to - fromRaw > MAX_WINDOW_DAYS * 864e5) {
    return { ok: false, error: `the window can be at most ${MAX_WINDOW_DAYS} days` };
  }
  return { ok: true, from: bucketStartFor(fromRaw), to };
}

module.exports = { parseBoardWindow, MAX_WINDOW_DAYS };
