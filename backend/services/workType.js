'use strict';

/**
 * Work-type rules v1 (ML plan §6, change C-06). Pure.
 *
 * The baseline the trained model must beat, and the fallback whenever no model has passed the ship
 * gate. Rules are checked in order; the first match wins. DSA is checked before debugging on purpose:
 * a compile-error loop on a practice problem is DSA practice, not debugging (the old rules called it
 * "debug grind" because g++ counts as a build).
 *
 * Input is the output of workTypeFeatures.sessionFeatures(): { features, meta }.
 */

const WORK_TYPES = ['dsa', 'project', 'debugging', 'learning', 'setup'];
const NOT_ENOUGH = 'not_enough';
const NOT_SURE = 'not_sure';

const LABELS = {
  dsa: 'DSA practice', project: 'Project building', debugging: 'Debugging',
  learning: 'Learning & exploring', setup: 'Setup & config',
  not_enough: 'Not enough activity', not_sure: 'Not sure',
};

// Users see 3 groups (decision 2026-10-22); the model and the labels keep the 5 types.
const GROUP_OF = { dsa: 'dsa', project: 'project_work', debugging: 'project_work', learning: 'learning_setup', setup: 'learning_setup' };
const GROUP_LABELS = { dsa: 'DSA', project_work: 'Project work', learning_setup: 'Learning & setup' };
const groupOf = (type) => GROUP_OF[type] || null;

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Rules v2 (plan M2) for feature version 3: the same order, with cleaner signals.
 *  - DSA can be recognised from a compile-and-run loop in a tiny project without package files or
 *    commits, even when files are not named like problems.
 *  - Setup = installs (not `npm run dev`, which is a run) or config files, with little writing.
 *  - Debugging = the real debugger (Run Without Debugging is a run), or failing builds with rework.
 *  - Learning = mostly reading, docs, or a freshly cloned repo with commits that are not yours.
 */
function classifyV2({ features: f, meta }) {
  if (meta.activeMin < 5 || (meta.editVolume === 0 && meta.totalCommands === 0 && f.readingShare === 0)) {
    return { workType: NOT_ENOUGH, reason: 'under 5 active minutes, or nothing happened' };
  }
  if (f.practiceFolder === 1) {
    return { workType: 'dsa', reason: 'the project folder is named like a practice repo' };
  }
  const noPackages = !f.hasPackageJson && !f.hasRequirements;
  if (f.problemFileShare >= 0.5 && f.filesTouched <= 3 && f.commitsPerHour === 0 && f.installShare < 0.2) {
    return { workType: 'dsa', reason: `${pct(f.problemFileShare)} of files named like practice problems, no commits` };
  }
  if (f.compileShare + f.runShare >= 0.6 && f.filesTouched <= 2 && noPackages && f.commitsPerHour === 0 && f.projectSize <= 0.34) {
    return { workType: 'dsa', reason: 'a compile-and-run loop on one or two files in a small folder' };
  }
  if ((f.installShare >= 0.4 || f.configFileShare >= 0.5) && f.linesPerMin < 2) {
    return { workType: 'setup', reason: f.installShare >= 0.4
      ? `${pct(f.installShare)} of commands installed or set things up, little writing`
      : `${pct(f.configFileShare)} of files were configuration, little writing` };
  }
  if ((f.realDebugPerHour > 0 || (f.buildFailRatio >= 0.5 && f.churnRatio >= 0.35)) && f.linesPerMin < 4) {
    return { workType: 'debugging', reason: f.realDebugPerHour > 0
      ? 'the debugger was used, little new code' : `${pct(f.buildFailRatio)} of builds failed, much rework` };
  }
  if ((f.readingShare >= 0.6 || f.docFileShare >= 0.4 || (f.clonedRecently && !f.ownCommits)) && f.linesPerMin < 2) {
    return { workType: 'learning', reason: f.docFileShare >= 0.4
      ? `${pct(f.docFileShare)} of the time in docs or notes`
      : f.readingShare >= 0.6 ? `${pct(f.readingShare)} of the time reading` : 'a freshly cloned repo, reading' };
  }
  if (f.linesPerMin >= 1 && (f.commitsPerHour > 0 || f.filesTouched >= 3 || !noPackages)) {
    return { workType: 'project', reason: f.commitsPerHour > 0 ? 'steady writing with commits' : 'steady writing in a project' };
  }
  return { workType: NOT_SURE, reason: 'no rule matched clearly' };
}

/** Rules v1 for feature version 2, rules v2 for version 3. */
function classifyWorkType(fv) {
  return fv && fv.version === 3 ? classifyV2(fv) : classifyV1(fv);
}

function classifyV1({ features: f, meta }) {
  if (meta.activeMin < 5 || (meta.editVolume === 0 && meta.totalCommands === 0)) {
    return { workType: NOT_ENOUGH, reason: 'under 5 active minutes, or no edits and no commands' };
  }
  if (f.practiceFolder === 1) {
    return { workType: 'dsa', reason: 'the project folder is named like a practice repo' };
  }
  if (f.problemFileShare >= 0.5 && f.filesTouched <= 3 && f.commitsPerHour === 0 && f.packageShare < 0.2) {
    return { workType: 'dsa', reason: `${pct(f.problemFileShare)} of files named like practice problems, no commits` };
  }
  if ((f.packageShare >= 0.5 || f.configFileShare >= 0.5) && meta.editVolume < 10) {
    return { workType: 'setup', reason: f.packageShare >= 0.5
      ? `${pct(f.packageShare)} of commands were package installs, few edits`
      : `${pct(f.configFileShare)} of files were configuration, few edits` };
  }
  if ((f.debugPerHour > 0 || f.buildFailRatio >= 0.5) && f.linesPerMin < 4) {
    return { workType: 'debugging', reason: f.debugPerHour > 0
      ? 'debug sessions with little new code'
      : `${pct(f.buildFailRatio)} of builds failed, little new code` };
  }
  if (f.readRatio >= 0.7 && f.linesPerMin < 2 && f.switchesPerMin >= 0.3) {
    return { workType: 'learning', reason: `${pct(f.readRatio)} of the time reading, many file switches` };
  }
  if (f.linesPerMin >= 1 && (f.commitsPerHour > 0 || f.filesTouched >= 3)) {
    return { workType: 'project', reason: f.commitsPerHour > 0
      ? 'steady writing with commits' : `steady writing across ${f.filesTouched} files` };
  }
  return { workType: NOT_SURE, reason: 'no rule matched clearly' };
}

module.exports = { classifyWorkType, WORK_TYPES, NOT_ENOUGH, NOT_SURE, LABELS, GROUP_OF, GROUP_LABELS, groupOf };
