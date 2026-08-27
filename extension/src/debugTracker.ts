/**
 * Debug Session Tracker
 * Counts debug sessions, breakpoint changes and exceptions for the current
 * flush interval. The counts are folded into the terminalAnalytics payload
 * sent to /api/extension/track, so this data actually reaches the backend.
 *
 * (Before 2.0.11 this fed the EventLogger/SyncService pipeline, which posted
 * to a route that does not exist — none of it was ever stored.)
 */

import * as vscode from "vscode";

interface DebugSessionState {
  sessionId: string;
  startTime: number;
  breakpointHitCount: number;
  exceptionCount: number;
  configuration: string;
  workspaceFolder: string;
}

export interface DebugIntervalSnapshot {
  debugSessions: number;
  breakpointHits: number;
  exceptions: number;
  totalDebugMs: number;
}

export class DebugTracker {
  private activeSessions = new Map<string, DebugSessionState>();
  private subscriptions: vscode.Disposable[] = [];
  private interval: DebugIntervalSnapshot = DebugTracker.empty();

  private static empty(): DebugIntervalSnapshot {
    return { debugSessions: 0, breakpointHits: 0, exceptions: 0, totalDebugMs: 0 };
  }

  public start(context: vscode.ExtensionContext): void {
    this.subscriptions.push(
      vscode.debug.onDidStartDebugSession((session) => this.onSessionStart(session)),
      vscode.debug.onDidTerminateDebugSession((session) => this.onSessionEnd(session)),
      vscode.debug.onDidChangeBreakpoints((event) => this.onBreakpointChange(event))
    );

    context.subscriptions.push(...this.subscriptions);
    console.log("Debug tracker started");
  }

  public stop(): void {
    this.subscriptions.forEach((sub) => sub.dispose());
    this.subscriptions = [];
  }

  /** Returns the counts for this interval and resets them. */
  public consumeInterval(): DebugIntervalSnapshot {
    const snapshot = { ...this.interval };
    this.interval = DebugTracker.empty();
    return snapshot;
  }

  public getIntervalSnapshot(): DebugIntervalSnapshot {
    return { ...this.interval };
  }

  private onSessionStart(session: vscode.DebugSession): void {
    this.activeSessions.set(session.id, {
      sessionId: session.id,
      startTime: Date.now(),
      breakpointHitCount: 0,
      exceptionCount: 0,
      configuration: session.configuration.name || "unknown",
      workspaceFolder: session.workspaceFolder?.name || "unknown"
    });

    this.interval.debugSessions += 1;
    console.log(`Debug session started: ${session.id}`);
  }

  private onSessionEnd(session: vscode.DebugSession): void {
    const sessionState = this.activeSessions.get(session.id);
    if (!sessionState) return;

    const duration = Date.now() - sessionState.startTime;
    this.interval.totalDebugMs += duration;
    this.activeSessions.delete(session.id);
    console.log(`Debug session ended: ${session.id} (${(duration / 1000).toFixed(1)}s)`);
  }

  private onBreakpointChange(event: vscode.BreakpointsChangeEvent): void {
    if (this.activeSessions.size === 0) return;

    this.interval.breakpointHits += event.added.length;
    this.activeSessions.forEach((state) => {
      state.breakpointHitCount += event.added.length;
    });
  }

  public logException(sessionId: string): void {
    const sessionState = this.activeSessions.get(sessionId);
    if (sessionState) {
      sessionState.exceptionCount += 1;
    }
    this.interval.exceptions += 1;
  }

  public getActiveSessions(): DebugSessionState[] {
    return Array.from(this.activeSessions.values());
  }
}

export function createDebugTracker(): DebugTracker {
  return new DebugTracker();
}
