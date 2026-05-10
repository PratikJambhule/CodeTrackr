/**
 * CodeTrackr VS Code Extension - Main Entry Point (TypeScript)
 * Integrates activity tracking, debug monitoring, git tracking, and error reporting
 */

import * as vscode from "vscode";
import axios from "axios";
import * as os from "os";
import * as path from "path";
import { EventLogger, createEventLogger } from "./logger";
import { SyncService, createSyncService } from "./syncService";
import { DebugTracker, createDebugTracker } from "./debugTracker";
import { TerminalTracker, createTerminalTracker } from "./terminalTracker";
import { ActivityEvent } from "./types";
import { v4 as uuidv4 } from "uuid";

// --------- Global State ----------
interface AppState {
  timer?: NodeJS.Timeout;
  lastActivityMs: number;
  startedMs?: number;
  bufferedMinutes: number;
  lastKnownFile: string;
  linesAdded: number;
  linesRemoved: number;
  activeTerminalCount: number;
  isPaused: boolean;
  pauseTimeoutMs: number;
}

const state: AppState = {
  lastActivityMs: Date.now(),
  bufferedMinutes: 0,
  lastKnownFile: "unknown",
  linesAdded: 0,
  linesRemoved: 0,
  activeTerminalCount: vscode.window.terminals.length,
  isPaused: false,
  pauseTimeoutMs: 2 * 60 * 1000, // 2 minutes
};

// Track previous line counts per file
const lineCounts = new Map<string, number>();
let telemetryInitialized = false;

// Trackers and services
let logger: EventLogger;
let syncService: SyncService;
let debugTracker: DebugTracker;
let terminalTracker: TerminalTracker;

// --------- Config Helpers ----------
function getCfg() {
  const cfg = vscode.workspace.getConfiguration("codetrackr");
  return {
    apiBase: cfg.get<string>("apiBase") || "http://127.0.0.1:5050",
    userId: cfg.get<string>("userId") || safeUsername(),
    apiKey: cfg.get<string>("apiKey") || "",
    flushIntervalSeconds: 30,
    minFlushMinutes: 0.1,
  };
}

function safeUsername(): string {
  try {
    return os.userInfo().username || "unknown";
  } catch {
    return "unknown";
  }
}

// --------- Helpers ----------
function getFileMeta(filePath: string | undefined) {
  if (!filePath) return {};
  const ext = path.extname(filePath).toLowerCase();
  const projectName =
    vscode.workspace.name ||
    path.basename(vscode.workspace.rootPath || path.dirname(filePath));
  const language =
    vscode.window.activeTextEditor?.document?.languageId || "unknown";
  return { fileType: ext, projectName, language };
}

function markActivity(fileNameMaybe?: string): void {
  const wasIdleOrPaused = state.isPaused;

  state.lastActivityMs = Date.now();

  if (state.isPaused) {
    state.isPaused = false;
    state.startedMs = Date.now();
    state.bufferedMinutes = 0;
    console.log("CodeTrackr: Activity resumed after idle period");
    vscode.window.setStatusBarMessage("CodeTrackr: Tracking resumed ▶️", 2000);
  }

  if (fileNameMaybe) {
    state.lastKnownFile = fileNameMaybe;
  } else {
    const active = vscode.window.activeTextEditor?.document?.fileName;
    if (active) state.lastKnownFile = active;
  }
}

function initLineCountForDocument(doc: vscode.TextDocument | undefined): void {
  if (!doc || !doc.fileName) return;
  try {
    lineCounts.set(doc.fileName, doc.lineCount);
  } catch {
    // ignore
  }
}

function minutesSince(ms: number): number {
  return (Date.now() - ms) / 60000;
}

function initializeTelemetry(context: vscode.ExtensionContext): void {
  if (telemetryInitialized) return;
  telemetryInitialized = true;

  state.activeTerminalCount = vscode.window.terminals.length;

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => {
      state.activeTerminalCount += 1;
      console.log(
        `CodeTrackr: Terminal opened (active=${state.activeTerminalCount})`
      );
    }),
    vscode.window.onDidCloseTerminal(() => {
      state.activeTerminalCount = Math.max(0, state.activeTerminalCount - 1);
      console.log(
        `CodeTrackr: Terminal closed (active=${state.activeTerminalCount})`
      );
    })
  );

  // terminal command tracking handled by TerminalTracker
}

