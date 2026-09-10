const assert = require('assert');
const {
  sessionize, collapseByBucket, classify, featureVector, archetypeMix, BUCKET_MS,
} = require('../services/sessionize');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

const T0 = Date.UTC(2026, 8, 10, 9, 0, 0); // 09:00Z
const at = (min) => new Date(T0 + min * 60000);

/** A bucket document as ingest actually writes one. */
const doc = (minOffset, over = {}) => ({
  bucketStart: at(minOffset),
  timestamp: at(minOffset),
  duration: 600,
  projectName: over.projectName || 'app',
  language: over.language || 'typescript',
  editorAnalytics: {
    linesInserted: 0, linesDeleted: 0, churnLines: 0,
    readMs: 0, writeMs: 0, fileSwitches: 0, undoCount: 0,
    ...(over.editorAnalytics || {}),
  },
  focusAnalytics: { focusedMs: 0, blurEvents: 0, flowBlocksMs: [], ...(over.focusAnalytics || {}) },
  gitAnalytics: { commits: 0, filesChanged: 0, ...(over.gitAnalytics || {}) },
  terminalAnalytics: {
    totalCommands: 0, failedCommands: 0, terminalErrorCount: 0,
    buildRuns: 0, failedBuilds: 0, testRuns: 0, debuggingSessions: 0,
    ...(over.terminalAnalytics || {}),
  },
  ...(over.top || {}),
});

console.log('\ncollapseByBucket — several documents share one bucketStart');

check('collapses (project, language) variants of the same window into one slot', () => {
  // The bucket key is (userId, projectName, language, bucketStart), so working
  // across two languages in one 10-minute window writes TWO documents.
  const slots = collapseByBucket([
    doc(0, { language: 'typescript', editorAnalytics: { linesInserted: 10 } }),
    doc(0, { language: 'css', editorAnalytics: { linesInserted: 4 } }),
    doc(0, { projectName: 'docs', language: 'markdown', editorAnalytics: { linesInserted: 2 } }),
  ], BUCKET_MS);

  assert.strictEqual(slots.length, 1, 'one window -> one slot');
  assert.strictEqual(slots[0].linesInserted, 16);
  assert.strictEqual(slots[0].docCount, 3);
  assert.deepStrictEqual([...slots[0].languages].sort(), ['css', 'markdown', 'typescript']);
});

check('falls back to timestamp for legacy documents with no bucketStart', () => {
  const legacy = doc(0);
  delete legacy.bucketStart;
  legacy.timestamp = new Date(T0 + 3 * 60000); // 09:03, mid-bucket
  const slots = collapseByBucket([legacy], BUCKET_MS);
  assert.strictEqual(slots.length, 1);
  assert.strictEqual(slots[0].start, T0, 'floored onto the same 10-min grid');
});

check('ignores documents with an unparseable time', () => {
  const bad = doc(0);
  bad.bucketStart = 'not-a-date';
  bad.timestamp = undefined;
  assert.strictEqual(collapseByBucket([bad], BUCKET_MS).length, 0);
});

check('handles an empty or non-array input', () => {
  assert.deepStrictEqual(collapseByBucket([], BUCKET_MS), []);
  assert.deepStrictEqual(collapseByBucket(null, BUCKET_MS), []);
});

console.log('\nsessionize — gap splitting');

check('adjacent buckets stay in one session', () => {
  const s = sessionize([doc(0), doc(10), doc(20)]);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].bucketCount, 3);
  assert.strictEqual(s[0].spanMs, 30 * 60000);
});

check('a gap longer than the threshold starts a new session', () => {
  // 09:00-09:10, then nothing until 11:00
  const s = sessionize([doc(0), doc(120)]);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].startMs, T0);
  assert.strictEqual(s[1].startMs, T0 + 120 * 60000);
});

check('a gap shorter than the threshold does not split', () => {
  // 20-minute break, under the 30-minute default
  const s = sessionize([doc(0), doc(30)]);
  assert.strictEqual(s.length, 1);
});

check('the gap is measured from the END of the previous bucket', () => {
  // Starts 40 min apart, but the first bucket occupies 10 of those, so the real
  // break is exactly 30 min — at the threshold, so it must NOT split.
  assert.strictEqual(sessionize([doc(0), doc(40)]).length, 1);
  // The next grid point is 50 min: a 40-minute break, which does split.
  assert.strictEqual(sessionize([doc(0), doc(50)]).length, 2);
});

