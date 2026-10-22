'use strict';

/**
 * The 18 session attributes of the work-type classifier (ML plan §8, feature version 2). Pure.
 *
 * Input is one session's raw counts (what sessionize() adds up from the 10-minute buckets, plus the
 * file names and command categories). Output is 18 unit-free numbers in a FIXED order (FEATURES):
 * the trained model's weights are stored in this order, so never reorder, only append with a new
 * version. Size is deliberately not a feature (no total minutes, no total lines): the model must learn
 * what KIND of session it was, not how long.
 *
 * The same function computes features for the generated training data (ml/generate_synthetic.js) and,
 * later, for real sessions, so training and serving see exactly the same numbers.
 *
 * Feature version 3 (plan M1) uses the cleaner signals of extension 2.6.0: the writing / reading /
 * running split, command KINDS (compile vs install vs run), real debugging vs Run Without Debugging,
 * jumps, doc files and the kind of project. A session uses v3 when it has the 2.6.0 time split, else
 * v2. A model is trained for one version, so it only serves sessions of that version.
 */

const { fileNameHints } = require('./fileNameHints');

const FEATURE_VERSION = 2;
const DEEP_BLOCK_MS = 25 * 60000;

const FEATURES = [
  // how you write
  'linesPerMin', 'churnRatio', 'readRatio', 'pasteShare', 'switchesPerMin', 'filesTouched',
  // what you run
  'commandsPerMin', 'runShare', 'packageShare', 'commandFailRatio', 'buildFailRatio', 'testShare',
  // debug, git, focus
  'debugPerHour', 'commitsPerHour', 'deepShare',
  // file-name hints
  'problemFileShare', 'configFileShare', 'practiceFolder',
];

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const ratio = (a, b) => (b > 0 ? Math.min(1, a / b) : 0);
const round = (v) => Math.round(v * 1e6) / 1e6;

/**
 * @param s raw session: { durationSec, linesInserted, linesDeleted, churnLines, charsInserted,
 *   largeInsertChars, readMs, writeMs, fileSwitches, files[], projects[], totalCommands,
 *   failedCommands, commandUsage{gcc,java,python,npm,pip,docker,…}, buildRuns, failedBuilds,
 *   testRuns, debuggingSessions, commits, flowBlocksMs[] }
 * @returns { version, features: {18 numbers}, vector: [18 numbers in FEATURES order],
 *            meta: { activeMin, editVolume, totalCommands } }  meta is for the rules, not the model
 */
function sessionFeatures(s = {}) {
  const activeMin = num(s.durationSec) / 60;
  const hours = activeMin / 60;
  const inserted = num(s.linesInserted);
  const editVolume = inserted + num(s.linesDeleted);
  const attention = num(s.readMs) + num(s.writeMs);
  const commands = num(s.totalCommands);
  const usage = s.commandUsage || {};
  const runCmds = num(usage.gcc) + num(usage.java) + num(usage.python);
  const pkgCmds = num(usage.npm) + num(usage.pip) + num(usage.docker);
  const blocks = (s.flowBlocksMs || []).map(num).filter((b) => b > 0);
  const blockTotal = blocks.reduce((a, b) => a + b, 0);
  const files = [...new Set(s.files || [])];
  const hints = fileNameHints(files, s.projects || []);

  const features = {
    linesPerMin: activeMin > 0 ? editVolume / activeMin : 0,
    churnRatio: ratio(num(s.churnLines), inserted),
    readRatio: attention > 0 ? num(s.readMs) / attention : 0,
    pasteShare: ratio(num(s.largeInsertChars), num(s.charsInserted)),
    switchesPerMin: activeMin > 0 ? num(s.fileSwitches) / activeMin : 0,
    filesTouched: Math.min(10, files.length),
    commandsPerMin: activeMin > 0 ? commands / activeMin : 0,
    runShare: ratio(runCmds, commands),
    packageShare: ratio(pkgCmds, commands),
    commandFailRatio: ratio(num(s.failedCommands), commands),
    buildFailRatio: ratio(num(s.failedBuilds), num(s.buildRuns)),
    testShare: ratio(num(s.testRuns), commands),
    debugPerHour: hours > 0 ? num(s.debuggingSessions) / hours : 0,
    commitsPerHour: hours > 0 ? num(s.commits) / hours : 0,
    deepShare: blockTotal > 0 ? blocks.filter((b) => b >= DEEP_BLOCK_MS).reduce((a, b) => a + b, 0) / blockTotal : 0,
    problemFileShare: hints.problemFileShare,
    configFileShare: hints.configFileShare,
    practiceFolder: hints.practiceFolder,
  };
  for (const k of FEATURES) features[k] = round(features[k]);
  return {
    version: FEATURE_VERSION,
    features,
    vector: FEATURES.map((k) => features[k]),
    meta: { activeMin: round(activeMin), editVolume, totalCommands: commands },
  };
}

// ---------------------------------------------------------------- feature version 3

