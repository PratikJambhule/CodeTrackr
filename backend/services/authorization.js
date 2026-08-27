/**
 * Authorization helpers.
 *
 * Dependency-free (no express, no mongoose) so they unit test without
 * installing or booting the server.
 *
 * Activity.userId is a String while Goal/GroupMember userId are ObjectIds,
 * so every comparison normalises through toString().
 */

/** Null-safe identity comparison across String/ObjectId forms. */
function sameUser(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return String(a) === String(b);
}

/**
 * Decide whether the session user may read `requestedId`'s data.
 * A falsy requestedId means "my own data" — routes may drop the param.
 */
function assertOwnership(requestedId, sessionUserId) {
    if (!sessionUserId) {
        return { ok: false, status: 401, message: 'Unauthorized' };
    }
    if (!requestedId) {
        return { ok: true };
    }
    if (!sameUser(requestedId, sessionUserId)) {
        // 403 not 404: the caller is authenticated, just not entitled.
        return { ok: false, status: 403, message: 'You may only access your own data' };
    }
    return { ok: true };
}

/**
 * AUTH_BYPASS disables all authentication and attaches the most active real
 * user. That must never be reachable in production, whatever the env says.
 */
function isBypassAllowed(env = process.env) {
    return env.AUTH_BYPASS === 'true' && env.NODE_ENV !== 'production';
}

module.exports = { sameUser, assertOwnership, isBypassAllowed };
