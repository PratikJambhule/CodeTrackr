/**
 * Analytics per kind of work (decision D-55): the numbers behind the DSA, Project work and
 * Learning & setup tabs on the Insights page. Each kind answers its own question:
 *   DSA             "am I practising well?"       problems, compile-and-run loops, failed compiles
 *   Project work    "is my project moving?"       projects, commits, files, debugging, builds, tests
 *   Learning/setup  "is setup eating my time?"    reading, docs, cloned repos, installs, config files
 *
 * Pure: it takes sessions from sessionize() plus their saved labels, and reads nothing else. Every
 * number comes from data the extension already sends; the 2.6.0 counts (command kinds, runs, debug,
 * reading, time per file) exist only for 2.6.0 sessions, so each tab says how many have that detail.
 */

const { isCodeFile, isConfigFile } = require('./fileNameHints');
const { GROUP_OF, NOT_ENOUGH, NOT_SURE } = require('./workType');
const { hasV3 } = require('./workTypeFeatures');

const DOC_FILE = /\.(md|markdown|txt|rst|adoc)$/i;
const TOP = 8;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (x) => Math.round(x * 100) / 100;
const ratio = (a, b) => (b > 0 ? round2(a / b) : 0);
const minutes = (sec) => Math.round(sec / 60);

/**
 * The kind of work a session counts as: your answer on Insights > the VS Code picker > the rules'
 * guess. A session asked blind and not answered yet "waits": counting it would reveal the hidden
 * guess. "Not sure" and "too short" sessions count in no group (null).
 */
function kindOf(s, doc, prompt) {
  const answer = doc && doc.userLabel && doc.userLabel.type;
  if (answer) return { type: answer, source: 'you' };
  if (s.pickerLabel && s.pickerLabel.type) return { type: s.pickerLabel.type, source: 'picker' };
  const guess = s.workType && s.workType.type;
  if (!guess || guess === NOT_ENOUGH || guess === NOT_SURE) return null;
  if (prompt === 'blind') return { waiting: true };
  return { type: guess, source: 'guess' };
}

/** Add seconds per name into a Map. */
function addSeconds(map, name, sec) {
  if (sec > 0) map.set(name, (map.get(name) || 0) + sec);
}
const topList = (map, n = TOP) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }));

function emptyCommon() {
  return { sessions: 0, confirmed: 0, durationSec: 0, detailSessions: 0, writingSec: 0, readingSec: 0, runningSec: 0 };
}

function addCommon(c, s, source) {
  c.sessions++;
  if (source !== 'guess') c.confirmed++;
  c.durationSec += num(s.durationSec);
  if (hasV3(s)) c.detailSessions++;
  c.writingSec += num(s.writingSec);
  c.readingSec += num(s.readingSec);
  c.runningSec += num(s.runningSec);
}

function common(c) {
  return {
    sessions: c.sessions, confirmed: c.confirmed, minutes: minutes(c.durationSec), detailSessions: c.detailSessions,
    split: { writingSec: Math.round(c.writingSec), readingSec: Math.round(c.readingSec), runningSec: Math.round(c.runningSec) },
  };
}

const kind = (s, key) => num(s.commandKinds && s.commandKinds[key]);
const failedKind = (s, key) => num(s.commandKinds && s.commandKinds.failed && s.commandKinds.failed[key]);
const run = (s, key) => num(s.runs && s.runs[key]);
const fileEntries = (s) => Object.entries(s.fileSec || {}).map(([name, f]) => [name, num(f && f.seconds)]);

/**
 * @param entries  [{ s, doc, prompt }]: a raw session, its saved Session document (or null) and
 *                 whether it is asked 'blind' or with a 'guess'
 * @param opts.timezoneOffset  minutes, as Date#getTimezoneOffset() gives (India: -330), for active days
 */
