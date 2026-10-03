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
import { GitStateTracker, createGitStateTracker } from "./gitStateTracker";
import { Outbox, SendResult } from "./outbox";
import { randomUUID } from "crypto";

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
  activeTerminalCount: number;
  isPaused: boolean;
}

const state: AppState = {
  lastActivityMs: Date.now(),
  bufferedMinutes: 0,
  lastKnownFile: "unknown",
  activeTerminalCount: vscode.window.terminals.length,
  isPaused: false,
};

let telemetryInitialized = false;

/**
 * Signal-less interval (reading, no edits/commands/commits) waiting to be
 * merged into the NEXT interval. The two are contiguous, so merging is exact:
 * earliest start, summed duration. `buildPayload` resets the trackers, so
 * this is where those counters live until then.
 */
let carry: any = null;

/**
 * Uploads that have signal but have not reached the server, persisted in
 * globalState and sent oldest first, each with its own flushId (item 8).
 * Replaced with the persisted one in activate().
 */
let outbox = new Outbox();

// Only nag about a missing/rejected API key once per session.
let authWarningShown = false;

// Trackers
let debugTracker: DebugTracker;
let terminalTracker: TerminalTracker;
let editorTracker: EditorTracker;
let focusTracker: FocusTracker;
let gitStateTracker: GitStateTracker;

// --------- API key (SecretStorage) ----------
// The key is a credential, so it lives in VS Code SecretStorage (the OS
// keychain), not in settings.json where it was plaintext and could be synced
// or committed with a dotfiles repo. Reads are async, so it is cached here.
const SECRET_KEY = "codetrackr.apiKey";
let secretStorage: vscode.SecretStorage | undefined;
let cachedApiKey = "";

/** Load the key; move a key left in settings.json by an older version. */
async function loadApiKey(context: vscode.ExtensionContext): Promise<void> {
  secretStorage = context.secrets;
  if (!secretStorage) return; // very old host: fall back to settings.json
  const cfg = vscode.workspace.getConfiguration("codetrackr");
  const fromSettings = (cfg.get<string>("apiKey") || "").trim();
  let stored = ((await secretStorage.get(SECRET_KEY)) || "").trim();
  if (!stored && fromSettings) {
    await secretStorage.store(SECRET_KEY, fromSettings);
    stored = fromSettings;
  }
  if (stored && fromSettings) {
    await cfg.update("apiKey", undefined, vscode.ConfigurationTarget.Global);
  }
  cachedApiKey = stored;
  context.subscriptions.push(
    secretStorage.onDidChange(async (e) => {
      if (e.key === SECRET_KEY) cachedApiKey = ((await secretStorage!.get(SECRET_KEY)) || "").trim();
    })
  );
}

async function saveApiKey(apiKey: string): Promise<void> {
  if (secretStorage) {
    await secretStorage.store(SECRET_KEY, apiKey);
    cachedApiKey = apiKey;
    await vscode.workspace
      .getConfiguration("codetrackr")
      .update("apiKey", undefined, vscode.ConfigurationTarget.Global);
  } else {
    await vscode.workspace
      .getConfiguration("codetrackr")
      .update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
  }
}

