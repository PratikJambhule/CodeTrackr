'use strict';

/**
 * Payload v3 time parts on the server (plan B1–B3). Pure.
 *
 * Extension 2.6.0 splits each upload's `duration` into writing / reading / running seconds and into
 * per-file time (`perFile`). This module checks those parts, splits the CREDITED time across the
 * 10-minute windows an upload covers (scaling every part down when credit < claimed, so the parts
 * always add up to what was credited), and builds the bucket update.
 *
 * Uploads from 2.5.0 have no parts: everything here then returns null / nothing, and ingest behaves
 * exactly as before.
 */

const KIND_KEYS = ['writingSec', 'readingSec', 'runningSec'];
const FILE_TIME = ['seconds', 'writing', 'reading', 'running'];
const MAX_FILES = 30;
const MAX_NAME = 255;
const MAX_LANGUAGE = 64;
const MAX_SECONDS = 3600;
const MAX_LINES = 100000;
const TOLERANCE = 2; // seconds: whole-second rounding on the client
const OTHER_FILES = '(other files)'; // the extension's overflow row; not a real file

const isNum = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const toNum = (v) => (v === undefined || v === null ? 0 : typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const zeroKinds = () => ({ writingSec: 0, readingSec: 0, runningSec: 0 });

/**
 * Check the v3 parts of an upload whose duration is already validated.
 * @returns {{ errors: string[], value: { kinds: object|null, files: object[]|null } }}
 */
function validateTimeParts(body, duration) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = [];
  let kinds = null;
  let files = null;

  if (KIND_KEYS.some((k) => b[k] !== undefined && b[k] !== null)) {
    kinds = {};
    for (const k of KIND_KEYS) {
      const v = toNum(b[k]);
      if (!isNum(v, MAX_SECONDS)) errors.push(`${k} must be a number in [0, ${MAX_SECONDS}]`);
      kinds[k] = Math.round(Number(v) || 0);
    }
    const total = kinds.writingSec + kinds.readingSec + kinds.runningSec;
    if (!errors.length && Math.abs(total - duration) > TOLERANCE) {
      errors.push('writingSec + readingSec + runningSec must add up to duration');
    }
  }

  if (b.perFile !== undefined && b.perFile !== null) {
    if (!Array.isArray(b.perFile)) {
      errors.push('perFile, if present, must be an array');
    } else if (b.perFile.length > MAX_FILES) {
      errors.push(`perFile may have at most ${MAX_FILES} entries`);
    } else {
      const byName = new Map();
      b.perFile.forEach((e, i) => {
        if (!e || typeof e !== 'object') { errors.push(`perFile[${i}] must be an object`); return; }
        if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > MAX_NAME) {
          errors.push(`perFile[${i}].name must be a string of 1..${MAX_NAME} chars`); return;
        }
        if (/[\\/]/.test(e.name)) { errors.push(`perFile[${i}].name must be a base name, not a path`); return; }
        if (e.language !== undefined && e.language !== null && (typeof e.language !== 'string' || e.language.length > MAX_LANGUAGE)) {
          errors.push(`perFile[${i}].language must be a string of at most ${MAX_LANGUAGE} chars`); return;
        }
        const row = { name: e.name, language: e.language || 'unknown' };
        for (const k of FILE_TIME) {
          const v = toNum(e[k]);
          if (!isNum(v, MAX_SECONDS)) { errors.push(`perFile[${i}].${k} must be a number in [0, ${MAX_SECONDS}]`); return; }
          row[k] = Math.round(v);
        }
        for (const k of ['linesInserted', 'linesDeleted']) {
          const v = toNum(e[k]);
          if (!isNum(v, MAX_LINES)) { errors.push(`perFile[${i}].${k} must be a number in [0, ${MAX_LINES}]`); return; }
          row[k] = Math.round(v);
        }
        if (Math.abs(row.seconds - (row.writing + row.reading + row.running)) > TOLERANCE) {
          errors.push(`perFile[${i}].seconds must equal writing + reading + running`); return;
        }
        row.edited = !!e.edited;
        const cur = byName.get(row.name);
        if (!cur) { byName.set(row.name, row); return; }
        for (const k of [...FILE_TIME, 'linesInserted', 'linesDeleted']) cur[k] += row[k];
        cur.edited = cur.edited || row.edited;
        if (cur.language === 'unknown') cur.language = row.language;
      });
      if (!errors.length) {
        files = [...byName.values()].sort((x, y) => y.seconds - x.seconds || x.name.localeCompare(y.name));
        const total = files.reduce((a, f) => a + f.seconds, 0);
        if (Math.abs(total - duration) > TOLERANCE) errors.push('perFile seconds must add up to duration');
      }
    }
  }

  return { errors, value: { kinds: errors.length ? null : kinds, files: errors.length ? null : files } };
}

