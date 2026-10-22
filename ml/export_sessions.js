#!/usr/bin/env node
'use strict';
/**
 * Export labelled sessions for training (ML plan C-16). READ-ONLY: it only reads the `sessions`
 * collection. Run it from the backend folder so it finds the database settings:
 *
 *   cd backend && node ../ml/export_sessions.js [--version 3] [--out ../ml/data/real_sessions_v3.csv]
 *
 * Then train: python ml/train_work_type.py --data ml/data/real_sessions_v3.csv
 * The CSV holds numbers and labels only, with a random id per person (new on every export).
 */
const path = require('path');
const fs = require('fs');

const backend = path.resolve(process.cwd());
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env'), quiet: true });
const mongoose = require(path.join(backend, 'node_modules', 'mongoose'));
const { exportRows, toCsv } = require(path.join(backend, 'services', 'sessionExport'));

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const VERSION = Number(arg('version', 3));
const OUT = path.resolve(arg('out', path.join(__dirname, 'data', `real_sessions_v${VERSION}.csv`)));

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set (run from the backend folder)');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const sessions = await mongoose.connection.db.collection('sessions')
    .find({ featureVersion: VERSION, $or: [{ 'userLabel.type': { $exists: true } }, { 'pickerLabel.type': { $exists: true } }] })
    .project({ userId: 1, durationSec: 1, featureVersion: 1, features: 1, workType: 1, userLabel: 1, pickerLabel: 1 })
    .toArray();
  const out = exportRows(sessions, { version: VERSION });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, toCsv(out));
  const people = new Set(out.rows.map((r) => r.personId)).size;
  const blind = out.rows.filter((r) => r.blind).length;
  console.log(JSON.stringify({ version: VERSION, labelledSessions: out.rows.length, people, blindOrPicker: blind, file: OUT }));
  console.log('Gate needs about 300 labels from 10+ people, at least 30 per work type (ML plan §15).');
  await mongoose.disconnect();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
