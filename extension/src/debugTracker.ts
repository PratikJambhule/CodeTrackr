/**
 * Debug Session Tracker
 * Captures debug events: session start/end, breakpoint hits, exceptions
 */

import * as vscode from "vscode";
import { EventLogger } from "./logger";
import { TrackingEvent } from "./types";

interface DebugSessionState {
  sessionId: string;
  startTime: number;
  breakpointHitCount: number;
  exceptionCount: number;
  configuration: string;
  workspaceFolder: string;
}

export class DebugTracker {
  private logger: EventLogger;
  private activeSessions = new Map<string, DebugSessionState>();
  private subscriptions: vscode.Disposable[] = [];

  constructor(logger: EventLogger) {
    this.logger = logger;
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
    console.log("Debug tracker stopped");
  }

  private onSessionStart(session: vscode.DebugSession): void {
    const sessionState: DebugSessionState = {
      sessionId: session.id,
      startTime: Date.now(),
      breakpointHitCount: 0,
      exceptionCount: 0,
      configuration: session.configuration.name || "unknown",
      workspaceFolder: session.workspaceFolder?.name || "unknown"
    };

    this.activeSessions.set(session.id, sessionState);

    const event: Omit<TrackingEvent, "timestamp" | "sessionId" | "eventId" | "retryCount"> = {
      eventType: "debug_session_start",
      sourceModule: "debug",
      data: {
        debugSessionId: session.id,
        configuration: sessionState.configuration,
        workspaceFolder: sessionState.workspaceFolder
      }
    } as const;

    this.logger.log(event);
    console.log(`Debug session started: ${session.id}`);
  }

  private onSessionEnd(session: vscode.DebugSession): void {
    const sessionState = this.activeSessions.get(session.id);
    if (!sessionState) return;

    const duration = Date.now() - sessionState.startTime;
    const event: Omit<TrackingEvent, "timestamp" | "sessionId" | "eventId" | "retryCount"> = {
      eventType: "debug_session_end",
      sourceModule: "debug",
      data: {
        debugSessionId: session.id,
        duration,
        breakpointHitCount: sessionState.breakpointHitCount,
        exceptionCount: sessionState.exceptionCount,
        stoppedReason: "user"
      }
    } as const;

    this.logger.log(event);
    this.activeSessions.delete(session.id);
    console.log(`Debug session ended: ${session.id} (${(duration / 1000).toFixed(1)}s)`);
  }

  private onBreakpointChange(event: vscode.BreakpointsChangeEvent): void {
    const activeSessions = Array.from(this.activeSessions.values());
    if (activeSessions.length === 0) return;

    activeSessions.forEach((state) => {
      state.breakpointHitCount += event.added.length;
    });
  }

  public logException(
    sessionId: string,
    exceptionType: string,
    message: string,
    filePath?: string,
    lineNumber?: number
  ): void {
    const sessionState = this.activeSessions.get(sessionId);
    if (sessionState) {
      sessionState.exceptionCount += 1;
    }

    const event: Omit<TrackingEvent, "timestamp" | "sessionId" | "eventId" | "retryCount"> = {
      eventType: "debug_exception",
      sourceModule: "debug",
      data: {
        debugSessionId: sessionId,
        exceptionType,
        message,
        filePath,
        lineNumber
      }
    } as const;

    this.logger.log(event);
    console.log(`Exception tracked: ${exceptionType} in session ${sessionId}`);
  }

  public getActiveSessions(): DebugSessionState[] {
    return Array.from(this.activeSessions.values());
  }
}

export function createDebugTracker(logger: EventLogger): DebugTracker {
  return new DebugTracker(logger);
}
