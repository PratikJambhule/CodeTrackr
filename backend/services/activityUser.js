'use strict';

/**
 * activities.userId: String -> ObjectId, expand/contract (roadmap item 10, M-6).
 *
 *   expand   (now)  new writes store an ObjectId; every read matches BOTH forms
 *                   and every $group keys on the string form, so one user is
 *                   never split into two rows.
 *   migrate         scripts/migrate-activity-userid.js converts old strings
 *                   (dry run by default; merges a legacy bucket into the new one
 *                   when both exist for the same window).
 *   contract (later) once no strings remain, matchActivityUser can return the
 *                   ObjectId alone and the schema can become ObjectId.
 *
 * Why bother: with matching types, activities can $lookup users and joins stop
 * happening in Node; and a single type is what every other collection uses.
 */
const mongoose = require('mongoose');

/** The id as an ObjectId for writes, or the original string when it is not one (tests use 'u1'). */
function activityUserId(id) {
  const s = String(id);
  return mongoose.isValidObjectId(s) && /^[0-9a-f]{24}$/i.test(s) ? new mongoose.Types.ObjectId(s) : s;
}

/** Query value matching one user's activity in either form. */
function matchActivityUser(id) {
  const s = String(id);
  const oid = activityUserId(s);
  return typeof oid === 'string' ? s : { $in: [s, oid] };
}

/** Query value matching several users' activity in either form. */
function matchActivityUsers(ids) {
  const out = [];
  for (const id of ids) {
    const s = String(id);
    out.push(s);
    const oid = activityUserId(s);
    if (typeof oid !== 'string') out.push(oid);
  }
  return { $in: out };
}

/** $group key: the user as a string, whichever form the document holds. */
const USER_KEY = { $toString: '$userId' };

module.exports = { activityUserId, matchActivityUser, matchActivityUsers, USER_KEY };