/** Whole numbers proportional to `values` that sum exactly to `total` (largest remainder). */
function largestRemainder(values, total) {
  const n = values.length;
  const out = new Array(n).fill(0);
  if (total <= 0 || n === 0) return out;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0) { out[0] = total; return out; }
  const exact = values.map((v) => (v / sum) * total);
  let left = total;
  exact.forEach((e, i) => { out[i] = Math.floor(e); left -= out[i]; });
  exact.map((e, i) => [e - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, left).forEach(([, i]) => { out[i] += 1; });
  return out;
}

/**
 * Split an upload's parts across the windows it was credited to.
 * @param parts    { kinds, files } from validateTimeParts (both null for an old extension)
 * @param credits  credited seconds per window, in order
 * @returns one { kinds, files } per window; each window's parts add up to its credit. Line counts
 *          (not time) stay with the first window.
 */
function splitParts(parts, credits) {
  const { kinds, files } = parts || {};
  return credits.map((credit, i) => {
    if (!kinds && !files) return { kinds: null, files: null };
    if (!(credit > 0)) return { kinds: zeroKinds(), files: [] };
    if (files && files.length) {
      const secs = largestRemainder(files.map((f) => f.seconds), credit);
      const rows = files.map((f, j) => {
        const [writing, reading, running] = largestRemainder([f.writing, f.reading, f.running], secs[j]);
        const first = i === 0;
        return { ...f, seconds: secs[j], writing, reading, running,
          linesInserted: first ? f.linesInserted : 0, linesDeleted: first ? f.linesDeleted : 0, edited: first && !!f.edited };
      }).filter((f) => f.seconds > 0 || f.linesInserted > 0 || f.linesDeleted > 0);
      return {
        kinds: {
          writingSec: rows.reduce((a, f) => a + f.writing, 0),
          readingSec: rows.reduce((a, f) => a + f.reading, 0),
          runningSec: rows.reduce((a, f) => a + f.running, 0),
        },
        files: rows,
      };
    }
    const k = kinds || zeroKinds();
    const [writingSec, readingSec, runningSec] = largestRemainder([k.writingSec, k.readingSec, k.runningSec], credit);
    return { kinds: { writingSec, readingSec, runningSec }, files: files ? [] : null };
  });
}

/** File names as Mongo field names: no "." and no leading "$". Reversible. */
function encodeFileKey(name) {
  return String(name).replace(/%/g, '%25').replace(/\./g, '%2E').replace(/\$/g, '%24');
}
function decodeFileKey(key) {
  return String(key).replace(/%2E/g, '.').replace(/%24/g, '$').replace(/%25/g, '%');
}

/** The bucket update for one window's parts: { $inc, $set, files (names for the files[] set) }. */
function timeInc(window) {
  const $inc = {};
  const $set = {};
  const names = [];
  const { kinds, files } = window || {};
  if (kinds) for (const k of KIND_KEYS) if (kinds[k] > 0) $inc[k] = kinds[k];
  for (const f of files || []) {
    const key = `fileTime.${encodeFileKey(f.name)}`;
    for (const k of [...FILE_TIME, 'linesInserted', 'linesDeleted']) if (f[k] > 0) $inc[`${key}.${k}`] = f[k];
    if (f.language && f.language !== 'unknown') $set[`${key}.language`] = f.language;
    if (f.name !== OTHER_FILES) names.push(f.name);
  }
  return { $inc, $set, files: names };
}

module.exports = { validateTimeParts, splitParts, timeInc, encodeFileKey, decodeFileKey, largestRemainder, KIND_KEYS, MAX_FILES, OTHER_FILES };
