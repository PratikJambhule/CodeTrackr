/**
 * CodeTrackr Event Types and Interfaces
 * Defines structured event contracts for all tracking modules
 */

export type EventType =
  | "activity_tracked"
  | "debug_session_start"
  | "debug_session_end"
  | "debug_breakpoint_hit"
  | "debug_exception"
  | "git_commit"
  | "error_detected"
  | "error_resolved"
  | "test_started"
  | "test_completed";

export type ErrorSeverity = "error" | "warning" | "information" | "hint";

export interface BaseEvent {
  eventType: EventType;
  timestamp: string;
  sessionId: string;
  sourceModule: string;
  retryCount?: number;
  eventId?: string;
}

export interface ActivityEvent extends BaseEvent {
  eventType: "activity_tracked";
  data: {
    fileName: string;
    language: string;
    projectName: string;
    duration: number;
    linesAdded: number;
    linesRemoved: number;
    fileType: string;
  };
}

export interface DebugSessionStartEvent extends BaseEvent {
  eventType: "debug_session_start";
  data: {
    debugSessionId: string;
    configuration: string;
    workspaceFolder: string;
  };
}

export interface DebugSessionEndEvent extends BaseEvent {
  eventType: "debug_session_end";
  data: {
    debugSessionId: string;
    duration: number;
    breakpointHitCount: number;
    exceptionCount: number;
    stoppedReason: string;
  };
}

export interface DebugBreakpointHitEvent extends BaseEvent {
  eventType: "debug_breakpoint_hit";
  data: {
    debugSessionId: string;
    filePath: string;
    lineNumber: number;
    hitCount: number;
  };
}

export interface DebugExceptionEvent extends BaseEvent {
  eventType: "debug_exception";
  data: {
    debugSessionId: string;
    exceptionType: string;
    message: string;
    filePath?: string;
    lineNumber?: number;
  };
}

export interface GitCommitEvent extends BaseEvent {
  eventType: "git_commit";
  data: {
    commitHash: string;
    commitMessage: string;
    author: string;
    fileCount: number;
    filesAdded: number;
    filesModified: number;
    filesDeleted: number;
    linesAdded: number;
    linesRemoved: number;
    repository: string;
  };
}

export interface ErrorDetectedEvent extends BaseEvent {
  eventType: "error_detected";
  data: {
    filePath: string;
    language: string;
    severity: ErrorSeverity;
    message: string;
    lineNumber: number;
    columnNumber: number;
    errorType: string;
    source: string;
  };
}

export interface ErrorResolvedEvent extends BaseEvent {
  eventType: "error_resolved";
  data: {
    filePath: string;
    language: string;
    errorType: string;
    source: string;
  };
}

export interface TestStartedEvent extends BaseEvent {
  eventType: "test_started";
  data: {
    command: string;
    workspaceFolder: string;
  };
}

export interface TestCompletedEvent extends BaseEvent {
  eventType: "test_completed";
  data: {
    command: string;
    duration: number;
    passed: boolean;
    output?: string;
  };
}

export type TrackingEvent =
  | ActivityEvent
  | DebugSessionStartEvent
  | DebugSessionEndEvent
  | DebugBreakpointHitEvent
  | DebugExceptionEvent
  | GitCommitEvent
  | ErrorDetectedEvent
  | ErrorResolvedEvent
  | TestStartedEvent
  | TestCompletedEvent;

export interface EventBatch {
  batchId: string;
  sessionId: string;
  timestamp: string;
  events: TrackingEvent[];
  retryAttempt: number;
}

export interface LoggerConfig {
  maxQueueSize: number;
  sessionId: string;
  debug: boolean;
}

export interface SyncConfig {
  apiBase: string;
  batchIntervalSeconds: number;
  maxRetries: number;
  retryDelayMs: number;
  maxBatchSize: number;
}
