/**
 * Shadow-mode report (decision D-56): scores the work-type model against the rules on people's own
 * picker and blind answers, and says whether the model has earned being switched on.
 *
 *   node scripts/shadow-report.js          # read-only; prints the report
 *   node scripts/shadow-report.js --json   # the same, as JSON
 *
 * Reads saved sessions only; it never writes.
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Session = require('../models/Session');
const { shadowReport } = require('../services/shadowReport');

const pct = (x) => `${Math.round(x * 100)}%`;

(async () => {
  if (!process.env.MONGO_URI) { console.error('MONGO_URI is not set.'); process.exit(1); }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const docs = await Session.find({ $or: [{ 'userLabel.type': { $exists: true } }, { 'pickerLabel.type': { $exists: true } }] })
    .select('userId workType modelGuess pickerLabel userLabel').lean();
  const r = shadowReport(docs);
  await mongoose.disconnect();

  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }
  console.log(`\nShadow model report — ${r.labels} answers (picker + blind) from ${r.people} people`);
  console.log(`Model version(s): ${r.modelVersions.join(', ') || 'none yet'}`);
  console.log(`Left out: ${r.skipped.shown} answered with the guess shown, ${r.skipped.noModelGuess} without a model guess (before 2.6.0)`);
  console.log('\n              accuracy  macro-F1  ' + Object.keys(r.model.recall).map((t) => t.padEnd(10)).join(''));
  for (const [name, s] of [['model', r.model], ['rules', r.rules]]) {
    console.log(`  ${name.padEnd(12)}${pct(s.accuracy).padEnd(10)}${String(s.macroF1).padEnd(10)}${Object.values(s.recall).map((x) => pct(x).padEnd(10)).join('')}`);
  }
  console.log('  answers per type: ' + Object.entries(r.perType).map(([t, n]) => `${t} ${n}`).join(', '));
  console.log(`\nVerdict: ${r.verdict.toUpperCase().replace(/_/g, ' ')}`);
  for (const reason of r.reasons) console.log(`  - ${reason}`);
  console.log('');
})().catch((err) => { console.error(err.message); process.exit(1); });
