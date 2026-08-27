/**
 * Aggregates terminal analytics for a flush interval.
 */

import { CommandCategory } from "./commandClassifier";

interface ExecutionRecord {
  rawCommand: string;
  sanitizedCommand: string;
  normalizedCommand: string;
  category: CommandCategory;
  gitAction: string | null;
  isBuild: boolean;
  isTest: boolean;
  isDebug: boolean;
  exitCode: number;
  durationMs: number;
}

interface FailureRecord {
  command: string;
  timestamps: number[];
}

export interface TerminalAnalyticsSnapshot {
  totalCommands: number;
  terminalErrorCount: number;
  successfulCommands: number;
  failedCommands: number;
  successRate: number;
  buildRuns: number;
  testRuns: number;
  successfulBuilds: number;
  failedBuilds: number;
  buildSuccessRate: number;
  debuggingSessions: number;
  commandUsage: Record<CommandCategory, number>;
  gitActivity: {
    commits: number;
    pushes: number;
    pulls: number;
    checkouts: number;
    merges: number;
    clones: number;
  };
  repeatedFailedCommands: Array<{ command: string; count: number }>;
}

export class TerminalAnalyticsAggregator {
  private interval: TerminalAnalyticsSnapshot;
  private recentFailures = new Map<string, FailureRecord>();

  constructor() {
    this.interval = this.createEmptySnapshot();
  }

  public recordExecution(record: ExecutionRecord): void {
    this.interval.totalCommands += 1;

    if (record.exitCode === 0) {
      this.interval.successfulCommands += 1;
    } else {
      this.interval.failedCommands += 1;
      this.interval.terminalErrorCount += 1;
      this.trackFailure(record.sanitizedCommand);
    }

    this.interval.commandUsage[record.category] += 1;

    if (record.isBuild) {
      this.interval.buildRuns += 1;
      if (record.exitCode === 0) {
        this.interval.successfulBuilds += 1;
      } else {
        this.interval.failedBuilds += 1;
      }
    }

    if (record.isTest) {
      this.interval.testRuns += 1;
    }

    if (record.isDebug) {
      this.interval.debuggingSessions += 1;
    }

    if (record.gitAction) {
      switch (record.gitAction) {
        case "commit":
          this.interval.gitActivity.commits += 1;
          break;
        case "push":
          this.interval.gitActivity.pushes += 1;
          break;
        case "pull":
          this.interval.gitActivity.pulls += 1;
          break;
        case "checkout":
          this.interval.gitActivity.checkouts += 1;
          break;
        case "merge":
          this.interval.gitActivity.merges += 1;
          break;
        case "clone":
          this.interval.gitActivity.clones += 1;
          break;
      }
    }
  }

  public consumeInterval(): TerminalAnalyticsSnapshot {
    const snapshot = this.getSnapshot();
    this.interval = this.createEmptySnapshot();
    this.recentFailures.clear();
    return snapshot;
  }

  public getSnapshot(): TerminalAnalyticsSnapshot {
    const snapshot = { ...this.interval };
    snapshot.commandUsage = { ...this.interval.commandUsage };
    snapshot.gitActivity = { ...this.interval.gitActivity };
    snapshot.successRate = this.computeSuccessRate(snapshot);
    snapshot.buildSuccessRate = this.computeBuildSuccessRate(snapshot);
    snapshot.repeatedFailedCommands = this.collectRepeatedFailures();
    return snapshot;
  }

  private createEmptySnapshot(): TerminalAnalyticsSnapshot {
    return {
      totalCommands: 0,
      terminalErrorCount: 0,
      successfulCommands: 0,
      failedCommands: 0,
      successRate: 0,
      buildRuns: 0,
      testRuns: 0,
      successfulBuilds: 0,
      failedBuilds: 0,
      buildSuccessRate: 0,
      debuggingSessions: 0,
      commandUsage: {
        git: 0,
        npm: 0,
        node: 0,
        python: 0,
        docker: 0,
        pip: 0,
        java: 0,
        gcc: 0,
        misc: 0,
      },
      gitActivity: {
        commits: 0,
        pushes: 0,
        pulls: 0,
        checkouts: 0,
        merges: 0,
        clones: 0,
      },
      repeatedFailedCommands: [],
    };
  }

  private computeSuccessRate(snapshot: TerminalAnalyticsSnapshot): number {
    if (snapshot.totalCommands === 0) return 0;
    return Math.round((snapshot.successfulCommands / snapshot.totalCommands) * 100);
  }

  private computeBuildSuccessRate(snapshot: TerminalAnalyticsSnapshot): number {
    if (snapshot.buildRuns === 0) return 0;
    return Math.round((snapshot.successfulBuilds / snapshot.buildRuns) * 100);
  }

  private trackFailure(command: string): void {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const existing = this.recentFailures.get(command) || { command, timestamps: [] };
    existing.timestamps = existing.timestamps.filter((ts) => now - ts <= windowMs);
    existing.timestamps.push(now);
    this.recentFailures.set(command, existing);
  }

  private collectRepeatedFailures(): Array<{ command: string; count: number }> {
    const entries: Array<{ command: string; count: number }> = [];
    this.recentFailures.forEach((record) => {
      if (record.timestamps.length >= 2) {
        entries.push({ command: record.command, count: record.timestamps.length });
      }
    });
    return entries.sort((a, b) => b.count - a.count).slice(0, 5);
  }
}
