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
import { emptyKindCounts } from "./analyticsAggregator";
import { classifyCommand } from "./commandClassifier";
import { commandKind, COMMAND_KINDS } from "./commandKind";
import { TimeEngine, OTHER_FILES, TimeSnapshot } from "./heartbeat";
import { RunsTracker, isCodeRunnerOutput } from "./runsTracker";
import { WorkspaceSnapshot, probeWorkspace, vscodeProbeDeps, sizeBucket, clonedWithin } from "./workspaceProbe";
import { WorkMode, ModeStore } from "./workMode";
import { randomUUID } from "crypto";

// Production endpoints. These are the fallbacks used when the user has not
// overridden `codetrackr.apiBase`; the manifest default must match.
const DEFAULT_API_BASE = "https://codetrackr-backend-uckp.onrender.com";
const DASHBOARD_URL = "https://code-trackr-frontend.vercel.app";

// The backend rejects a falsy duration, and a single flush covers at most a
// few minutes, so anything outside this range is a bug or a clock jump.
const MIN_FLUSH_SECONDS = 1;
const MAX_FLUSH_SECONDS = 3600;

// --------- Global State ----------
interface AppState {
  timer?: NodeJS.Timeout;
  /** True while nothing is counted: no action for 60 s, or away from VS Code for more than 30 s. */
  idle: boolean;
  lastKnownFile: string;
  activeTerminalCount: number;
}

const state: AppState = {
  idle: false,
  lastKnownFile: "unknown",
  activeTerminalCount: vscode.window.terminals.length,
};

/** Counts writing, reading and running time from real actions (heartbeat.ts, plan §2). */
const engine = new TimeEngine();
let listenersRegistered = false;

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
let runsTracker: RunsTracker;

/** What kind of project is open (workspaceProbe.ts); refreshed when the workspace changes. */
let workspaceInfo: WorkspaceSnapshot | null = null;
// Plan E12: what the user says they are doing (status bar). Replaced at activation with the
// workspace's own storage; this in-memory default keeps tests and early calls safe.
const memoryStore = new Map<string, unknown>();
let workMode = new WorkMode({ get: (k) => memoryStore.get(k) as any, update: (k, v) => { memoryStore.set(k, v); return Promise.resolve(); } });
let workModeItem: vscode.StatusBarItem | undefined;
function refreshWorkModeItem(): void {
  if (!workModeItem) return;
  workModeItem.text = workMode.statusText();
  workModeItem.tooltip = workMode.tooltip();
}
async function pickWorkMode(): Promise<void> {
  const choice = await vscode.window.showQuickPick(workMode.pickItems(), {
    placeHolder: "What are you working on? (labels this coding session)",
  });
  await workMode.choose(choice);
  refreshWorkModeItem();
}
function refreshWorkspaceInfo(): void {
  const deps = vscodeProbeDeps();
  if (!deps) { workspaceInfo = null; return; }
  probeWorkspace(deps, Date.now()).then((s) => { workspaceInfo = s; }).catch(() => {});
}

// Doc-like files: time in them counts as reading documentation (plan E9).
const DOC_FILE = /\.(md|markdown|txt|rst|adoc)$/i;

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
/** The last part of a path, split on both "/" and "\" so a folder path can never leave the laptop
 * whatever OS the extension host runs on (path.basename on Linux keeps a Windows path whole). */
export function baseName(p: string | undefined): string {
  return (p || "").split(/[\\/]/).filter(Boolean).pop() || "";
}
const parentOf = (p: string) => p.split(/[\\/]/).slice(0, -1).join("/");

function getFileMeta(filePath: string | undefined) {
  if (!filePath) return {};
  const ext = path.extname(filePath).toLowerCase();
  const projectName =
    vscode.workspace.name ||
    baseName(vscode.workspace.rootPath || parentOf(filePath));
  const language =
    vscode.window.activeTextEditor?.document?.languageId || "unknown";
  return { fileType: ext, projectName, language };
}

/**
 * Documents the user actually works in. Output panels, Git views and settings also fire edit and
 * selection events; those must not count as the user's typing or reading.
 */
function isUserDocument(doc?: vscode.TextDocument): doc is vscode.TextDocument {
  if (!doc) return false;
  const scheme = doc.uri?.scheme ?? "file";
  return scheme === "file" || scheme === "untitled" || scheme === "vscode-notebook-cell";
}

/** Edits count only in a document that is on screen (not one changed in the background). */
function isOnScreen(doc: vscode.TextDocument): boolean {
  if (vscode.window.activeTextEditor?.document === doc) return true;
  return (vscode.window.visibleTextEditors || []).some((e) => e.document === doc);
}