// --------- Activity Tracking ----------
async function sendActivity(
  minutes: number,
  fileOpened?: string
): Promise<void> {
  const { apiBase, apiKey } = getCfg();

  const fullPath =
    fileOpened ||
    vscode.window.activeTextEditor?.document?.fileName ||
    "unknown";
  const { fileType, projectName, language } = getFileMeta(fullPath);

  const event: Omit<ActivityEvent, "timestamp" | "sessionId" | "eventId" | "retryCount"> = {
    eventType: "activity_tracked",
    sourceModule: "activity",
    data: {
      fileName: path.basename(fullPath),
      fileType: fileType || "unknown",
      projectName: projectName || "unknown",
      language: language || "unknown",
      duration: Number((minutes * 60).toFixed(0)), // Convert to seconds
      linesAdded: state.linesAdded,
      linesRemoved: state.linesRemoved,
    },
  };

  const terminalAnalytics = terminalTracker?.consumeInterval() || {
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
    lastCommand: "unknown",
    lastCommandTimestamp: null,
  };

  logger.log(event);
  const payload = {
    timestamp: new Date().toISOString(),
    fileName: path.basename(fullPath),
    fileType: fileType || "unknown",
    projectName: projectName || "unknown",
    language: language || "unknown",
    duration: Number((minutes * 60).toFixed(0)),
    linesAdded: state.linesAdded,
    linesRemoved: state.linesRemoved,
    terminalAnalytics,
  };

  console.log("CodeTrackr: Preparing to send payload:", payload);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    await axios.post(`${apiBase}/api/extension/track`, payload, { headers });
    console.log("✅ Flushed:", {
      response: { success: true, message: "Activity tracked successfully" },
      terminalAnalytics,
    });
    vscode.window.setStatusBarMessage("CodeTrackr: Activity tracked ✅", 2000);
  } catch (err: any) {
    const errorMsg = err?.response?.data?.message || err?.message || err;
    const statusCode = err?.response?.status || "Unknown";
    console.error("❌ Upload failed:", errorMsg);
    console.error("❌ Status code:", statusCode);
    console.error("❌ Full error:", err?.response?.data || err);
    vscode.window.setStatusBarMessage(`CodeTrackr: flush failed (${statusCode}) 🔁`, 3000);
  }

  // Reset line counters
  state.linesAdded = 0;
  state.linesRemoved = 0;
}

async function flushIfNeeded(force: boolean = false): Promise<void> {
  if (!state.startedMs) return;

  const elapsedFromStartMin = minutesSince(state.startedMs);
  const idleMin = minutesSince(state.lastActivityMs);

  if (!force && idleMin >= 2) {
    console.log(
      "CodeTrackr: Skipping flush - user idle for",
      idleMin.toFixed(2),
      "minutes"
    );
    return;
  }

  const totalBuffered = state.bufferedMinutes + elapsedFromStartMin;
  const { minFlushMinutes } = getCfg();

  if (!force && totalBuffered < minFlushMinutes) return;

  const fileOpened =
    vscode.window.activeTextEditor?.document?.fileName ||
    state.lastKnownFile ||
    "unknown";

  try {
    await sendActivity(totalBuffered, fileOpened);
    state.startedMs = Date.now();
    state.bufferedMinutes = 0;
  } catch {
    state.bufferedMinutes = totalBuffered;
    state.startedMs = Date.now();
  }
}

// --------- Core Functions ----------
function start(context: vscode.ExtensionContext): void {
  if (state.timer) {
    vscode.window.setStatusBarMessage("CodeTrackr: already running ⏱️", 2000);
    return;
  }

  const { flushIntervalSeconds } = getCfg();
  state.startedMs = Date.now();
  markActivity();

  // Initialize line counts
  vscode.workspace.textDocuments.forEach(initLineCountForDocument);

  // Register text document listeners
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      initLineCountForDocument(doc);
      markActivity(doc.fileName);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      initLineCountForDocument(doc);
      markActivity(doc.fileName);
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed?.document) {
        initLineCountForDocument(ed.document);
        markActivity(ed.document.fileName);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      try {
        const doc = event.document;
        const file = doc.fileName;
        const prev = lineCounts.get(file) ?? doc.lineCount;
        const now = doc.lineCount;
        const delta = now - prev;

        if (delta > 0) state.linesAdded += delta;
        else if (delta < 0) state.linesRemoved += Math.abs(delta);

        lineCounts.set(file, now);
      } catch {
        for (const c of event.contentChanges || []) {
          const newLines = (c.text.match(/\n/g) || []).length;
          const removedLines = c.range
            ? c.range.end.line - c.range.start.line
            : 0;
          const net = newLines - removedLines;
          if (net > 0) state.linesAdded += net;
          else if (net < 0) state.linesRemoved += Math.abs(net);
        }
      }
      markActivity(event.document.fileName);
    })
  );

  // Auto flush every 30 seconds
  state.timer = setInterval(() => {
    const idleMin = minutesSince(state.lastActivityMs);

    if (!state.isPaused && idleMin >= 2) {
      console.log(
        `CodeTrackr: Idle for ${idleMin.toFixed(2)} minutes. Pausing tracking.`
      );

      if (state.startedMs) {
        const activeDurationMs = state.lastActivityMs - state.startedMs;
        const activeDurationMin = activeDurationMs / 60000;

        if (activeDurationMin > getCfg().minFlushMinutes) {
          console.log(
            `CodeTrackr: Flushing ${activeDurationMin.toFixed(2)} minutes of active time before pausing.`
          );
          sendActivity(activeDurationMin, state.lastKnownFile).catch(() => {});
        }
      }

      state.isPaused = true;
      state.startedMs = undefined;
      state.bufferedMinutes = 0;
      vscode.window.setStatusBarMessage("CodeTrackr: Paused (idle) ⏸️", 4000);
      return;
    }

    if (state.isPaused) {
      return;
    }

    flushIfNeeded(false).catch(() => {});
  }, flushIntervalSeconds * 1000);

  vscode.window.setStatusBarMessage("CodeTrackr: started ⏳", 3000);
}

