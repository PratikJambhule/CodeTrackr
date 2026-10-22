/**
 * Debug Session Tracker (plan E7)
 *
 * Counts REAL debugging for the current interval: debug sessions started with the debugger, how
 * often execution stopped (breakpoint, exception) and how often you stepped (next / step in / out).
 * "Run Without Debugging", which most ▶ Run buttons use, is a run, not debugging: RunsTracker counts
 * it, and it is not counted here (before 2.6.0 it was, so running a DSA file looked like debugging).
 *
 * Stops and steps come from a debug adapter tracker, which sees the messages between VS Code and the
 * debugger. Only the message type is read: no variables, values or source.
 */

import * as vscode from "vscode";

interface DebugSessionState {
  sessionId: string;
  startTime: number;
}

export interface DebugIntervalSnapshot {
  /** Debug sessions started with the debugger (Run Without Debugging excluded). */
  debugSessions: number;
  /** Times execution stopped at a breakpoint or an exception. */
  breakpointStops: number;
  /** Step over / into / out / back requests. */
  steps: number;
  totalDebugMs: number;
}

const STOP_REASONS = new Set(["breakpoint", "exception", "function breakpoint", "data breakpoint", "instruction breakpoint"]);
const STEP_COMMANDS = new Set(["next", "stepIn", "stepOut", "stepBack"]);

/** True for "Run Without Debugging" (Ctrl+F5, and most ▶ Run buttons). */
export function isNoDebug(session?: { configuration?: { [key: string]: any } }): boolean {
  return session?.configuration?.noDebug === true;
}

export class DebugTracker {
  private activeSessions = new Map<string, DebugSessionState>();
  private subscriptions: vscode.Disposable[] = [];
  private interval: DebugIntervalSnapshot = DebugTracker.empty();

  private static empty(): DebugIntervalSnapshot {
    return { debugSessions: 0, breakpointStops: 0, steps: 0, totalDebugMs: 0 };
  }

  public start(context: vscode.ExtensionContext): void {
    this.subscriptions.push(
      vscode.debug.onDidStartDebugSession((session) => this.onSessionStart(session)),
      vscode.debug.onDidTerminateDebugSession((session) => this.onSessionEnd(session))
    );
    if (typeof vscode.debug.registerDebugAdapterTrackerFactory === "function") {
      this.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("*", {
          createDebugAdapterTracker: (session) => (isNoDebug(session) ? undefined : {
            onDidSendMessage: (message: any) => this.onAdapterMessage(message),
            onWillReceiveMessage: (message: any) => this.onClientMessage(message),
          }),
        })
      );
    }
    context.subscriptions.push(...this.subscriptions);
    console.log("Debug tracker started");
  }

  public stop(): void {
    this.subscriptions.forEach((sub) => sub.dispose());
    this.subscriptions = [];
  }

  /** A message from the debugger to VS Code: "stopped" events count as stops. Exposed for tests. */
  public onAdapterMessage(message: any): void {
    if (message?.type === "event" && message.event === "stopped" && STOP_REASONS.has(message.body?.reason)) {
      this.interval.breakpointStops += 1;
    }
  }

  /** A request from VS Code to the debugger: step requests count as steps. Exposed for tests. */
  public onClientMessage(message: any): void {
    if (message?.type === "request" && STEP_COMMANDS.has(message.command)) {
      this.interval.steps += 1;
    }
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

  public onSessionStart(session: vscode.DebugSession): void {
    if (isNoDebug(session)) return; // a run, not debugging
    this.activeSessions.set(session.id, { sessionId: session.id, startTime: Date.now() });
    this.interval.debugSessions += 1;
  }

  public onSessionEnd(session: vscode.DebugSession): void {
    const sessionState = this.activeSessions.get(session.id);
    if (!sessionState) return;
    this.interval.totalDebugMs += Date.now() - sessionState.startTime;
    this.activeSessions.delete(session.id);
  }

  public getActiveSessions(): DebugSessionState[] {
    return Array.from(this.activeSessions.values());
  }
}

export function createDebugTracker(): DebugTracker {
  return new DebugTracker();
}