// --------- Config Helpers ----------
function getCfg() {
  const cfg = vscode.workspace.getConfiguration("codetrackr");
  const flushIntervalSeconds = Number(cfg.get<number>("flushIntervalSeconds"));
  const minFlushMinutes = Number(cfg.get<number>("minFlushMinutes"));

  return {
    apiBase: (cfg.get<string>("apiBase") || DEFAULT_API_BASE).replace(/\/+$/, ""),
    apiKey: cachedApiKey || (cfg.get<string>("apiKey") || "").trim(),
    // Honour the user's configured values (these were previously hardcoded,
    // so the contributed settings did nothing).
    flushIntervalSeconds: Number.isFinite(flushIntervalSeconds)
      ? Math.max(5, flushIntervalSeconds)
      : 30,
    minFlushMinutes: Number.isFinite(minFlushMinutes)
      ? Math.max(0.1, minFlushMinutes)
      : 2,
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
  focusTracker?.noteActivity(state.lastActivityMs);

  if (state.isPaused) {
    state.isPaused = false;
    state.startedMs = Date.now();
    state.bufferedMinutes = 0;
    // Resume the samplers. They banked nothing while paused, so the idle gap
    // is not back-filled into focusedMs / readMs.
    focusTracker?.setPaused(false);
    editorTracker?.setPaused(false);
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

function minutesSince(ms: number): number {
  return (Date.now() - ms) / 60000;
}

/**
 * True if a built payload carries any real coding signal. Mirrors the backend
 * `hasSignal` in services/activityBucket.js. A flush with no signal is held
 * (the buffered time carries forward) rather than sent.
 */
export function payloadHasSignal(payload: any): boolean {
  const e = payload?.editorAnalytics || {};
  const t = payload?.terminalAnalytics || {};
  const g = payload?.gitAnalytics || {};
  const f = payload?.focusAnalytics || {};
  const n = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return (
    n(e.charsInserted) > 0 || n(e.charsDeleted) > 0 || n(e.saveCount) > 0 ||
    n(e.linesInserted) > 0 || n(e.linesDeleted) > 0 ||
    n(t.totalCommands) > 0 || n(g.commits) > 0 ||
    (Array.isArray(f.flowBlocksMs) && f.flowBlocksMs.length > 0)
  );
}

/**
 * Additively merge two flush payloads.
 *
 * `buildPayload` *consumes* (resets) every tracker, so any bail-out after that
 * point used to destroy the counters permanently: a signal-less interval, a
 * missing API key, an out-of-range duration, or a failed upload all silently
 * dropped the data. Unsent payloads are now merged forward into the next flush
 * instead. Pure and exported so the merge rules are unit-testable.
 *
 * Rules: counters sum; `flowBlocksMs` concatenates (capped at 200, matching the
 * backend normaliser); `longestBlockMs`/`uniqueFiles` take the max; the
 * point-in-time git gauges and `lastCommand*` prefer the newer non-empty value;
 * `successRate`/`buildSuccessRate` are recomputed from the merged counts
 * because averaging percentages is meaningless.
 */
export function mergeAnalytics(base: any, incoming: any): any {
  if (!base) return incoming;
  if (!incoming) return base;

  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const MAX_KEYS = new Set(["longestBlockMs", "uniqueFiles"]);
  const NEWER_KEYS = new Set([
    "uncommittedFiles", "uncommittedAgeMs", "lastCommand", "lastCommandTimestamp",
    "fileName", "fileType", "projectName", "language",
  ]);
  const RATE_KEYS = new Set(["successRate", "buildSuccessRate"]);

  const merge = (a: any, b: any): any => {
    const out: any = { ...a };
    for (const key of Object.keys(b || {})) {
      const av = a?.[key];
      const bv = b[key];

      if (RATE_KEYS.has(key)) { out[key] = bv; continue; } // recomputed below
      if (key === "timestamp") {
        // Merged intervals are contiguous: the result starts at the EARLIER one.
        // (Taking the newer one filed held time late — part of M-30.)
        const at = Date.parse(av);
        const bt = Date.parse(bv);
        out[key] = Number.isFinite(at) && (!Number.isFinite(bt) || at <= bt) ? av : bv;
        continue;
      }
      if (NEWER_KEYS.has(key)) {
        out[key] = bv !== undefined && bv !== null && bv !== 0 && bv !== "" && bv !== "unknown"
          ? bv : av;
        continue;
      }
      if (key === "repeatedFailedCommands") {
        const counts = new Map<string, number>();
        for (const entry of [...(av || []), ...(bv || [])]) {
          if (!entry?.command) continue;
          counts.set(entry.command, (counts.get(entry.command) || 0) + num(entry.count));
        }
        out[key] = [...counts].map(([command, count]) => ({ command, count }));
        continue;
      }
      if (Array.isArray(bv)) {
        out[key] = [...(Array.isArray(av) ? av : []), ...bv].slice(-200);
        continue;
      }
      if (bv && typeof bv === "object") { out[key] = merge(av || {}, bv); continue; }
      if (typeof bv === "number") {
        out[key] = MAX_KEYS.has(key) ? Math.max(num(av), num(bv)) : num(av) + num(bv);
        continue;
      }
      out[key] = bv !== undefined ? bv : av;
    }
    return out;
  };

  const merged = merge(base, incoming);

  const t = merged.terminalAnalytics;
  if (t) {
    t.successRate = num(t.totalCommands) > 0
      ? Math.round((num(t.successfulCommands) / num(t.totalCommands)) * 100) : 0;
    t.buildSuccessRate = num(t.buildRuns) > 0
      ? Math.round((num(t.successfulBuilds) / num(t.buildRuns)) * 100) : 0;
  }
  // The merged interval starts at the earlier of the two (handled in merge()).
  // It used to be re-stamped as now − total duration, which moved held time
  // later than it happened (M-30).
  merged.duration = num(base.duration) + num(incoming.duration);
  return merged;
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
    .showWarningMessage(`CodeTrackr: ${message}`, "Sign In", "Set API Key", "Open Dashboard")
    .then((choice) => {
      if (choice === "Sign In") {
        vscode.commands.executeCommand("codetrackr.signIn");
      } else if (choice === "Set API Key") {
        vscode.commands.executeCommand("codetrackr.setupApiKey");
      } else if (choice === "Open Dashboard") {
        vscode.env.openExternal(vscode.Uri.parse(`${DASHBOARD_URL}/profile`));
      }
    });
}

function emptyEditorAnalytics() {
  return {
    charsInserted: 0, charsDeleted: 0, linesInserted: 0, linesDeleted: 0,
    churnLines: 0, undoCount: 0, redoCount: 0, saveCount: 0,
    fileSwitches: 0, uniqueFiles: 0, readMs: 0, writeMs: 0,
    largeInsertCount: 0, largeInsertChars: 0,
  };
}

function emptyFocusAnalytics() {
  return {
    focusedMs: 0, blurredMs: 0, blurEvents: 0,
    flowBlocksMs: [] as number[], longestBlockMs: 0,
  };
}

function emptyGitAnalytics() {
  return { commits: 0, filesChanged: 0, uncommittedFiles: 0, uncommittedAgeMs: 0 };
}

/** Composes the flush payload. Exported for tests via buildPayloadForTest. */
function buildPayload(durationSeconds: number, fileOpened?: string) {
  const fullPath =
    fileOpened || vscode.window.activeTextEditor?.document?.fileName || "unknown";
  const { fileType, projectName, language } = getFileMeta(fullPath);

  const terminalAnalytics = terminalTracker?.consumeInterval() || emptyTerminalAnalytics();
  const editorAnalytics = editorTracker?.consumeInterval() || emptyEditorAnalytics();
  const focusAnalytics = focusTracker?.consumeInterval() || emptyFocusAnalytics();
  const gitAnalytics = gitStateTracker?.consumeInterval() || emptyGitAnalytics();

  // Debug sessions used to be logged into a pipeline that never reached the
  // backend; fold them into the field the Activity schema already stores.
  const debugCounts = debugTracker?.consumeInterval();
  if (debugCounts) {
    terminalAnalytics.debuggingSessions += debugCounts.debugSessions;
  }

  return {
    // The flush covers the interval that just ended, so stamp it with the
    // interval's start. Stamping "now" pushed every session forward and
    // skewed hour-of-day analytics.
    timestamp: new Date(Date.now() - durationSeconds * 1000).toISOString(),
    fileName: path.basename(fullPath),
    fileType: fileType || "unknown",
    projectName: projectName || "unknown",
    language: language || "unknown",
    duration: durationSeconds,
    // Kept for backend compatibility, now sourced from gross counters.
    linesAdded: editorAnalytics.linesInserted,
    linesRemoved: editorAnalytics.linesDeleted,
    terminalAnalytics,
    editorAnalytics,
    focusAnalytics,
    gitAnalytics,
  };
}

/** Test seam: build a payload without performing the network call. */
export function buildPayloadForTest(durationSeconds: number) {
  return buildPayload(durationSeconds);
}

/**
 * Drain the trackers, plus any carried signal-less interval, into one payload.
 * Every real flush path goes through this so no caller can forget the carry.
 */
function takePayload(durationSeconds: number, fileOpened?: string) {
  const fresh = buildPayload(durationSeconds, fileOpened);
  const merged = carry ? mergeAnalytics(carry, fresh) : fresh;
  carry = null;
  return merged;
}

/** Keep a signal-less interval for the next flush (contiguous, so merged exactly). */
function carryForward(payload: any): void {
  carry = carry ? mergeAnalytics(carry, payload) : payload;
  // A long stretch of pure reading would grow past what one upload may claim;
  // queue it on its own before it gets there instead of losing it.
  if (carry.duration >= MAX_FLUSH_SECONDS - 600) {
    const long = carry;
    carry = null;
    void queueUpload(long);
  }
}

/** Give a finished interval its idempotency key, persist it, try to send. */
async function queueUpload(payload: any): Promise<void> {
  if (!payload.flushId) payload.flushId = randomUUID();
  await outbox.enqueue(payload);
  await drainOutbox();
}

function drainOutbox(): Promise<void> {
  return outbox.drain(sendActivity);
}

/** Test seam: the carry buffer and the queue. */
export function getCarryForTest() {
  return carry;
}
export function getOutboxForTest() {
  return outbox;
}

// --------- Activity Tracking ----------
/**
 * Upload one queued payload.
 * @returns "ok" when the server has it (accepted, or a duplicate of an earlier
 * send), "drop" when the server will never accept it, "retry" when it is worth
 * trying again later (offline, 5xx, rate-limited, no key yet).
 */
async function sendActivity(payload: any): Promise<SendResult> {
  const { apiBase, apiKey } = getCfg();

  const durationSeconds = payload.duration;

  // Below one second the backend treats the duration as missing and 400s.
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_FLUSH_SECONDS) {
    return "drop";
  }
  if (durationSeconds > MAX_FLUSH_SECONDS) {
    // A clock jump would poison the bucket, and the backend rejects it anyway.
    // Drop it deliberately rather than carrying a poisoned payload forever.
    console.warn(
      `CodeTrackr: implausible duration ${durationSeconds}s (clock jump?), dropping flush`
    );
    return "drop";
  }

  if (!apiKey) {
    warnAboutAuth("no API key is configured yet. Your activity is queued and will upload once you set one.");
    return "retry";
  }

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
    return "ok";
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
    // A 400 means the backend will never accept this payload — keeping it would
    // block the queue behind it forever. Anything else is transient.
    return statusCode === 400 ? "drop" : "retry";
  }
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

  const payload = takePayload(Math.round(totalBuffered * 60), fileOpened);

  state.startedMs = Date.now();
  state.bufferedMinutes = 0;

  // Nothing happened this interval (window focused but no edits/commands/
  // commits). The trackers are already drained, so the counters are carried
  // into the next interval rather than destroyed.
  if (!force && !payloadHasSignal(payload)) {
    carryForward(payload);
    return;
  }

  // Persisted before the network call: a failed upload, a restart or a crash
  // can no longer lose the interval.
  await queueUpload(payload);
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

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => markActivity(doc.fileName)),
    vscode.workspace.onDidSaveTextDocument((doc) => markActivity(doc.fileName)),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed?.document) markActivity(ed.document.fileName);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Edit volume is accumulated by EditorTracker; this only refreshes idle
      // state. The previous net doc.lineCount delta recorded zero for any
      // replace-in-place edit and has been removed.
      markActivity(event.document.fileName);
    })
  );

  state.timer = setInterval(() => {
    const idleMin = minutesSince(state.lastActivityMs);

    if (!state.isPaused && idleMin >= IDLE_PAUSE_MINUTES) {
      if (state.startedMs) {
        // Only the time up to the last real activity is genuine work.
        const activeDurationMin = Math.max(
          0,
          (state.lastActivityMs - state.startedMs) / 60000
        );
        const idlePayload = takePayload(
          Math.round(activeDurationMin * 60),
          state.lastKnownFile
        );
        if (payloadHasSignal(idlePayload)) {
          queueUpload(idlePayload).catch(() => {});
        } else {
          // Below the flush threshold or signal-less: carry it forward rather
          // than dropping it with `bufferedMinutes = 0` below.
          carryForward(idlePayload);
        }
      }

      state.isPaused = true;
      state.startedMs = undefined;
      state.bufferedMinutes = 0;
      // Stop the focus/attention samplers banking the idle gap — they run on
      // their own intervals and used to inflate focusedMs/readMs by hours.
      focusTracker?.setPaused(true);
      editorTracker?.setPaused(true);
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
    placeHolder: "ct_… key from your CodeTrackr profile",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value && value.trim().length >= 16
        ? undefined
        : "That doesn't look like a CodeTrackr API key.",
  });

  if (!entered) return;
  const apiKey = entered.trim();

  await saveApiKey(apiKey);
  drainOutbox().catch(() => {});

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

/**
 * Sign in without copying a key (roadmap item 13): the device-code flow.
 * Ask the API for a short code, copy it, open the dashboard's approval page,
 * and poll until the signed-in user approves it. The key that comes back is a
 * per-device key, stored in SecretStorage like any other.
 */
async function signIn(): Promise<void> {
  const { apiBase } = getCfg();
  let start: any;
  try {
    start = (await axios.post(`${apiBase}/api/device/code`,
      { clientName: `VS Code (${process.platform})` }, { timeout: 15000 })).data;
  } catch (err: any) {
    vscode.window.showErrorMessage(`CodeTrackr: could not reach ${apiBase} to start sign-in (${err?.message}).`);
    return;
  }

  await vscode.env.clipboard.writeText(start.userCode);
  await vscode.env.openExternal(vscode.Uri.parse(start.verificationUriComplete || start.verificationUri));

  const deadline = Date.now() + Number(start.expiresIn || 600) * 1000;
  const intervalMs = Math.max(0, Number(start.interval ?? 5)) * 1000;

  const apiKey: string | undefined = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `CodeTrackr: approve code ${start.userCode} in your browser (copied to clipboard)`,
      cancellable: true,
    },
    async (_progress, token) => {
      while (!token.isCancellationRequested && Date.now() < deadline) {
        try {
          const res = await axios.post(`${apiBase}/api/device/token`,
            { deviceCode: start.deviceCode }, { timeout: 15000 });
          return res.data?.apiKey as string;
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 410) return undefined; // expired or already used
          // 428 authorization_pending, or a network blip: wait and ask again.
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      return undefined;
    }
  );

  if (!apiKey) {
    vscode.window.showWarningMessage("CodeTrackr: sign-in was not completed. Run \"CodeTrackr: Sign In\" to try again.");
    return;
  }
  await saveApiKey(apiKey);
  authWarningShown = false;
  drainOutbox().catch(() => {});
  vscode.window.showInformationMessage("CodeTrackr: signed in. This VS Code now uploads with its own key (see Profile > Connected devices).");
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
  const editorSnapshot = editorTracker?.getIntervalSnapshot();
  const focusSnapshot = focusTracker?.getIntervalSnapshot();
  const { apiBase } = getCfg();

  const pending = state.startedMs
    ? (state.bufferedMinutes + minutesSince(state.startedMs)).toFixed(2)
    : "0.00";

  vscode.window.showInformationMessage(
    `CodeTrackr — Backend: ${apiBase} · ` +
      `${state.isPaused ? "Paused (idle)" : state.timer ? "Tracking" : "Stopped"} · ` +
      `Pending: ${pending} min · Queued uploads: ${outbox.size} · ` +
      `Lines +${editorSnapshot?.linesInserted ?? 0}/-${editorSnapshot?.linesDeleted ?? 0} ` +
      `(churn ${editorSnapshot?.churnLines ?? 0}) · ` +
      `Focus: ${Math.round((focusSnapshot?.focusedMs ?? 0) / 60000)} min, ` +
      `longest block ${Math.round((focusSnapshot?.longestBlockMs ?? 0) / 60000)} min · ` +
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

    editorTracker = createEditorTracker();
    editorTracker.start(context);

    focusTracker = createFocusTracker();
    focusTracker.start(context);

    gitStateTracker = createGitStateTracker();
    gitStateTracker.start(context);

    context.subscriptions.push(
      vscode.commands.registerCommand("codetrackr.start", () => start(context)),
      vscode.commands.registerCommand("codetrackr.stop", () => stop()),
      vscode.commands.registerCommand("codetrackr.flushNow", () => flushNow()),
      vscode.commands.registerCommand("codetrackr.showStats", () => showStats()),
      vscode.commands.registerCommand("codetrackr.showLogs", () => showStats()),
      vscode.commands.registerCommand("codetrackr.setupApiKey", () => setupApiKey()),
      vscode.commands.registerCommand("codetrackr.signIn", () => signIn()),
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
          // Someone pasted a key into settings.json by hand: move it to SecretStorage.
          const typed = (vscode.workspace.getConfiguration("codetrackr").get<string>("apiKey") || "").trim();
          if (typed && secretStorage) void saveApiKey(typed);
        }
      })
    );

    // The persisted queue: anything left from the last session is sent first.
    outbox = new Outbox(context.globalState);
    if (outbox.size > 0) {
      console.log(`CodeTrackr: ${outbox.size} queued upload(s) from the last session`);
    }

    try {
      await loadApiKey(context);
    } catch (err) {
      // Keychain unavailable (e.g. a Linux box without a secret service):
      // keep working from settings.json rather than failing activation.
      console.error("CodeTrackr: SecretStorage unavailable, using settings.json", err);
    }

    start(context);
    drainOutbox().catch(() => {});

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
    editorTracker?.stop();
    focusTracker?.stop();
    gitStateTracker?.stop();
  } catch (err) {
    console.error("❌ Error during deactivation:", err);
  }
}

// Re-exported so tests can exercise the trackers through the built bundle.
export { EditorTracker, FocusTracker, GitStateTracker, Outbox };
