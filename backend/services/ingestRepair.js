/**
 * Repairs after the stale-index 500s (2026-10-22), used by scripts/repair-ingest.js.
 *
 * The live `activities` collection had a unique index the code never declared,
 * { userId, day, source, fileKey, hour, timestamp }. Buckets have none of those fields, so it
 * meant "one bucket per user per window": a second language or project in the same 10 minutes
 * was refused, and every refused upload still claimed seconds in its window counter.
 *
 *   staleUniqueIndexes(live, declared)   unique indexes in the database but not in the schema
 *   windowRepairs(usages, creditedByKey) window counters above the seconds actually credited
 *
 * Pure: the script reads the database and applies the answers.
 */

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b); // field order matters in an index

/**
 * @param live      db.collection.indexes() output
 * @param declared  Model.schema.indexes(): [[keySpec, options], ...]
 */
function staleUniqueIndexes(live, declared) {
  return live.filter((ix) => ix.unique && ix.name !== '_id_' && !declared.some(([key]) => sameKey(key, ix.key)));
}

/**
 * A counter records seconds CLAIMED; credit is what fitted under 600 s. Resetting a counter to the
 * seconds really credited in that window keeps the guarantee (at most 600 s credited per window)
 * and undoes claims from uploads that were never stored. Counters are only ever lowered.
 *
 * @param usages         WindowUsage documents
 * @param creditedByKey  Map `${userId}|${bucketStart ISO}` -> seconds stored in that window's buckets
 */
function windowRepairs(usages, creditedByKey) {
  const out = [];
  for (const u of usages) {
    const credited = creditedByKey.get(`${u.userId}|${new Date(u.bucketStart).toISOString()}`) || 0;
    if (u.seconds > credited) out.push({ _id: u._id, userId: u.userId, bucketStart: u.bucketStart, from: u.seconds, to: credited });
  }
  return out;
}

module.exports = { staleUniqueIndexes, windowRepairs };