/** A heartbeat from a user action in `doc` (plan E4). */
function heartbeat(kind: "writing" | "reading", doc?: vscode.TextDocument): void {
  if (!isUserDocument(doc)) return;
  const now = Date.now();
  engine.beat(now, kind, baseName(doc.fileName), doc.languageId);
  state.lastKnownFile = doc.fileName;
  focusTracker?.noteActivity(now);
  leaveIdle();
}

/** A terminal command, task or debug session started. */
function runStarted(id: unknown): void {
  engine.runStart(id, Date.now());
  leaveIdle();
}

function runEnded(id: unknown): void {
  engine.runEnd(id, Date.now());
}

function leaveIdle(): void {
  if (!state.idle) return;
  state.idle = false;
  focusTracker?.setPaused(false); // focus time is not banked while idle
  vscode.window.setStatusBarMessage("CodeTrackr: Tracking resumed ▶️", 2000);
}

function enterIdle(): void {
  if (state.idle) return;
  state.idle = true;
  focusTracker?.setPaused(true);
  vscode.window.setStatusBarMessage("CodeTrackr: Paused (idle) ⏸️", 4000);
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
    // Since 2.6.0 any counted time is signal: reading-only and running-only intervals are real work.
    n(payload?.duration) > 0 ||
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
    "fileName", "fileType", "projectName", "language", "payloadVersion",
  ]);
  // Whole objects where the newer upload's value wins (not added up).
  const NEWER_OBJECTS = new Set(["userMode", "workspace"]);
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
      if (NEWER_OBJECTS.has(key)) { out[key] = bv ?? av; continue; }
      if (NEWER_KEYS.has(key)) {
        out[key] = bv !== undefined && bv !== null && bv !== 0 && bv !== "" && bv !== "unknown"
          ? bv : av;
        continue;
      }
      if (key === "perFile") {
        const byName = new Map<string, any>();
        for (const f of [...(av || []), ...(bv || [])]) {
          if (!f?.name) continue;
          const cur = byName.get(f.name);
          if (!cur) { byName.set(f.name, { ...f }); continue; }
          for (const k of ["seconds", "writing", "reading", "running", "linesInserted", "linesDeleted"]) cur[k] = num(cur[k]) + num(f[k]);
          cur.edited = !!(cur.edited || f.edited);
          if ((!cur.language || cur.language === "unknown") && f.language) cur.language = f.language;
        }
        out[key] = [...byName.values()].sort((x, y) => num(y.seconds) - num(x.seconds));
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
    commandKinds: emptyKindCounts(),
    gitActivity: {
      commits: 0,
      pushes: 0,
      pulls: 0,
      checkouts: 0,
      merges: 0,
      clones: 0,
    },
    repeatedFailedCommands: [] as Array<{ command: string; count: number }>,
    lastCommand: "unknown" as string,
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
    fileSwitches: 0, uniqueFiles: 0,
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

/**
 * Composes the upload (payload version 3, plan §3) from the engine's counted time. Exported for
 * tests via buildPayloadForTest.
 */
function buildPayload(snap: TimeSnapshot) {
  const activePath = vscode.window.activeTextEditor?.document?.fileName || state.lastKnownFile || "unknown";
  const { projectName, language: activeLanguage, fileType: activeType } = getFileMeta(activePath);
  // The file with the most time is the upload's main file (older servers read only this one).
  const top = snap.perFile.find((f) => f.name !== OTHER_FILES);

  const terminalAnalytics = terminalTracker?.consumeInterval() || emptyTerminalAnalytics();
  const fileLines = editorTracker?.getFileLines() ?? new Map();
  const signals = editorTracker?.getSignals();
  const runs = runsTracker?.consumeInterval() ?? { terminal: 0, task: 0, debugNoDebug: 0, codeRunner: 0 };
  const editorCounts = editorTracker?.consumeInterval() || emptyEditorAnalytics();
  const focusAnalytics = focusTracker?.consumeInterval() || emptyFocusAnalytics();
  const gitAnalytics = gitStateTracker?.consumeInterval() || emptyGitAnalytics();

  // Debug sessions used to be logged into a pipeline that never reached the
  // backend; fold them into the field the Activity schema already stores.
  const debugCounts = debugTracker?.consumeInterval();
  if (debugCounts) {
    terminalAnalytics.debuggingSessions += debugCounts.debugSessions;
  }

  const perFile = snap.perFile.map((f) => {
    const lines = fileLines.get(f.name) || { linesInserted: 0, linesDeleted: 0 };
    return { ...f, ...lines, edited: f.writing > 0 || lines.linesInserted + lines.linesDeleted > 0,
      created: !!signals?.created.has(f.name) };
  });
  const realFiles = perFile.filter((f) => f.name !== OTHER_FILES);

  return {
    payloadVersion: 3,
    // Stamped with when the counted time began, so hour-of-day charts stay right.
    timestamp: new Date(snap.startMs ?? Date.now() - snap.seconds * 1000).toISOString(),
    fileName: top ? top.name : baseName(activePath),
    fileType: top ? path.extname(top.name).toLowerCase() || "unknown" : activeType || "unknown",
    projectName: projectName || "unknown",
    language: top && top.language !== "unknown" ? top.language : activeLanguage || "unknown",
    duration: snap.seconds,
    writingSec: snap.writingSec,
    readingSec: snap.readingSec,
    runningSec: snap.runningSec,
    perFile,
    // Plan E7–E11: what ran, real debugging, reading signals, file events, the kind of project.
    runs,
    debug: {
      sessions: debugCounts?.debugSessions ?? 0,
      breakpointStops: debugCounts?.breakpointStops ?? 0,
      steps: debugCounts?.steps ?? 0,
    },
    reading: {
      scrollEvents: signals?.scrollEvents ?? 0,
      navigations: signals?.navigations ?? 0,
      docFileSec: realFiles.filter((f) => DOC_FILE.test(f.name)).reduce((a, f) => a + f.seconds, 0),
      filesOpenedNotEdited: realFiles.filter((f) => f.seconds > 0 && !f.edited).length,
    },
    filesCreated: signals?.filesCreated ?? 0,
    filesDeleted: signals?.filesDeleted ?? 0,
    workspace: workspaceInfo,
    // Plan E12: the user's own answer. confirmed is true only when picked or confirmed this session.
    userMode: workMode.payload(),
    // Kept for backend compatibility, now sourced from gross counters.
    linesAdded: editorCounts.linesInserted,
    linesRemoved: editorCounts.linesDeleted,
    terminalAnalytics,
    // readMs / writeMs now come from the engine (real actions), not a 5-second sampler.
    editorAnalytics: { ...editorCounts, readMs: snap.readingSec * 1000, writeMs: snap.writingSec * 1000 },
    focusAnalytics,
    gitAnalytics,
  };
}

/** Test seam: build a payload for `durationSeconds` of writing, without the network. */
export function buildPayloadForTest(durationSeconds: number) {
  return buildPayload({ startMs: null, seconds: durationSeconds, writingSec: durationSeconds, readingSec: 0, runningSec: 0, perFile: [] });
}

/** Test seams: the live engine, and one run of the 30-second check. */
export function getEngineForTest() {
  return engine;
}
export function tickForTest() {
  tick();
}

/**
 * Drain the trackers, plus any carried signal-less interval, into one payload.
 * Every real flush path goes through this so no caller can forget the carry.
 */
function takePayload(snap: TimeSnapshot) {
  const fresh = buildPayload(snap);
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

/** Upload once enough time is counted (minFlushMinutes, 2 min by default); `force` uploads now. */
async function flushIfNeeded(force: boolean = false): Promise<void> {
  const now = Date.now();
  if (!force && engine.countedMs(now) < getCfg().minFlushMinutes * 60000) return;
  await flushCounted(now);
}

/** Take everything counted up to `now` and queue it (plan E5). */
async function flushCounted(now: number): Promise<void> {
  const payload = takePayload(engine.take(now));
  if (payload.duration >= MIN_FLUSH_SECONDS) {
    // Persisted before the network call: a failed upload, a restart or a crash cannot lose it.
    await queueUpload(payload);
  } else if (payloadHasSignal(payload)) {
    // Counters but no counted time (e.g. a commit made from another window): send with the next upload.
    carryForward(payload);
  }
}

/** The 30-second check. It only checks; uploads happen at 2 minutes, on idle, or on a project change. */
function tick(): void {
  const now = Date.now();
  engine.advance(now);
  refreshWorkModeItem(); // a confirmation runs out after 30 minutes without uploads
  if (engine.isIdle(now)) {
    enterIdle();
    if (engine.countedMs() > 0) flushCounted(now).catch(() => {}); // the tail of the session
    return;
  }
  flushIfNeeded(false).catch(() => {});
}

/** User actions → heartbeats; commands, tasks and debug sessions → runs (plan E4). Registered once. */
function registerListeners(context: vscode.ExtensionContext): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const active = vscode.window.activeTextEditor?.document;
  if (isUserDocument(active)) engine.setActiveFile(baseName(active.fileName), active.languageId);
  engine.setFocus(vscode.window.state?.focused !== false, Date.now());

  const subs: vscode.Disposable[] = [
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges?.length && isOnScreen(event.document)) heartbeat("writing", event.document);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => heartbeat("writing", doc)),
    vscode.window.onDidChangeActiveTextEditor((ed) => heartbeat("reading", ed?.document)),
    vscode.window.onDidChangeTextEditorSelection((e) => heartbeat("reading", e.textEditor?.document)),
    vscode.window.onDidChangeWindowState((s) => engine.setFocus(!!s.focused, Date.now())),
    vscode.debug.onDidStartDebugSession((s) => runStarted(s.id)),
    vscode.debug.onDidTerminateDebugSession((s) => runEnded(s.id)),
  ];
  // Newer APIs: guard so an older VS Code still activates.
  if (typeof vscode.window.onDidChangeTextEditorVisibleRanges === "function") {
    subs.push(vscode.window.onDidChangeTextEditorVisibleRanges((e) => heartbeat("reading", e.textEditor?.document))); // scrolling
  }
  if (typeof vscode.window.onDidStartTerminalShellExecution === "function") {
    subs.push(
      vscode.window.onDidStartTerminalShellExecution((e) => {
        if (!classifyCommand(e.execution.commandLine.value).isIgnored) runStarted(e.execution);
      }),
      vscode.window.onDidEndTerminalShellExecution((e) => runEnded(e.execution))
    );
  }
  if (vscode.tasks && typeof vscode.tasks.onDidStartTaskProcess === "function") {
    subs.push(
      vscode.tasks.onDidStartTaskProcess((e) => runStarted(e.execution)),
      vscode.tasks.onDidEndTaskProcess((e) => runEnded(e.execution))
    );
  }
  if (typeof vscode.workspace.onDidChangeWorkspaceFolders === "function") {
    // A different project: upload now so the time stays with the project it belongs to.
    subs.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
      flushCounted(Date.now()).catch(() => {});
      refreshWorkspaceInfo();
    }));
  }
  context.subscriptions.push(...subs);
}

