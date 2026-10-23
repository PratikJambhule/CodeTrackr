import { describe, expect, it } from 'vitest';
import type { CommandKind, TerminalSummary } from '../types';
import { buildHealth } from './buildHealth';

const old: TerminalSummary = {
  totalCommands: 10, terminalErrorCount: 0, successfulCommands: 7, failedCommands: 3, successRate: 70,
  buildRuns: 4, testRuns: 1, successfulBuilds: 3, failedBuilds: 1, buildSuccessRate: 75, debuggingSessions: 2,
  commandUsage: { gcc: 4 }, gitActivity: { commits: 0, pushes: 0, pulls: 0 }, repeatedFailedCommands: [],
};
const kinds = (k: Partial<Record<CommandKind, number>>, failed: Partial<Record<CommandKind, number>> = {}) => ({
  install: 0, run: 0, compile: 0, build: 0, test: 0, git: 0, docker: 0, other: 0, ...k,
  failed: { install: 0, run: 0, compile: 0, build: 0, test: 0, git: 0, docker: 0, other: 0, ...failed },
});

describe('build health (2.6.0 kinds first, older counters as a fallback)', () => {
  it('uses the old counters when no 2.6.0 data exists', () => {
    const h = buildHealth(old);
    expect(h.hasKinds).toBe(false);
    expect(h.builds).toEqual({ runs: 4, failed: 1 });
    expect(h.debug).toEqual({ sessions: 2, breakpointStops: null });
    expect(h.kinds).toEqual([]);
  });

  it('counts compiles as builds and lists kinds by use, with failures, labelled', () => {
    const h = buildHealth({ ...old, commandKinds: kinds({ compile: 6, run: 3, build: 1, install: 2 }, { compile: 4, build: 1 }),
      runs: { terminal: 12, task: 1, debugNoDebug: 2, codeRunner: 2 }, debug: { sessions: 1, breakpointStops: 5, steps: 12 } });
    expect(h.hasKinds).toBe(true);
    expect(h.builds).toEqual({ runs: 7, failed: 5 });
    expect(h.kinds.map((k) => [k.kind, k.count, k.failed])).toEqual([['compile', 6, 4], ['run', 3, 0], ['install', 2, 0], ['build', 1, 1]]);
    expect(h.kinds[0].label).toBe('Compiling');
    expect(h.programRuns).toBe(17);
    expect(h.debug).toEqual({ sessions: 1, breakpointStops: 5 });
  });

  it('Run Without Debugging is a program run, not debugging', () => {
    const h = buildHealth({ ...old, commandKinds: kinds({}), runs: { terminal: 0, task: 0, debugNoDebug: 4, codeRunner: 0 }, debug: { sessions: 0, breakpointStops: 0, steps: 0 } });
    expect(h.hasKinds).toBe(true);
    expect(h.programRuns).toBe(4);
    expect(h.debug.sessions).toBe(0);
  });
});
