import type { CommandKind, TerminalSummary } from '../types';
import { commandKindLabel } from './format';

const KINDS: CommandKind[] = ['install', 'run', 'compile', 'build', 'test', 'git', 'docker', 'other'];

export interface BuildHealthView {
  /** true when the period has extension 2.6.0 data (command kinds, runs or real debugging) */
  hasKinds: boolean;
  /** commands by kind, most used first, with how many failed */
  kinds: { kind: string; label: string; count: number; failed: number }[];
  /** 2.6.0: build + compile commands; older data: the old build counter */
  builds: { runs: number; failed: number };
  /** terminal commands, tasks, Run Without Debugging and Code Runner runs (2.6.0) */
  programRuns: number;
  /** 2.6.0: real debug sessions (not Ctrl+F5) and breakpoint stops; older data: every debug start */
  debug: { sessions: number; breakpointStops: number | null };
}

/** The dashboard's build-health numbers, from the cleaner 2.6.0 counts when the period has them. */
export function buildHealth(t: TerminalSummary): BuildHealthView {
  const ck = t.commandKinds;
  const runs = t.runs;
  const programRuns = runs ? Object.values(runs).reduce((a, b) => a + b, 0) : 0;
  const kindTotal = ck ? KINDS.reduce((a, k) => a + (ck[k] || 0), 0) : 0;
  const hasKinds = kindTotal > 0 || programRuns > 0 || (t.debug?.sessions ?? 0) > 0;
  if (!hasKinds || !ck) {
    return { hasKinds: false, kinds: [], builds: { runs: t.buildRuns, failed: t.failedBuilds }, programRuns: 0,
      debug: { sessions: t.debuggingSessions, breakpointStops: null } };
  }
  const kinds = KINDS.map((k) => ({ kind: k, label: commandKindLabel(k), count: ck[k] || 0, failed: ck.failed?.[k] || 0 }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    hasKinds,
    kinds,
    builds: { runs: (ck.build || 0) + (ck.compile || 0), failed: (ck.failed?.build || 0) + (ck.failed?.compile || 0) },
    programRuns,
    debug: { sessions: t.debug?.sessions ?? 0, breakpointStops: t.debug?.breakpointStops ?? 0 },
  };
}
