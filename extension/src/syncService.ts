/**
 * Event Sync Service
 * Handles batching, retry logic, and persistence
 */

import * as vscode from "vscode";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { EventBatch, SyncConfig } from "./types";
import { EventLogger } from "./logger";

export class SyncService {
  private logger: EventLogger;
  private config: SyncConfig;
  private syncTimer?: NodeJS.Timeout;
  private isProcessing = false;
  private failedBatches: EventBatch[] = [];
  private outputChannel: vscode.OutputChannel;

  constructor(logger: EventLogger, config: SyncConfig) {
    this.logger = logger;
    this.config = config;
    this.outputChannel = vscode.window.createOutputChannel("CodeTrackr Sync");
  }

  public start(): void {
    if (this.syncTimer) {
      this.log("Sync service already running");
      return;
    }

    this.log(`Sync service started (batch interval: ${this.config.batchIntervalSeconds}s)`);
    this.syncTimer = setInterval(
      () => this.processBatch(),
      this.config.batchIntervalSeconds * 1000
    );

    this.processBatch().catch(() => {});
  }

  public stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    this.log("Sync service stopped");
  }

  public async processBatch(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const events = this.logger.getBatch(this.config.maxBatchSize);
      if (events.length === 0) {
        if (this.failedBatches.length > 0) {
          this.log(`Retrying ${this.failedBatches.length} failed batch(es)`);
          const batch = this.failedBatches[0];
          await this.sendBatch(batch);
        }
        return;
      }

      const batch: EventBatch = {
        batchId: uuidv4(),
        sessionId: (this.logger as any)["sessionId"],
        timestamp: new Date().toISOString(),
        events,
        retryAttempt: 0
      };

      this.log(`Processing batch ${batch.batchId} with ${events.length} events`);
      await this.sendBatch(batch);
    } catch (err) {
      this.log(`Batch processing failed: ${err}`);
    } finally {
      this.isProcessing = false;
    }
  }

  public async sendBatch(batch: EventBatch): Promise<void> {
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        batch.retryAttempt = attempt;
        this.log(`Sending batch ${batch.batchId} (attempt ${attempt + 1}/${this.config.maxRetries})`);

        const response = await axios.post(
          `${this.config.apiBase}/api/extension/events`,
          batch,
          {
            headers: { "Content-Type": "application/json" },
            timeout: 10000
          }
        );

        if (response.status === 200 || response.status === 201) {
          this.log(`Batch ${batch.batchId} sent successfully (${batch.events.length} events)`);
          this.logger.markAsSent(batch.events);
          this.failedBatches = this.failedBatches.filter((b) => b.batchId !== batch.batchId);
          return;
        }
      } catch (err: any) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt);
        const status = err?.response?.status;
        if (status === 400 || status === 409) {
          this.log(`Batch ${batch.batchId} rejected (${status})`);
          return;
        }
        if (attempt < this.config.maxRetries - 1) {
          this.log(`Retry batch ${batch.batchId} in ${delay}ms (error: ${err.message})`);
          await this.delay(delay);
        } else {
          this.log(`Batch ${batch.batchId} failed after ${this.config.maxRetries} attempts`);
          if (!this.failedBatches.find((b) => b.batchId === batch.batchId)) {
            this.failedBatches.push(batch);
          }
        }
      }
    }
  }

  public async forceSync(): Promise<void> {
    this.log("Force syncing...");
    await this.processBatch();
  }

  public getStats(): { isRunning: boolean; failedBatchCount: number; queueStats: ReturnType<EventLogger["getStats"]> } {
    return {
      isRunning: !!this.syncTimer,
      failedBatchCount: this.failedBatches.length,
      queueStats: this.logger.getStats()
    };
  }

  public async restoreFailedBatches(context: vscode.ExtensionContext): Promise<void> {
    try {
      const persisted = context.globalState.get<EventBatch[]>("codetrackr.failedBatches");
      if (persisted && persisted.length > 0) {
        this.failedBatches = persisted;
        this.log(`Restored ${persisted.length} failed batch(es)`);
      }
    } catch (err) {
      this.log(`Could not restore failed batches: ${err}`);
    }
  }

  public async persistFailedBatches(context: vscode.ExtensionContext): Promise<void> {
    try {
      if (this.failedBatches.length > 0) {
        await context.globalState.update("codetrackr.failedBatches", this.failedBatches);
        this.log(`Persisted ${this.failedBatches.length} failed batch(es)`);
      }
    } catch (err) {
      this.log(`Could not persist failed batches: ${err}`);
    }
  }

  public showOutput(): void {
    this.outputChannel.show();
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    this.outputChannel.appendLine(logMsg);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createSyncService(logger: EventLogger, apiBase: string): SyncService {
  const config: SyncConfig = {
    apiBase,
    batchIntervalSeconds: 30,
    maxRetries: 3,
    retryDelayMs: 1000,
    maxBatchSize: 100
  };

  return new SyncService(logger, config);
}
