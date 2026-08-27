/**
 * CodeTrackr VS Code Extension - Main Entry Point (TypeScript)
 * Tracks coding activity, terminal analytics and debug sessions, and flushes
 * them to the CodeTrackr backend via POST /api/extension/track.
 */

import * as vscode from "vscode";
import axios from "axios";
import * as path from "path";
import { DebugTracker, createDebugTracker } from "./debugTracker";
import { TerminalTracker, createTerminalTracker } from "./terminalTracker";
import { EditorTracker, createEditorTracker } from "./editorTracker";
import { FocusTracker, createFocusTracker } from "./focusTracker";

// Production endpoints. These are the fallbacks used when the user has not
// overridden `codetrackr.apiBase`; the manifest default must match.
const DEFAULT_API_BASE = "https://codetrackr-backend-uckp.onrender.com";
const DASHBOARD_URL = "https://code-trackr-frontend.vercel.app";

// The backend rejects a falsy duration, and a single flush covers at most a
// few minutes, so anything outside this range is a bug or a clock jump.
const MIN_FLUSH_SECONDS = 1;
const MAX_FLUSH_SECONDS = 3600;

const IDLE_PAUSE_MINUTES = 2;

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
}

const state: AppState = {
  lastActivityMs: Date.now(),
  bufferedMinutes: 0,
  lastKnownFile: "unknown",
  linesAdded: 0,
  linesRemoved: 0,
  activeTerminalCount: vscode.window.terminals.length,
  isPaused: false,
};

// Track previous line counts per file
const lineCounts = new Map<string, number>();
let telemetryInitialized = false;

// Only nag about a missing/rejected API key once per session.
let authWarningShown = false;

// Trackers
let debugTracker: DebugTracker;
let terminalTracker: TerminalTracker;

// --------- Config Helpers ----------
function getCfg() {
  const cfg = vscode.workspace.getConfiguration("codetrackr");
  const flushIntervalSeconds = Number(cfg.get<number>("flushIntervalSeconds"));
  const minFlushMinutes = Number(cfg.get<number>("minFlushMinutes"));

  return {
    apiBase: (cfg.get<string>("apiBase") || DEFAULT_API_BASE).replace(/\/+$/, ""),
    apiKey: (cfg.get<string>("apiKey") || "").trim(),
    // Honour the user's configured values (these were previously hardcoded,
    // so the contributed settings did nothing).
    flushIntervalSeconds: Number.isFinite(flushIntervalSeconds)
      ? Math.max(5, flushIntervalSeconds)
      : 30,
    minFlushMinutes: Number.isFinite(minFlushMinutes)
      ? Math.max(0.1, minFlushMinutes)
      : 0.5,
  };
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

function emptyTerminalAnalytics() {
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
    repeatedFailedCommands: [] as Array<{ command: string; count: number }>,
    lastCommand: "unknown",
    lastCommandTimestamp: null as string | null,
  };
}

function initializeTelemetry(context: vscode.ExtensionContext): void {
  if (telemetryInitialized) return;
  telemetryInitialized = true;

  state.activeTerminalCount = vscode.window.terminals.length;

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => {
      state.activeTerminalCount += 1;
    }),
    vscode.window.onDidCloseTerminal(() => {
      state.activeTerminalCount = Math.max(0, state.activeTerminalCount - 1);
    })
  );
}

/** Prompt once per session when the backend rejects our credentials. */
function warnAboutAuth(message: string): void {
  if (authWarningShown) return;
  authWarningShown = true;

  vscode.window
    .showWarningMessage(`CodeTrackr: ${message}`, "Set API Key", "Open Dashboard")
    .then((choice) => {
      if (choice === "Set API Key") {
        vscode.commands.executeCommand("codetrackr.setupApiKey");
      } else if (choice === "Open Dashboard") {
        vscode.env.openExternal(vscode.Uri.parse(`${DASHBOARD_URL}/profile`));
      }
    });
}

