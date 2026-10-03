'use strict';

/**
 * Migrate activities.userId from hex String to ObjectId (roadmap item 10).
 * Driven by scripts/migrate-activity-userid.js; dry run unless apply=true.
 *
 * The one hard case: since the expand step, ingest writes ObjectId buckets, so
 * a window can hold BOTH a legacy String bucket and a new ObjectId bucket for
 * the same (user, project, language, bucketStart). Converting the String one
 * would violate the unique bucket index, so it is folded into the ObjectId
 * bucket instead (counters added, lists unioned) and then deleted.
 */
const mongoose = require('mongoose');

// Fields that identify the bucket or are not additive.
const SKIP = new Set([
  '_id', '__v', 'userId', 'projectName', 'language', 'bucketStart', 'timestamp',
  'fileName', 'fileType', 'createdAt', 'updatedAt', 'files', 'flowBlocksMs',
  'longestBlockMs', 'uniqueFiles', 'successRate', 'buildSuccessRate',
  'lastCommand', 'lastCommandTimestamp', 'repeatedFailedCommands',
  'uncommittedFiles', 'uncommittedAgeMs',
]);

/** Update that adds `doc` into another bucket document. Pure; unit-tested. */
function mergeIntoUpdate(doc) {
  const inc = {};
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (SKIP.has(k)) continue;
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'number' && Number.isFinite(v) && v !== 0) inc[path] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v._bsontype)) walk(v, path);
    }
  };
  walk(doc, '');
  const update = { $inc: inc };
  if (Array.isArray(doc.files) && doc.files.length) update.$addToSet = { files: { $each: doc.files } };
  const blocks = doc.focusAnalytics && doc.focusAnalytics.flowBlocksMs;
  if (Array.isArray(blocks) && blocks.length) {
    update.$push = { 'focusAnalytics.flowBlocksMs': { $each: blocks, $slice: -200 } };
  }
  const longest = doc.focusAnalytics && doc.focusAnalytics.longestBlockMs;
  if (longest > 0) update.$max = { 'focusAnalytics.longestBlockMs': longest };
  return update;
}

async function migrateActivityUserIds({ apply = false } = {}) {
  const col = mongoose.connection.collection('activities');
  const strings = await col.countDocuments({ userId: { $type: 'string' } });
  const result = { strings, converted: 0, merged: 0, skipped: 0, apply };
  if (!apply) return result;

  for await (const doc of col.find({ userId: { $type: 'string' } })) {
    if (!/^[0-9a-f]{24}$/i.test(doc.userId)) { result.skipped += 1; continue; }
    const oid = new mongoose.Types.ObjectId(doc.userId);
    try {
      await col.updateOne({ _id: doc._id, userId: doc.userId }, { $set: { userId: oid } });
      result.converted += 1;
    } catch (err) {
      if (!(err && err.code === 11000)) throw err;
      await col.updateOne(
        { userId: oid, projectName: doc.projectName, language: doc.language, bucketStart: doc.bucketStart },
        mergeIntoUpdate(doc),
      );
      await col.deleteOne({ _id: doc._id });
      result.merged += 1;
    }
  }
  result.remaining = await col.countDocuments({ userId: { $type: 'string' } });
  return result;
}

module.exports = { mergeIntoUpdate, migrateActivityUserIds };
