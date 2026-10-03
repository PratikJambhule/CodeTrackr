#!/usr/bin/env node
/**
 * One-off: replace every plaintext legacy `users.apiKey` with its SHA-256 in
 * `legacyApiKeyHash`, so no API key is stored in clear (roadmap item 3).
 * Existing extensions keep working: verifyApiKey looks legacy keys up by hash.
 * Without this script the same conversion happens lazily on each key's next use.
 *
 *   node scripts/migrate-hash-api-keys.js            # dry run (counts only)
 *   node scripts/migrate-hash-api-keys.js --apply    # operator action
 *
 * Also creates the new unique sparse indexes on
 * legacyApiKeyHash and apiKeyId.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { hashSecret } = require('../services/apiKeys');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const col = mongoose.connection.collection('users');

  const plaintext = await col.countDocuments({ apiKey: { $type: 'string' } });
  const hashedLegacy = await col.countDocuments({ legacyApiKeyHash: { $exists: true } });
  const newFormat = await col.countDocuments({ apiKeyId: { $exists: true } });
  console.log(`\nusers with a PLAINTEXT key      : ${plaintext}`);
  console.log(`users with a hashed legacy key  : ${hashedLegacy}`);
  console.log(`users with a new ct_ key        : ${newFormat}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to hash the plaintext keys.\n');
    await mongoose.disconnect();
    return;
  }

  await require('../models/user').createIndexes(); // create-only: never drops an index
  let done = 0;
  for await (const u of col.find({ apiKey: { $type: 'string' } }, { projection: { apiKey: 1 } })) {
    await col.updateOne(
      { _id: u._id, apiKey: u.apiKey },
      { $set: { legacyApiKeyHash: hashSecret(u.apiKey) }, $unset: { apiKey: '' } },
    );
    done += 1;
  }
  console.log(`hashed ${done} key(s); plaintext remaining: ${await col.countDocuments({ apiKey: { $type: 'string' } })}`);
  await mongoose.disconnect();
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