check('a mid-bucket timestamp is floored, so 41 min is still the 40-min bucket', () => {
  // Everything lands on the 10-minute grid; the gap threshold is therefore
  // only ever evaluated at grid resolution (+/- 10 min), as documented.
  assert.deepStrictEqual(
    sessionize([doc(0), doc(41)]).length,
    sessionize([doc(0), doc(40)]).length
  );
});

check('respects a custom gap', () => {
  assert.strictEqual(sessionize([doc(0), doc(30)], { gapMs: 5 * 60000 }).length, 2);
});

check('multi-language windows do not create phantom gaps', () => {
  // Regression: splitting before collapsing saw 6 "buckets" and could split.
  const docs = [];
  for (const m of [0, 10, 20]) {
    docs.push(doc(m, { language: 'typescript' }));
    docs.push(doc(m, { language: 'css' }));
  }
  const s = sessionize(docs);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].bucketCount, 3, 'three windows, not six');
});

check('aggregates counters and flow blocks across the session', () => {
  const s = sessionize([
    doc(0, {
      editorAnalytics: { linesInserted: 100, churnLines: 10, writeMs: 300000 },
      focusAnalytics: { flowBlocksMs: [30 * 60000] },
      gitAnalytics: { commits: 1 },
    }),
    doc(10, {
      editorAnalytics: { linesInserted: 50, churnLines: 5 },
      focusAnalytics: { flowBlocksMs: [5 * 60000] },
    }),
  ])[0];
  assert.strictEqual(s.linesInserted, 150);
  assert.strictEqual(s.churnLines, 15);
  assert.strictEqual(s.commits, 1);
  assert.strictEqual(s.durationSec, 1200);
  assert.deepStrictEqual(s.flowBlocksMs, [30 * 60000, 5 * 60000]);
  assert.strictEqual(s.deepBlockCount, 1);
  assert.strictEqual(s.longestBlockMs, 30 * 60000);
});

check('emits an empty list for no input', () => {
  assert.deepStrictEqual(sessionize([]), []);
  assert.deepStrictEqual(sessionize(null), []);
});

console.log('\nclassify — rule-based archetypes');

const sessionOf = (over) => {
  const base = {
    durationSec: 3600, linesInserted: 0, linesDeleted: 0, churnLines: 0,
    readMs: 0, writeMs: 0, fileSwitches: 0, flowBlocksMs: [], deepBlockCount: 0,
    commits: 0, totalCommands: 0, failedCommands: 0, terminalErrorCount: 0,
    buildRuns: 0, failedBuilds: 0, testRuns: 0, debuggingSessions: 0,
    ...over,
  };
  return { session: base, f: featureVector(base) };
};

check('deep build: sustained writing that survived, in long blocks', () => {
  const { session, f } = sessionOf({
    linesInserted: 300, churnLines: 20, writeMs: 3000000, readMs: 600000,
    flowBlocksMs: [40 * 60000], deepBlockCount: 1,
  });
  assert.strictEqual(classify(session, f).archetype, 'deep-build');
});

check('debug grind: failures with little surviving output', () => {
  const { session, f } = sessionOf({
    linesInserted: 15, churnLines: 10, buildRuns: 6, failedBuilds: 5,
    debuggingSessions: 2, totalCommands: 12, writeMs: 1200000, readMs: 2400000,
  });
  assert.strictEqual(classify(session, f).archetype, 'debug-grind');
});

check('admin/config: terminal-driven with almost no editing', () => {
  const { session, f } = sessionOf({
    linesInserted: 2, totalCommands: 25, readMs: 600000, writeMs: 60000,
  });
  assert.strictEqual(classify(session, f).archetype, 'admin-config');
});

check('exploration: reading and navigating rather than writing', () => {
  const { session, f } = sessionOf({
    linesInserted: 3, readMs: 3300000, writeMs: 300000, fileSwitches: 40,
  });
  assert.strictEqual(classify(session, f).archetype, 'exploration');
});

check('mixed when no single pattern dominates', () => {
  const { session, f } = sessionOf({
    linesInserted: 60, churnLines: 40, readMs: 1800000, writeMs: 1800000,
    fileSwitches: 5, totalCommands: 1,
  });
  assert.strictEqual(classify(session, f).archetype, 'mixed');
});

