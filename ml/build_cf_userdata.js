#!/usr/bin/env node
/**
 * Turn the Kaggle dataset "Codeforces User Practice and Rating History" (cf-userdata, Alex Li,
 * CC0, ~61k users collected Dec 2022 – Jan 2023) into the same training table as
 * fetch_codeforces.js, using the same tested feature builder (rowsFor).
 *
 *   node ml/build_cf_userdata.js --dir "C:/Users/you/Downloads/archive (9)" --limit 10000
 *   node ml/build_cf_userdata.js --dir "<folder>"                (all users)
 *   CF_HORIZON_DAYS=84 node ml/build_cf_userdata.js --dir "<folder>"
 *
 * The folder holds contests/<handle>.csv (updateTime, oldRating, newRating, rank),
 * submissions/<handle>.csv (… problemId, creationTime, …, verdict …) and problems.csv
 * (problemId, tags joined by "+", rating). Output: ml/data/cf_userdata_rows.csv
 */
const fs = require('fs');
const path = require('path');
const { rowsFor } = require('./fetch_codeforces');

const OUT = path.join(__dirname, 'data', 'cf_userdata_rows.csv');

/** Minimal CSV line parser: commas inside double quotes, and "" as an escaped quote. */
function parseLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** A CSV file as objects keyed by its header. Missing file → []. */
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = parseLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseLine(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

/** Pure: one person's two CSVs (as objects) → the shape rowsFor() expects. */
function toPerson(handle, contests, submissions, problems) {
  const rating = contests
    .map((c) => ({ t: Number(c.updateTime), oldRating: Number(c.oldRating), newRating: Number(c.newRating) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.newRating))
    .sort((a, b) => a.t - b.t);
  const subs = submissions
    .map((s) => {
      const p = problems.get(s.problemId) || { rating: null, tags: [] };
      return { t: Number(s.creationTime), ok: s.verdict === 'OK', key: s.problemId, rating: p.rating, tags: p.tags };
    })
    .filter((s) => Number.isFinite(s.t) && s.key);
  return { handle, rating, subs };
}

function seededShuffle(items, seed = 20261104) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dir = arg('--dir');
  if (!dir || !fs.existsSync(path.join(dir, 'contests'))) throw new Error('--dir must be the unzipped dataset folder (with contests/ and submissions/)');
  const limit = Number(arg('--limit')) || Infinity;

  const problems = new Map(readCsv(path.join(dir, 'problems.csv')).map((p) => [p.problemId, {
    rating: p.rating ? Number(p.rating) : null,
    tags: p.tags ? p.tags.split('+') : [],
  }]));
  const files = seededShuffle(fs.readdirSync(path.join(dir, 'contests')).filter((f) => f.endsWith('.csv'))).slice(0, limit);
  console.log(`${problems.size} problems; reading ${files.length} people`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.openSync(OUT, 'w');
  let cols = null;
  let rows = 0;
  let usable = 0;
  const started = Date.now();
  files.forEach((f, n) => {
    const handle = f.slice(0, -4);
    const person = toPerson(handle, readCsv(path.join(dir, 'contests', f)), readCsv(path.join(dir, 'submissions', f)), problems);
    const r = rowsFor(person);
    if (r.length) usable++;
    for (const row of r) {
      if (!cols) { cols = Object.keys(row); fs.writeSync(out, `${cols.join(',')}\n`); }
      fs.writeSync(out, `${cols.map((c) => (typeof row[c] === 'number' ? +row[c].toFixed(4) : `"${String(row[c]).replace(/"/g, '""')}"`)).join(',')}\n`);
      rows++;
    }
    if ((n + 1) % 5000 === 0) console.log(`  ${n + 1}/${files.length} people, ${rows} rows, ${Math.round((Date.now() - started) / 1000)} s`);
  });
  fs.closeSync(out);
  console.log(`${rows} rows from ${usable} usable people (of ${files.length}) → ${path.relative(process.cwd(), OUT)} in ${Math.round((Date.now() - started) / 1000)} s`);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = { parseLine, readCsv, toPerson };
