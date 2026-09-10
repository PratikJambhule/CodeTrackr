/**
 * Safe construction of MongoDB regex queries from user-supplied text.
 *
 * Dependency-free (no express, no mongoose) so it unit tests without booting
 * the server.
 *
 * Why this exists: `{ $regex: req.query.search }` hands the caller a regex
 * compiler. Beyond matching more than intended, a pattern like `(a+)+$`
 * backtracks catastrophically and pins the event loop -- a single unauthenticated
 * request can stall the whole process. Everything user-typed must go through
 * `escapeRegex` before it reaches a `$regex` / `new RegExp`.
 */

/** Neutralise every regex metacharacter so the value matches literally. */
function escapeRegex(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Longest search term we will build a query from. Mongo has to scan with it,
 * and nobody legitimately searches for a 200-character group name.
 */
const MAX_TERM_LENGTH = 128;

/**
 * Case-insensitive "contains" matcher for a free-text search box.
 * Returns null when the term is empty or unusable, so callers can omit the
 * clause entirely rather than matching everything.
 */
function containsRegex(term) {
    if (term === null || term === undefined) return null;
    const trimmed = String(term).trim().slice(0, MAX_TERM_LENGTH);
    if (!trimmed) return null;
    return new RegExp(escapeRegex(trimmed), 'i');
}

/** Case-insensitive whole-string matcher (anchored both ends). */
function exactRegex(term) {
    if (term === null || term === undefined) return null;
    const trimmed = String(term).trim().slice(0, MAX_TERM_LENGTH);
    if (!trimmed) return null;
    return new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
}

module.exports = { escapeRegex, containsRegex, exactRegex, MAX_TERM_LENGTH };