const FEATURES_V3 = [
  // how you work
  'writingShare', 'readingShare', 'runningShare', 'linesPerMin', 'churnRatio', 'pasteShare',
  'switchesPerMin', 'navigationsPerMin', 'filesTouched', 'topFileShare', 'openedNotEditedShare', 'filesCreated',
  // what you run (command kinds + runs outside the terminal)
  'commandsPerMin', 'compileShare', 'installShare', 'runShare', 'testShare', 'commandFailRatio', 'buildFailRatio',
  // debugging, git, focus
  'realDebugPerHour', 'noDebugRunsPerHour', 'commitsPerHour', 'deepShare',
  // names
  'problemFileShare', 'configFileShare', 'docFileShare', 'practiceFolder',
  // the kind of project
  'hasPackageJson', 'hasRequirements', 'hasGit', 'ownCommits', 'clonedRecently', 'projectSize',
];
const SIZE_BUCKETS = ['0', '1', '2-5', '6-20', '21-100', '101-500', '500+'];
const DOC_FILE = /\.(md|markdown|txt|rst|adoc)$/i;
const KIND_KEYS = ['install', 'run', 'compile', 'build', 'test', 'git', 'docker', 'other'];

/** True when a raw session carries the extension 2.6.0 time split (so v3 can be computed). */
function hasV3(s) {
  return num(s && s.writingSec) + num(s && s.readingSec) + num(s && s.runningSec) > 0;
}

function sessionFeaturesV3(s = {}) {
  const v2 = sessionFeatures(s).features;
  const activeMin = num(s.durationSec) / 60;
  const hours = activeMin / 60;
  const parts = num(s.writingSec) + num(s.readingSec) + num(s.runningSec);
  const kinds = s.commandKinds || {};
  const failed = kinds.failed || {};
  const k = (key) => num(kinds[key]);
  const kindTotal = KIND_KEYS.reduce((a, key) => a + k(key), 0);
  const runs = s.runs || {};
  const outsideRuns = num(runs.task) + num(runs.codeRunner) + num(runs.debugNoDebug);
  const runDen = kindTotal + outsideRuns;
  const builds = k('build') + k('compile');
  const fileSec = s.fileSec || {};
  const fileTotal = Object.values(fileSec).reduce((a, f) => a + num(f && f.seconds), 0);
  const topFile = Object.values(fileSec).reduce((m, f) => Math.max(m, num(f && f.seconds)), 0);
  const docSec = Object.entries(fileSec).reduce((a, [name, f]) => a + (DOC_FILE.test(name) ? num(f && f.seconds) : 0), 0);
  const files = [...new Set(s.files || [])];
  const ws = s.workspace || {};
  const reading = s.reading || {};
  const debug = s.debug || {};
  const sizeIx = SIZE_BUCKETS.indexOf(ws.sourceFilesBucket);

  const features = {
    writingShare: ratio(num(s.writingSec), parts),
    readingShare: ratio(num(s.readingSec), parts),
    runningShare: ratio(num(s.runningSec), parts),
    linesPerMin: v2.linesPerMin,
    churnRatio: v2.churnRatio,
    pasteShare: v2.pasteShare,
    switchesPerMin: v2.switchesPerMin,
    navigationsPerMin: activeMin > 0 ? num(reading.navigations) / activeMin : 0,
    filesTouched: v2.filesTouched,
    topFileShare: ratio(topFile, fileTotal),
    openedNotEditedShare: ratio(num(reading.filesOpenedNotEdited), files.length),
    filesCreated: Math.min(10, num(s.filesCreated)),
    commandsPerMin: activeMin > 0 ? (kindTotal || num(s.totalCommands)) / activeMin : 0,
    compileShare: ratio(k('compile'), runDen),
    installShare: ratio(k('install') + k('docker'), runDen),
    runShare: ratio(k('run') + outsideRuns, runDen),
    testShare: ratio(k('test'), runDen),
    commandFailRatio: v2.commandFailRatio,
    buildFailRatio: builds > 0 ? ratio(num(failed.build) + num(failed.compile), builds) : v2.buildFailRatio,
    realDebugPerHour: hours > 0 ? num(debug.sessions) / hours : 0,
    noDebugRunsPerHour: hours > 0 ? num(runs.debugNoDebug) / hours : 0,
    commitsPerHour: v2.commitsPerHour,
    deepShare: v2.deepShare,
    problemFileShare: v2.problemFileShare,
    configFileShare: v2.configFileShare,
    docFileShare: ratio(docSec, fileTotal),
    practiceFolder: v2.practiceFolder,
    hasPackageJson: ws.hasPackageJson === true ? 1 : 0,
    hasRequirements: ws.hasRequirements === true ? 1 : 0,
    hasGit: ws.hasGit === true ? 1 : 0,
    ownCommits: ws.ownCommits === true ? 1 : 0,
    clonedRecently: ws.clonedRecently === true ? 1 : 0,
    projectSize: sizeIx >= 0 ? sizeIx / (SIZE_BUCKETS.length - 1) : 0,
  };
  for (const key of FEATURES_V3) features[key] = round(features[key]);
  return {
    version: 3,
    features,
    vector: FEATURES_V3.map((key) => features[key]),
    meta: { activeMin: round(activeMin), editVolume: num(s.linesInserted) + num(s.linesDeleted), totalCommands: num(s.totalCommands) || kindTotal },
  };
}

/** The best version a session supports: v3 for 2.6.0 data, else v2. */
function bestFeatures(s) {
  return hasV3(s) ? sessionFeaturesV3(s) : sessionFeatures(s);
}

const FEATURES_BY_VERSION = { 2: FEATURES, 3: FEATURES_V3 };

module.exports = { sessionFeatures, sessionFeaturesV3, bestFeatures, hasV3, FEATURES, FEATURES_V3, FEATURES_BY_VERSION, FEATURE_VERSION };