// --------- Activity Tracking ----------
async function sendActivity(minutes: number, fileOpened?: string): Promise<void> {
  const { apiBase, apiKey } = getCfg();

  const durationSeconds = Math.round(minutes * 60);

  // Below one second the backend treats the duration as missing and 400s, so
  // keep the buffered lines and let the next flush carry them.
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_FLUSH_SECONDS) {
    return;
  }
  if (durationSeconds > MAX_FLUSH_SECONDS) {
    console.warn(
      `CodeTrackr: implausible duration ${durationSeconds}s (clock jump?), skipping flush`
    );
    state.linesAdded = 0;
    state.linesRemoved = 0;
    return;
  }

  if (!apiKey) {
    warnAboutAuth("no API key is configured, so your activity is not being saved.");
    return;
  }

  const fullPath =
    fileOpened || vscode.window.activeTextEditor?.document?.fileName || "unknown";
  const { fileType, projectName, language } = getFileMeta(fullPath);

  const terminalAnalytics = terminalTracker?.consumeInterval() || emptyTerminalAnalytics();

  // Debug sessions used to be logged into a pipeline that never reached the
  // backend; fold them into the field the Activity schema already stores.
  const debugCounts = debugTracker?.consumeInterval();
  if (debugCounts) {
    terminalAnalytics.debuggingSessions += debugCounts.debugSessions;
  }

  const payload = {
    // The flush covers the interval that just ended, so stamp it with the
    // interval's start. Stamping "now" pushed every session forward and
    // skewed hour-of-day analytics.
    timestamp: new Date(Date.now() - durationSeconds * 1000).toISOString(),
    fileName: path.basename(fullPath),
    fileType: fileType || "unknown",
    projectName: projectName || "unknown",
    language: language || "unknown",
    duration: durationSeconds,
    linesAdded: state.linesAdded,
    linesRemoved: state.linesRemoved,
    terminalAnalytics,
  };

  try {
    await axios.post(`${apiBase}/api/extension/track`, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      timeout: 15000,
    });

    authWarningShown = false;
    vscode.window.setStatusBarMessage("CodeTrackr: Activity tracked ✅", 2000);
  } catch (err: any) {
    const statusCode = err?.response?.status;
    const errorMsg = err?.response?.data?.message || err?.message || String(err);
    console.error(`CodeTrackr: upload failed (${statusCode ?? "network"}): ${errorMsg}`);

    if (statusCode === 401) {
      warnAboutAuth("your API key was rejected. Generate a new one from your profile.");
    } else {
      vscode.window.setStatusBarMessage(
        `CodeTrackr: flush failed (${statusCode ?? "offline"}) 🔁`,
        3000
      );
    }
  }

  // Reset line counters
  state.linesAdded = 0;
  state.linesRemoved = 0;
}

