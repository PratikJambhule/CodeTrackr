/**
 * Terminal Analytics Tracker
 * Tracks terminal commands using shell execution events only.
 */

import * as vscode from "vscode";
import {
  classifyCommand,
  sanitizeCommand,
  normalizeCommand,
  CommandCategory,
} from "./commandClassifier";
import { TerminalAnalyticsAggregator } from "./analyticsAggregator";

export interface RepeatedFailedCommand {
  command: string;
  count: number;
}

export interface TerminalAnalyticsPayload {
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
  repeatedFailedCommands: RepeatedFailedCommand[];
  lastCommand: string;
  lastCommandTimestamp: string | null;
}

interface ExecutionMeta {
  startTime: number;
  command: string;
  normalized: string;
  isIgnored: boolean;
}

export class TerminalTracker {
  private subscriptions: vscode.Disposable[] = [];
  private inFlight = new WeakMap<vscode.TerminalShellExecution, ExecutionMeta>();
  private completedExecutions = new WeakSet<vscode.TerminalShellExecution>();
  private aggregator = new TerminalAnalyticsAggregator();
  private lastCommand: string = "unknown";
  private lastCommandTimestamp: string | null = null;

  public start(context: vscode.ExtensionContext): void {
    if (typeof vscode.window.onDidStartTerminalShellExecution !== "function") {
      console.log("Terminal shell execution events are not supported in this VS Code version.");
      return;
    }

    this.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) =>
        this.onExecutionStart(event)
      ),
      vscode.window.onDidEndTerminalShellExecution((event) =>
        this.onExecutionEnd(event)
      )
    );

    context.subscriptions.push(...this.subscriptions);
    console.log("Terminal tracker started");
  }

  public stop(): void {
    this.subscriptions.forEach((sub) => sub.dispose());
    this.subscriptions = [];
    console.log("Terminal tracker stopped");
  }

  public consumeInterval(): TerminalAnalyticsPayload {
    const snapshot = this.aggregator.consumeInterval();
    return {
      ...snapshot,
      lastCommand: this.lastCommand,
      lastCommandTimestamp: this.lastCommandTimestamp,
    };
  }

  public getIntervalSnapshot(): TerminalAnalyticsPayload {
    const snapshot = this.aggregator.getSnapshot();
    return {
      ...snapshot,
      lastCommand: this.lastCommand,
      lastCommandTimestamp: this.lastCommandTimestamp,
    };
  }

  private onExecutionStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const commandLine = event.execution.commandLine.value.trim();
    if (!commandLine) return;

    const normalized = normalizeCommand(commandLine);
    const classification = classifyCommand(commandLine);
    const isIgnored = classification.isIgnored;

    if (!isIgnored) {
      const sanitized = sanitizeCommand(commandLine);
      this.lastCommand = sanitized;
      this.lastCommandTimestamp = new Date().toISOString();
    }

    this.inFlight.set(event.execution, {
      startTime: Date.now(),
      command: commandLine,
      normalized,
      isIgnored,
    });
  }

  private onExecutionEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    const execution = event.execution;
    if (this.completedExecutions.has(execution)) return;
    this.completedExecutions.add(execution);

    const meta = this.inFlight.get(execution);
    const commandLine = meta?.command || execution.commandLine.value.trim();
    if (!commandLine) return;

    const classification = classifyCommand(commandLine);
    if (meta?.isIgnored || classification.isIgnored) return;

    const sanitized = sanitizeCommand(commandLine);
    const normalized = meta?.normalized || normalizeCommand(commandLine);
    const exitCode = event.exitCode ?? 0;
    const durationMs = meta ? Date.now() - meta.startTime : 0;

    this.aggregator.recordExecution({
      rawCommand: commandLine,
      sanitizedCommand: sanitized,
      normalizedCommand: normalized,
      category: classification.category,
      gitAction: classification.gitAction,
      isBuild: classification.isBuild,
      isTest: classification.isTest,
      isDebug: classification.isDebug,
      exitCode,
      durationMs,
    });
  }
}

export function createTerminalTracker(): TerminalTracker {
  return new TerminalTracker();
}