// --------- Core Functions ----------
function start(context: vscode.ExtensionContext): void {
  if (state.timer) {
    vscode.window.setStatusBarMessage("CodeTrackr: already running ⏱️", 2000);
    return;
  }
  registerListeners(context);
  state.timer = setInterval(tick, getCfg().flushIntervalSeconds * 1000);
  vscode.window.setStatusBarMessage("CodeTrackr: started ⏳", 3000);
}

function stop(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  state.idle = false;
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

  const pending = (engine.countedMs(Date.now()) / 60000).toFixed(2);

  vscode.window.showInformationMessage(
    `CodeTrackr — Backend: ${apiBase} · ` +
      `${state.idle ? "Paused (idle)" : state.timer ? "Tracking" : "Stopped"} · ` +
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
    runsTracker = new RunsTracker({
      // Code Runner prints "[Running]" / "[Done]": its run time counts as running.
      onCodeRunnerStart: (ts) => { engine.runStart("code-runner", ts); leaveIdle(); },
      onCodeRunnerEnd: (ts) => engine.runEnd("code-runner", ts),
    });
    runsTracker.start(context);
    refreshWorkspaceInfo();

    context.subscriptions.push(
      vscode.commands.registerCommand("codetrackr.start", () => start(context)),
      vscode.commands.registerCommand("codetrackr.stop", () => stop()),
      vscode.commands.registerCommand("codetrackr.flushNow", () => flushNow()),
      vscode.commands.registerCommand("codetrackr.showStats", () => showStats()),
      vscode.commands.registerCommand("codetrackr.showLogs", () => showStats()),
      vscode.commands.registerCommand("codetrackr.setupApiKey", () => setupApiKey()),
      vscode.commands.registerCommand("codetrackr.signIn", () => signIn()),
      vscode.commands.registerCommand("codetrackr.showInfo", () => showInfo()),
      vscode.commands.registerCommand("codetrackr.setWorkMode", () => pickWorkMode())
    );

    // Work-mode picker: remembered per workspace (folder), shown in the status bar.
    const modeStore: ModeStore | undefined = (context as any).workspaceState;
    if (modeStore) workMode = new WorkMode(modeStore);
    if (typeof vscode.window.createStatusBarItem === "function") {
      workModeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      workModeItem.command = "codetrackr.setWorkMode";
      refreshWorkModeItem();
      workModeItem.show();
      context.subscriptions.push(workModeItem);
    }

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
    runsTracker?.stop();
  } catch (err) {
    console.error("❌ Error during deactivation:", err);
  }
}

// Re-exported so tests can exercise the trackers through the built bundle.
// Test seams (tests/*.test.js load dist/extension.js).
export { WorkMode, RunsTracker, isCodeRunnerOutput, probeWorkspace, sizeBucket, clonedWithin, DebugTracker, EditorTracker, FocusTracker, GitStateTracker, Outbox, TerminalTracker, classifyCommand, commandKind, COMMAND_KINDS, TimeEngine, OTHER_FILES };