async function flushIfNeeded(force: boolean = false): Promise<void> {
  if (!state.startedMs) return;

  const elapsedFromStartMin = minutesSince(state.startedMs);
  const idleMin = minutesSince(state.lastActivityMs);

  if (!force && idleMin >= IDLE_PAUSE_MINUTES) return;

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

  vscode.workspace.textDocuments.forEach(initLineCountForDocument);

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
          const removedLines = c.range ? c.range.end.line - c.range.start.line : 0;
          const net = newLines - removedLines;
          if (net > 0) state.linesAdded += net;
          else if (net < 0) state.linesRemoved += Math.abs(net);
        }
      }
      markActivity(event.document.fileName);
    })
  );

  state.timer = setInterval(() => {
    const idleMin = minutesSince(state.lastActivityMs);

    if (!state.isPaused && idleMin >= IDLE_PAUSE_MINUTES) {
      if (state.startedMs) {
        const activeDurationMin = (state.lastActivityMs - state.startedMs) / 60000;
        if (activeDurationMin > getCfg().minFlushMinutes) {
          sendActivity(activeDurationMin, state.lastKnownFile).catch(() => {});
        }
      }

      state.isPaused = true;
      state.startedMs = undefined;
      state.bufferedMinutes = 0;
      vscode.window.setStatusBarMessage("CodeTrackr: Paused (idle) ⏸️", 4000);
      return;
    }

    if (state.isPaused) return;

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

// --------- UI Commands ----------
async function setupApiKey(): Promise<void> {
  const { apiBase } = getCfg();

  const entered = await vscode.window.showInputBox({
    title: "CodeTrackr API Key",
    prompt: `Paste the API key from your profile page (${DASHBOARD_URL}/profile)`,
    placeHolder: "64-character key from your CodeTrackr profile",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value && value.trim().length >= 16
        ? undefined
        : "That doesn't look like a CodeTrackr API key.",
  });

  if (!entered) return;
  const apiKey = entered.trim();

  await vscode.workspace
    .getConfiguration("codetrackr")
    .update("apiKey", apiKey, vscode.ConfigurationTarget.Global);

  try {
    const res = await axios.get(`${apiBase}/api/extension/verify`, {
      headers: { "x-api-key": apiKey },
      timeout: 15000,
    });
    const who = res.data?.user?.name || res.data?.user?.email || "your account";
    authWarningShown = false;
    vscode.window.showInformationMessage(
      `CodeTrackr: API key saved and verified — connected as ${who}.`
    );
  } catch (err: any) {
    if (err?.response?.status === 401) {
      vscode.window.showErrorMessage(
        "CodeTrackr: that API key was rejected. Generate a new one from your profile page."
      );
    } else {
      vscode.window.showWarningMessage(
        `CodeTrackr: key saved, but ${apiBase} could not be reached (${err?.message}). Tracking will retry automatically.`
      );
    }
  }
}

async function showInfo(): Promise<void> {
  const { apiBase, apiKey, flushIntervalSeconds, minFlushMinutes } = getCfg();

  const masked = apiKey
    ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (${apiKey.length} chars)`
    : "not set";

  let status: string;
  if (!apiKey) {
    status = "no API key set ❌";
  } else {
    try {
      await axios.get(`${apiBase}/api/extension/verify`, {
        headers: { "x-api-key": apiKey },
        timeout: 15000,
      });
      status = "connected ✅";
    } catch (err: any) {
      status =
        err?.response?.status === 401
          ? "API key rejected ❌"
          : `unreachable (${err?.message}) ⚠️`;
    }
  }

  const choice = await vscode.window.showInformationMessage(
    `CodeTrackr — Backend: ${apiBase} · API key: ${masked} · Status: ${status} · ` +
      `Flush every ${flushIntervalSeconds}s (min ${minFlushMinutes} min)`,
    "Set API Key",
    "Open Dashboard"
  );

  if (choice === "Set API Key") {
    await setupApiKey();
  } else if (choice === "Open Dashboard") {
    await vscode.env.openExternal(vscode.Uri.parse(`${DASHBOARD_URL}/dashboard`));
  }
}

function showStats(): void {
  const debugSessions = debugTracker?.getActiveSessions() ?? [];
  const debugSnapshot = debugTracker?.getIntervalSnapshot();
  const terminalSnapshot = terminalTracker?.getIntervalSnapshot();
  const { apiBase } = getCfg();

  const pending = state.startedMs
    ? (state.bufferedMinutes + minutesSince(state.startedMs)).toFixed(2)
    : "0.00";

  vscode.window.showInformationMessage(
    `CodeTrackr — Backend: ${apiBase} · ` +
      `${state.isPaused ? "Paused (idle)" : state.timer ? "Tracking" : "Stopped"} · ` +
      `Pending: ${pending} min · Lines +${state.linesAdded}/-${state.linesRemoved} · ` +
      `Terminal: ${terminalSnapshot?.totalCommands ?? 0} commands, ` +
      `${terminalSnapshot?.terminalErrorCount ?? 0} errors · ` +
      `Debug: ${debugSessions.length} active, ${debugSnapshot?.debugSessions ?? 0} this interval`
  );
}

// --------- VS Code Hooks ----------
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log("💻 CodeTrackr extension activated");

  try {
    initializeTelemetry(context);

    debugTracker = createDebugTracker();
    debugTracker.start(context);

    terminalTracker = createTerminalTracker();
    terminalTracker.start(context);

    context.subscriptions.push(
      vscode.commands.registerCommand("codetrackr.start", () => start(context)),
      vscode.commands.registerCommand("codetrackr.stop", () => stop()),
      vscode.commands.registerCommand("codetrackr.flushNow", () => flushNow()),
      vscode.commands.registerCommand("codetrackr.showStats", () => showStats()),
      vscode.commands.registerCommand("codetrackr.showLogs", () => showStats()),
      vscode.commands.registerCommand("codetrackr.setupApiKey", () => setupApiKey()),
      vscode.commands.registerCommand("codetrackr.showInfo", () => showInfo())
    );

    // Restart the flush timer when the interval setting changes, otherwise the
    // new value would not take effect until the next window reload.
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codetrackr.flushIntervalSeconds")) {
          if (state.timer) {
            stop();
            start(context);
          }
        }
        if (event.affectsConfiguration("codetrackr.apiKey")) {
          authWarningShown = false;
        }
      })
    );

    start(context);

    if (!getCfg().apiKey) {
      warnAboutAuth("no API key is configured yet. Set one to start saving your activity.");
    }
  } catch (err) {
    console.error("❌ Extension activation failed:", err);
    vscode.window.showErrorMessage(`CodeTrackr: Activation failed - ${err}`);
  }
}

export async function deactivate(): Promise<void> {
  console.log("🔌 CodeTrackr extension deactivating");

  try {
    // Best-effort final flush so the tail of the session is not lost.
    await flushIfNeeded(true);
  } catch {
    // ignore
  }

  try {
    stop();
    debugTracker?.stop();
    terminalTracker?.stop();
  } catch (err) {
    console.error("❌ Error during deactivation:", err);
  }
}

// Re-exported so tests can exercise the trackers through the built bundle.
export { EditorTracker, FocusTracker };