function typeAnalytics(entries, { timezoneOffset = 0 } = {}) {
  const offsetMs = num(timezoneOffset) * 60000;
  const acc = {
    dsa: { c: emptyCommon(), problems: new Map(), compiles: 0, failedCompiles: 0, runs: 0, days: new Set(), languages: new Map() },
    project_work: { c: emptyCommon(), projects: new Map(), commits: 0, lines: 0, files: new Map(),
      debug: { durationSec: 0, sessions: 0, breakpointStops: 0, steps: 0 }, builds: 0, failedBuilds: 0, tests: 0, failedTests: 0, runs: 0 },
    learning_setup: { c: emptyCommon(), learningSec: 0, setupSec: 0, docSec: 0, navigations: 0, openedNotEdited: 0,
      cloned: new Set(), installs: 0, failedInstalls: 0, config: new Set() },
  };
  let waiting = 0;
  let unsorted = 0;
  let totalSec = 0;

  for (const { s, doc, prompt } of entries) {
    const k = kindOf(s, doc, prompt);
    if (!k) { unsorted++; continue; }
    if (k.waiting) { waiting++; continue; }
    const group = GROUP_OF[k.type];
    if (!group) { unsorted++; continue; }
    const g = acc[group];
    addCommon(g.c, s, k.source);
    totalSec += num(s.durationSec);

    if (group === 'dsa') {
      for (const [name, sec] of fileEntries(s)) if (isCodeFile(name) && !isConfigFile(name)) addSeconds(g.problems, name, sec);
      g.compiles += kind(s, 'compile');
      g.failedCompiles += failedKind(s, 'compile');
      g.runs += kind(s, 'run') + run(s, 'codeRunner') + run(s, 'task') + run(s, 'debugNoDebug');
      g.days.add(new Date(num(s.startMs) - offsetMs).toISOString().slice(0, 10));
      for (const l of s.languages || []) g.languages.set(l, (g.languages.get(l) || 0) + 1);
    } else if (group === 'project_work') {
      // A session in two projects splits its time equally: buckets do not say which minute was where.
      const projects = (s.projects || []).length ? s.projects : ['(no project)'];
      for (const p of projects) addSeconds(g.projects, p, num(s.durationSec) / projects.length);
      g.commits += num(s.commits);
      g.lines += num(s.linesInserted);
      for (const [name, sec] of fileEntries(s)) addSeconds(g.files, name, sec);
      if (k.type === 'debugging') g.debug.durationSec += num(s.durationSec);
      g.debug.sessions += num(s.debug && s.debug.sessions);
      g.debug.breakpointStops += num(s.debug && s.debug.breakpointStops);
      g.debug.steps += num(s.debug && s.debug.steps);
      g.builds += kind(s, 'build') + kind(s, 'compile');
      g.failedBuilds += failedKind(s, 'build') + failedKind(s, 'compile');
      g.tests += kind(s, 'test');
      g.failedTests += failedKind(s, 'test');
      g.runs += kind(s, 'run') + run(s, 'codeRunner') + run(s, 'task') + run(s, 'debugNoDebug');
    } else {
      if (k.type === 'setup') g.setupSec += num(s.durationSec);
      else g.learningSec += num(s.durationSec);
      for (const [name, sec] of fileEntries(s)) if (DOC_FILE.test(name)) g.docSec += sec;
      g.navigations += num(s.reading && s.reading.navigations);
      g.openedNotEdited += num(s.reading && s.reading.filesOpenedNotEdited);
      if (s.workspace && s.workspace.clonedRecently) for (const p of s.projects || []) g.cloned.add(p);
      g.installs += kind(s, 'install') + kind(s, 'docker');
      g.failedInstalls += failedKind(s, 'install') + failedKind(s, 'docker');
      for (const f of s.files || []) if (isConfigFile(f)) g.config.add(f);
    }
  }

  const { dsa, project_work: pw, learning_setup: ls } = acc;
  const commitsHours = pw.c.durationSec / 3600;
  return {
    totalMinutes: minutes(totalSec),
    waiting,
    unsorted,
    groups: {
      dsa: {
        ...common(dsa.c),
        problems: topList(dsa.problems),
        problemCount: dsa.problems.size,
        compiles: dsa.compiles,
        failedCompiles: dsa.failedCompiles,
        runs: dsa.runs,
        runsPerProblem: ratio(dsa.compiles + dsa.runs, dsa.problems.size),
        activeDays: dsa.days.size,
        languages: [...dsa.languages].sort((a, b) => b[1] - a[1]).map(([name, sessions]) => ({ name, sessions })),
      },
      project_work: {
        ...common(pw.c),
        projects: [...pw.projects].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([name, sec]) => ({ name, minutes: minutes(sec) })),
        commits: pw.commits,
        commitsPerHour: commitsHours > 0 ? round2(pw.commits / commitsHours) : 0,
        linesWritten: pw.lines,
        topFiles: topList(pw.files, 5),
        debugging: { minutes: minutes(pw.debug.durationSec), sessions: pw.debug.sessions,
          breakpointStops: pw.debug.breakpointStops, steps: pw.debug.steps },
        builds: pw.builds,
        failedBuilds: pw.failedBuilds,
        tests: pw.tests,
        failedTests: pw.failedTests,
        runs: pw.runs,
      },
      learning_setup: {
        ...common(ls.c),
        learningMinutes: minutes(ls.learningSec),
        setupMinutes: minutes(ls.setupSec),
        docSec: Math.round(ls.docSec),
        navigations: ls.navigations,
        filesOpenedNotEdited: ls.openedNotEdited,
        clonedRepos: [...ls.cloned].slice(0, TOP),
        installs: ls.installs,
        failedInstalls: ls.failedInstalls,
        configFiles: [...ls.config].slice(0, TOP),
        setupShare: ratio(ls.setupSec, totalSec),
      },
    },
  };
}

module.exports = { kindOf, typeAnalytics };