function stop(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  state.startedMs = undefined;
  state.bufferedMinutes = 0;
  state.isPaused = false;
  vscode.window.setStatusBarMessage("CodeTrackr: stopped 🛑", 2000);
}

async function flushNow(): Promise<void> {
  await flushIfNeeded(true);
}

// --------- VS Code Hooks ----------
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log("💻 CodeTrackr extension activated");

  try {
    initializeTelemetry(context);

    // Initialize logger
    const debug = vscode.workspace
      .getConfiguration("codetrackr")
      .get<boolean>("debug", false);
    logger = createEventLogger(debug);
    console.log(`📋 Event logger initialized (sessionId: ${logger["sessionId"]})`);

    // Initialize sync service
    const { apiBase } = getCfg();
    syncService = createSyncService(logger, apiBase);
    await syncService.restoreFailedBatches(context);
    syncService.start();
    console.log(`🔄 Sync service started`);

    // Initialize trackers
    debugTracker = createDebugTracker(logger);
    debugTracker.start(context);

    terminalTracker = createTerminalTracker();
    terminalTracker.start(context);

    // Register commands
    const cmdStart = vscode.commands.registerCommand("codetrackr.start", () =>
      start(context)
    );
    const cmdStop = vscode.commands.registerCommand("codetrackr.stop", () =>
      stop()
    );
    const cmdFlush = vscode.commands.registerCommand("codetrackr.flushNow", () =>
      flushNow()
    );
    const cmdShowStats = vscode.commands.registerCommand(
      "codetrackr.showStats",
      () => showStats()
    );
    const cmdShowLogs = vscode.commands.registerCommand(
      "codetrackr.showLogs",
      () => {
        logger.showOutput();
        syncService.showOutput();
      }
    );

    context.subscriptions.push(
      cmdStart,
      cmdStop,
      cmdFlush,
      cmdShowStats,
      cmdShowLogs
    );

    // Start tracking
    start(context);

    vscode.window.setStatusBarMessage(
      "CodeTrackr: Initialized (tracking activity, debug, git, errors)",
      4000
    );
  } catch (err) {
    console.error("❌ Extension activation failed:", err);
    vscode.window.showErrorMessage(
      `CodeTrackr: Activation failed - ${err}`
    );
  }
}

export async function deactivate(): Promise<void> {
  console.log("🔌 CodeTrackr extension deactivating");

  try {
    stop();

    debugTracker?.stop();
    terminalTracker?.stop();

    syncService?.stop();
    await syncService?.persistFailedBatches({
      globalState: {
        get: () => undefined,
        update: () => Promise.resolve(),
      },
    } as any);
  } catch (err) {
    console.error("❌ Error during deactivation:", err);
  }
}

// --------- UI Commands ----------
function showStats(): void {
  const loggerStats = logger.getStats();
  const syncStats = syncService.getStats();
  const debugSessions = debugTracker.getActiveSessions();
  const terminalSnapshot = terminalTracker?.getIntervalSnapshot();

  const message = `
CodeTrackr Statistics
=====================
Logger: ${loggerStats.queueSize} queued, ${loggerStats.sentEventCount} sent
Sync: ${syncStats.isRunning ? "Running" : "Stopped"}, ${syncStats.failedBatchCount} failed batches
Debug Sessions: ${debugSessions.length} active
Terminal Commands: ${terminalSnapshot?.totalCommands ?? 0}
Terminal Errors: ${terminalSnapshot?.terminalErrorCount ?? 0}
  `;

  vscode.window.showInformationMessage(message);
}
