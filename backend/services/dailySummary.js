/**
 * Daily rollup — pure summary builder. Dependency-free.
 * Fed a day's worth of activity documents (bucketed and/or legacy per-flush),
 * returns a DailySummary-shaped plain object. No double counting.
 */
const { EDITOR_INC, TERMINAL_INC, DEEP_BLOCK_MS } = require('./activityBucket');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function accum(target, src, keys) {
  const s = src || {};
  for (const k of keys) target[k] = (target[k] || 0) + num(s[k]);
}

function buildDaySummary(userId, day, docs) {
  const list = Array.isArray(docs) ? docs : [];
  const summary = {
    userId,
    day,
    totalSeconds: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    flushCount: 0,
    bucketCount: list.length,
    languages: [],
    projects: [],
    editor: {},
    terminal: {},
    git: {},
    focus: { focusedMs: 0, blurredMs: 0, longestBlockMs: 0, deepBlockCount: 0, blockCount: 0 },
    rolledAt: new Date(),
  };

  const langSeconds = new Map();
  const projects = new Set();

  for (const d of list) {
    const dur = num(d.duration);
    summary.totalSeconds += dur;
    summary.totalLinesAdded += num(d.linesAdded);
    summary.totalLinesRemoved += num(d.linesRemoved);
    summary.flushCount += num(d.flushCount != null ? d.flushCount : 1);

    if (d.language) langSeconds.set(d.language, (langSeconds.get(d.language) || 0) + dur);
    if (d.projectName) projects.add(d.projectName);

    const f = d.focusAnalytics || {};
    summary.focus.focusedMs += num(f.focusedMs);
    summary.focus.blurredMs += num(f.blurredMs);
    summary.focus.longestBlockMs = Math.max(summary.focus.longestBlockMs, num(f.longestBlockMs));
    const blocks = Array.isArray(f.flowBlocksMs) ? f.flowBlocksMs : [];
    summary.focus.blockCount += blocks.length;
    summary.focus.deepBlockCount += blocks.filter((b) => num(b) >= DEEP_BLOCK_MS).length;

    accum(summary.editor, d.editorAnalytics, EDITOR_INC);
    accum(summary.terminal, d.terminalAnalytics, TERMINAL_INC);
    accum(summary.git, d.gitAnalytics, ['commits', 'filesChanged']);
  }

  summary.languages = [...langSeconds].map(([language, seconds]) => ({ language, seconds }));
  summary.projects = [...projects];
  return summary;
}

module.exports = { buildDaySummary };
