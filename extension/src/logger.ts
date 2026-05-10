/**
 * Centralized Event Logger
 * Manages event queue, deduplication, and structured logging
 */

import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { LoggerConfig, TrackingEvent } from "./types";

type UnstampedEvent = Omit<TrackingEvent, "timestamp" | "sessionId" | "eventId" | "retryCount">;

export class EventLogger {
  private eventQueue: TrackingEvent[] = [];
  private sentEventIds = new Set<string>();
  private config: LoggerConfig;
  private sessionId: string;
  private outputChannel: vscode.OutputChannel;

  constructor(config: LoggerConfig) {
    this.config = config;
    this.sessionId = config.sessionId;
    this.outputChannel = vscode.window.createOutputChannel("CodeTrackr Events");
  }

  public log(event: UnstampedEvent): TrackingEvent {
    const fullEvent: TrackingEvent = {
      ...event,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      eventId: uuidv4(),
      retryCount: 0
    } as TrackingEvent;

    if (fullEvent.eventId && this.sentEventIds.has(fullEvent.eventId)) {
      this.debugLog(`Duplicate event skipped: ${fullEvent.eventId}`);
      return fullEvent;
    }

    if (this.eventQueue.length >= this.config.maxQueueSize) {
      this.debugLog(`Event queue full (${this.config.maxQueueSize}), dropping oldest`);
      this.eventQueue.shift();
    }

    this.eventQueue.push(fullEvent);
    this.debugLog(`Event logged: ${fullEvent.eventType} (queue size: ${this.eventQueue.length})`);
    return fullEvent;
  }

  public getBatch(maxSize: number): TrackingEvent[] {
    const batch = this.eventQueue.splice(0, maxSize);
    return batch;
  }

  public markAsSent(events: TrackingEvent[]): void {
    events.forEach((event) => {
      if (event.eventId) {
        this.sentEventIds.add(event.eventId);
      }
    });
    this.debugLog(`Marked ${events.length} events as sent. Sent IDs: ${this.sentEventIds.size}`);
  }

  public getQueueSize(): number {
    return this.eventQueue.length;
  }

  public getQueueSnapshot(): TrackingEvent[] {
    return [...this.eventQueue];
  }

  public clearQueue(): void {
    this.eventQueue = [];
    this.debugLog("Event queue cleared");
  }

  public getSentEventCount(): number {
    return this.sentEventIds.size;
  }

  private debugLog(message: string): void {
    if (this.config.debug) {
      const timestamp = new Date().toISOString();
      const logMsg = `[${timestamp}] ${message}`;
      console.log(logMsg);
      this.outputChannel.appendLine(logMsg);
    }
  }

  public showOutput(): void {
    this.outputChannel.show();
  }

  public getStats(): { queueSize: number; sentEventCount: number; sessionId: string } {
    return {
      queueSize: this.eventQueue.length,
      sentEventCount: this.sentEventIds.size,
      sessionId: this.sessionId
    };
  }
}

export function createEventLogger(debug: boolean = false): EventLogger {
  const sessionId = uuidv4();
  return new EventLogger({
    maxQueueSize: 1000,
    sessionId,
    debug
  });
}
