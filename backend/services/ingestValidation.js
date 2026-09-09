'use strict';

// Bounds for one ingest flush. `duration` is generous — a flush covers at most
// a few minutes of real coding time; 1 hour is already an outlier.
const MAX_DURATION = 3600;          // seconds
const FUTURE_SKEW_MS = 60 * 1000;   // tolerate 60s of client clock skew
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;
const MAX_FILENAME = 255;
const MAX_LANGUAGE = 64;
const MAX_PROJECT = 128;

function isBoundedString(v, max) {
  return typeof v === 'string' && v.trim().length >= 1 && v.length <= max;
}

/**
 * Bounds-check one ingest payload. Pure — no I/O, no throw.
 *
 * @param {object} body
 * @returns {{ok: true, value: {duration:number, fileName:string, language:string,
 *                              projectName?:string, timestamp?:string}}
 *        | {ok: false, errors: string[]}}
 */
function validateIngestPayload(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};

  const duration = Number(b.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) {
    errors.push(`duration must be a number in (0, ${MAX_DURATION}]`);
  }
  if (!isBoundedString(b.fileName, MAX_FILENAME)) {
    errors.push(`fileName must be a string of 1..${MAX_FILENAME} chars`);
  }
  if (!isBoundedString(b.language, MAX_LANGUAGE)) {
    errors.push(`language must be a string of 1..${MAX_LANGUAGE} chars`);
  }
  if (b.projectName !== undefined && b.projectName !== null && !isBoundedString(b.projectName, MAX_PROJECT)) {
    errors.push(`projectName, if present, must be a string of 1..${MAX_PROJECT} chars`);
  }

  if (b.timestamp !== undefined && b.timestamp !== null) {
    const t = new Date(b.timestamp).getTime();
    if (!Number.isFinite(t)) {
      errors.push('timestamp must be a parseable date');
    } else if (t > Date.now() + FUTURE_SKEW_MS) {
      errors.push('timestamp must not be in the future');
    } else if (t < Date.now() - MAX_BACKDATE_MS) {
      errors.push('timestamp must be within the last 24h');
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      duration,
      fileName: b.fileName,
      language: b.language,
      projectName: b.projectName,
      timestamp: b.timestamp,
    },
  };
}

module.exports = { validateIngestPayload, MAX_DURATION };
