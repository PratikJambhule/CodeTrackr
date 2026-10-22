'use strict';

/**
 * Remove command text already stored in `activities` (plan B5). Uploads from extension 2.5.0 and
 * older saved a short command ("g++ two_sum.cpp", "curl https://…") in
 * terminalAnalytics.lastCommand and repeatedFailedCommands[].command. This replaces each with its
 * kind ("compile", "other"), the same reduction ingest now applies (services/commandKinds.js).
 *
 * Dry run by default; { apply: true } writes. Idempotent: a second run finds nothing.
 */

const { COMMAND_KINDS, toKind, kindFailures } = require('./commandKinds');

const BATCH = 500;

/** Documents that still hold text in either field. */
const TEXT_FILTER = {
  $or: [
    { 'terminalAnalytics.lastCommand': { $exists: true, $nin: [...COMMAND_KINDS, 'unknown', null] } },
    { 'terminalAnalytics.repeatedFailedCommands': { $elemMatch: { command: { $nin: COMMAND_KINDS } } } },
  ],
};

async function scrubCommandText({ apply = false } = {}) {
  const Activity = require('../models/Activity');
  const withText = await Activity.countDocuments(TEXT_FILTER);
  if (!apply || withText === 0) return { withText, updated: 0, remaining: withText };

  let updated = 0;
  let ops = [];
  const flush = async () => {
    if (!ops.length) return;
    const r = await Activity.bulkWrite(ops, { ordered: false });
    updated += r.modifiedCount;
    ops = [];
  };
  const cursor = Activity.find(TEXT_FILTER)
    .select({ 'terminalAnalytics.lastCommand': 1, 'terminalAnalytics.repeatedFailedCommands': 1 })
    .lean().cursor();
  for await (const doc of cursor) {
    const t = doc.terminalAnalytics || {};
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: {
          'terminalAnalytics.lastCommand': toKind(t.lastCommand) || 'unknown',
          'terminalAnalytics.repeatedFailedCommands': kindFailures(t.repeatedFailedCommands),
        } },
      },
    });
    if (ops.length >= BATCH) await flush();
  }
  await flush();
  return { withText, updated, remaining: await Activity.countDocuments(TEXT_FILTER) };
}

module.exports = { scrubCommandText, TEXT_FILTER };