check('unclassified when there is too little activity to be honest', () => {
  const short = sessionOf({ durationSec: 120, linesInserted: 3 });
  assert.strictEqual(classify(short.session, short.f).archetype, 'unclassified');

  const silent = sessionOf({ durationSec: 3600 });
  assert.strictEqual(classify(silent.session, silent.f).archetype, 'unclassified');
});

check('every classification carries a human-readable reason', () => {
  const { session, f } = sessionOf({
    linesInserted: 300, churnLines: 20, writeMs: 3000000, deepBlockCount: 1,
    flowBlocksMs: [40 * 60000],
  });
  const r = classify(session, f);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

console.log('\nfeatureVector — persisted so clustering stays possible later');

check('ratios are bounded to [0,1]', () => {
  const { f } = sessionOf({
    linesInserted: 10, churnLines: 999, buildRuns: 1, failedBuilds: 99,
    totalCommands: 1, failedCommands: 99, readMs: 100, writeMs: 0,
  });
  for (const key of ['churnRatio', 'readRatio', 'buildFailRatio', 'commandFailRatio', 'deepShare']) {
    assert.ok(f[key] >= 0 && f[key] <= 1, `${key} = ${f[key]}`);
  }
});

check('rates are finite when the session has no duration', () => {
  const { f } = sessionOf({ durationSec: 0, linesInserted: 10, totalCommands: 5 });
  for (const [k, v] of Object.entries(f)) {
    assert.ok(Number.isFinite(v), `${k} = ${v}`);
  }
});

console.log('\narchetypeMix');

check('counts sessions and minutes per archetype', () => {
  const mix = archetypeMix([
    { archetype: 'deep-build', durationSec: 3600 },
    { archetype: 'deep-build', durationSec: 1800 },
    { archetype: 'debug-grind', durationSec: 900 },
  ]);
  assert.strictEqual(mix['deep-build'].sessions, 2);
  assert.strictEqual(mix['deep-build'].minutes, 90);
  assert.strictEqual(mix['debug-grind'].sessions, 1);
  assert.strictEqual(mix['exploration'].sessions, 0);
});

check('an unknown archetype falls into unclassified rather than throwing', () => {
  const mix = archetypeMix([{ archetype: 'nonsense', durationSec: 600 }]);
  assert.strictEqual(mix.unclassified.sessions, 1);
});

check('handles empty input', () => {
  const mix = archetypeMix([]);
  assert.strictEqual(mix['deep-build'].sessions, 0);
  assert.deepStrictEqual(archetypeMix(null)['mixed'], { sessions: 0, minutes: 0 });
});

console.log('\nend-to-end: a realistic working day');

check('splits a day into morning build / afternoon debug and labels both', () => {
  const docs = [
    // 09:00-09:40 — heads-down writing
    doc(0, { editorAnalytics: { linesInserted: 120, churnLines: 8, writeMs: 500000, readMs: 100000 },
             focusAnalytics: { flowBlocksMs: [35 * 60000] } }),
    doc(10, { editorAnalytics: { linesInserted: 90, churnLines: 5, writeMs: 500000, readMs: 100000 } }),
    doc(20, { editorAnalytics: { linesInserted: 80, churnLines: 6, writeMs: 500000, readMs: 100000 } }),
    doc(30, { editorAnalytics: { linesInserted: 70, churnLines: 4, writeMs: 500000, readMs: 100000 },
              gitAnalytics: { commits: 2 } }),
    // long lunch, then 13:00-13:30 fighting a build
    doc(240, { editorAnalytics: { linesInserted: 6, churnLines: 4, writeMs: 200000, readMs: 400000 },
               terminalAnalytics: { totalCommands: 9, buildRuns: 4, failedBuilds: 4, debuggingSessions: 1 } }),
    doc(250, { editorAnalytics: { linesInserted: 4, churnLines: 3, writeMs: 200000, readMs: 400000 },
               terminalAnalytics: { totalCommands: 7, buildRuns: 3, failedBuilds: 2 } }),
  ];

  const sessions = sessionize(docs);
  assert.strictEqual(sessions.length, 2, 'lunch split the day');
  assert.strictEqual(sessions[0].archetype, 'deep-build');
  assert.strictEqual(sessions[1].archetype, 'debug-grind');
  assert.strictEqual(sessions[0].commits, 2);

  const mix = archetypeMix(sessions);
  assert.strictEqual(mix['deep-build'].sessions, 1);
  assert.strictEqual(mix['debug-grind'].sessions, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
