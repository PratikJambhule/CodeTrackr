// extension.js
const vscode = require("vscode");
const axios = require("axios");
const os = require("os");
const path = require("path");

// --------- state ----------
const state = {
  timer: undefined,
  lastActivityMs: Date.now(),
  startedMs: undefined,
  bufferedMinutes: 0,
  lastKnownFile: "unknown",
  linesAdded: 0,
  linesRemoved: 0,
  terminalCommandCount: 0,
  terminalGitCommitCount: 0,
  lastTerminalCommandCount: 0,
  lastTerminalGitCommitCount: 0,
  activeTerminalCount: vscode.window.terminals.length,
  lastTerminalCommand: "unknown",
  isPaused: false,
  pauseTimeoutMs: 2 * 60 * 1000, // 2 minutes in milliseconds
};

// Track previous line counts per file
const lineCounts = new Map();
let telemetryInitialized = false;

// --------- config helpers ----------
function getCfg() {
  const cfg = vscode.workspace.getConfiguration("codetrackr");
  return {
    apiBase: cfg.get("apiBase") || "http://127.0.0.1:5050",
    userId: cfg.get("userId") || safeUsername(),
    apiKey: cfg.get("apiKey") || "",
    // flush every 30 seconds
    flushIntervalSeconds: 30,
    // minimum 0.1 minute (6 seconds) of coding before flush
    minFlushMinutes: 0.1,
  };
}      
        
function safeUsername() {
  try {
    return os.userInfo().username || "unknown";
  } catch {
    return "unknown";
  }
}

// --------- helpers ----------
function getFileMeta(filePath) {
  if (!filePath) return {};
  const ext = path.extname(filePath).toLowerCase();
  const projectName =
    vscode.workspace.name ||
    path.basename(vscode.workspace.rootPath || path.dirname(filePath));
  const language =
    vscode.window.activeTextEditor?.document?.languageId || "unknown";
  return { fileType: ext, projectName, language };
}

function markActivity(fileNameMaybe) {
  const wasIdleOrPaused = state.isPaused;
  
  state.lastActivityMs = Date.now();
  
  // Resume tracking if it was paused
  if (state.isPaused) {
    state.isPaused = false;
    // Start a new tracking session
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

// Initialize or update line count for a document
function initLineCountForDocument(doc) {
  if (!doc || !doc.fileName) return;
  try {
    lineCounts.set(doc.fileName, doc.lineCount);
  } catch {
    // ignore
  }
}

function isGitCommitCommand(commandLine) {
  return /^\s*git\s+commit\b/i.test(commandLine);
}

function initializeTelemetry(context) {
  if (telemetryInitialized) return;
  telemetryInitialized = true;

  state.activeTerminalCount = vscode.window.terminals.length;

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => {
      state.activeTerminalCount += 1;
      console.log(`CodeTrackr: Terminal opened (active=${state.activeTerminalCount})`);
    }),
    vscode.window.onDidCloseTerminal(() => {
      state.activeTerminalCount = Math.max(0, state.activeTerminalCount - 1);
      console.log(`CodeTrackr: Terminal closed (active=${state.activeTerminalCount})`);
    })
  );

  if (typeof vscode.window.onDidStartTerminalShellExecution === "function") {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const commandLine = event?.execution?.commandLine?.value?.trim() || "";
        if (!commandLine) return;

        state.terminalCommandCount += 1;
        state.lastTerminalCommand = commandLine;
        console.log(`🖥️ Terminal command tracked: ${commandLine}`);

        if (isGitCommitCommand(commandLine)) {
          state.terminalGitCommitCount += 1;
          console.log(
            `🧾 Git commit command counted (${state.terminalGitCommitCount}): ${commandLine}`
          );
        }
      })
    );
  }
}

function getFlushAnalysis() {
  const terminalCommandDelta = Math.max(
    0,
    state.terminalCommandCount - state.lastTerminalCommandCount
  );
  const terminalGitCommitDelta = Math.max(
    0,
    state.terminalGitCommitCount - state.lastTerminalGitCommitCount
  );

  return {
    terminalCommandCount: terminalCommandDelta,
    gitCommitCount: terminalGitCommitDelta,
    terminalGitCommitCount: terminalGitCommitDelta,
    activeTerminalCount: state.activeTerminalCount,
    lastTerminalCommand: state.lastTerminalCommand,
  };
}

// --------- backend calls ----------
async function sendActivity(minutes, fileOpened) {
  const { apiBase } = getCfg();

  const fullPath =
    fileOpened ||
    vscode.window.activeTextEditor?.document?.fileName ||
    "unknown";
  const { fileType, projectName, language } = getFileMeta(fullPath);

  const payload = {
    timestamp: new Date().toISOString(),
    fileName: path.basename(fullPath),
    fileType,
    projectName,
    language,
    duration: Number((minutes * 60).toFixed(0)), // Convert to seconds
    linesAdded: state.linesAdded,
    linesRemoved: state.linesRemoved,
    analysis: getFlushAnalysis(),
  };

  const headers = {
    "Content-Type": "application/json"
  };

  console.log("CodeTrackr: Preparing to send payload:", JSON.stringify(payload, null, 2));
  console.log("CodeTrackr: Using API base:", apiBase);
  console.log("CodeTrackr: Authentication disabled (testing mode)");

  try {
    const res = await axios.post(`${apiBase}/api/extension/track`, payload, {
      headers,
    });
    console.log("✅ Flushed:", {
      response: res.data,
      analysis: getFlushAnalysis(),
    });
    vscode.window.setStatusBarMessage("CodeTrackr: Activity tracked ✅", 2000);
  } catch (err) {
    const errorMsg = err?.response?.data?.message || err?.message || err;
    const statusCode = err?.response?.status || 'Unknown';
    console.error("❌ Upload failed:", errorMsg);
    console.error("❌ Status code:", statusCode);
    console.error("❌ Full error:", err?.response?.data || err);
    
    if (err?.response?.status === 400) {
      vscode.window.showErrorMessage(
        `CodeTrackr: ${errorMsg}`,
        "OK"
      );
    } else if (err.code === 'ECONNREFUSED') {
      vscode.window.showErrorMessage(
        "CodeTrackr: Cannot connect to server. Make sure backend is running on " + apiBase,
        "OK"
      );
    } else {
      vscode.window.setStatusBarMessage(`CodeTrackr: flush failed (${statusCode}) 🔁`, 3000);
    }
  } finally {
    // Reset line counters after flush
    state.linesAdded = 0;
    state.linesRemoved = 0;
    state.lastTerminalCommandCount = state.terminalCommandCount;
    state.lastTerminalGitCommitCount = state.terminalGitCommitCount;
  }
}

function minutesSince(ms) {
  return (Date.now() - ms) / 60000;
}

// --------- flush handler ----------
async function flushIfNeeded(force = false) {
  if (!state.startedMs) return;

  const elapsedFromStartMin = minutesSince(state.startedMs);
  const idleMin = minutesSince(state.lastActivityMs);
  
  // Don't flush if user has been idle for more than 2 minutes (unless forced)
  if (!force && idleMin >= 2) {
    console.log("CodeTrackr: Skipping flush - user idle for", idleMin.toFixed(2), "minutes");
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

// --------- core functions ----------
function start(context) {
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
    })
  );

  // Track line changes accurately using document.lineCount diffs
  context.subscriptions.push(
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
        // fallback for safety
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
    
    // If we are not paused but have been idle for 2+ minutes, pause tracking.
    if (!state.isPaused && idleMin >= 2) {
      console.log(`CodeTrackr: Idle for ${idleMin.toFixed(2)} minutes. Pausing tracking.`);
      
      // Flush any *active* time that was buffered before the idle period started.
      if (state.startedMs) {
        const activeDurationMs = state.lastActivityMs - state.startedMs;
        const activeDurationMin = activeDurationMs / 60000;

        if (activeDurationMin > getCfg().minFlushMinutes) {
          console.log(`CodeTrackr: Flushing ${activeDurationMin.toFixed(2)} minutes of active time before pausing.`);
          // We send the active duration, not the total elapsed time.
          sendActivity(activeDurationMin, state.lastKnownFile).catch(() => {});
        }
      }
      
      // Now, officially pause.
      state.isPaused = true;
      state.startedMs = undefined;
      state.bufferedMinutes = 0;
      vscode.window.setStatusBarMessage("CodeTrackr: Paused (idle) ⏸️", 4000);
      return;
    }

    // If we are paused, do nothing.
    if (state.isPaused) {
      return;
    }
    
    // If we are not paused and not idle, proceed with a normal flush.
    flushIfNeeded(false).catch(() => {});
  }, flushIntervalSeconds * 1000);

  vscode.window.setStatusBarMessage("CodeTrackr: started ⏳", 3000);
}

function stop() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  state.startedMs = undefined;
  state.bufferedMinutes = 0;
  state.isPaused = false;
  vscode.window.setStatusBarMessage("CodeTrackr: stopped 🛑", 2000);
}

async function flushNow() {
  await flushIfNeeded(true);
}

// --------- API Key Setup ----------
async function promptForApiKey() {
  const apiKey = await vscode.window.showInputBox({
    prompt: "Enter your CodeTrackr API Key",
    placeHolder: "Paste your API key from CodeTrackr dashboard",
    ignoreFocusOut: true,
    password: true,
  });

  if (apiKey && apiKey.trim()) {
    const trimmedKey = apiKey.trim();
    
    // Validate API key format (should be 64 character hex string)
    if (trimmedKey.length !== 64 || !/^[a-f0-9]+$/i.test(trimmedKey)) {
      vscode.window.showWarningMessage(
        "CodeTrackr: API key format looks incorrect. It should be a 64-character hexadecimal string. Do you want to save it anyway?",
        "Save Anyway",
        "Cancel"
      ).then(async (choice) => {
        if (choice === "Save Anyway") {
          await saveAndVerifyApiKey(trimmedKey);
        }
      });
      return;
    }
    
    await saveAndVerifyApiKey(trimmedKey);
  }
}

async function saveAndVerifyApiKey(apiKey) {
  const config = vscode.workspace.getConfiguration("codetrackr");
  await config.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
  
  console.log("CodeTrackr: API key saved, verifying...");
  
  // Verify the API key
  const verified = await verifyApiKey(apiKey);
  if (verified) {
    vscode.window.showInformationMessage(
      `CodeTrackr: API key configured successfully! Welcome, ${verified.user.name}! 🎉`
    );
    // Start tracking if not already started
    if (!state.timer) {
      const context = globalContext;
      if (context) start(context);
    }
  }
}

async function verifyApiKey(apiKey) {
  try {
    const { apiBase } = getCfg();
    console.log(`CodeTrackr: Verifying API key with ${apiBase}`);
    
    const res = await axios.get(`${apiBase}/api/extension/verify`, {
      headers: { "x-api-key": apiKey.trim() },
      timeout: 10000 // 10 second timeout
    });
    
    console.log("✅ API key verified successfully");
    return res.data;
  } catch (err) {
    console.error("❌ API key verification failed:", err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      vscode.window.showErrorMessage(
        "CodeTrackr: Cannot connect to backend server. Make sure it's running on " + getCfg().apiBase,
        "OK"
      );
    } else if (err.response?.status === 401) {
      vscode.window.showErrorMessage(
        "CodeTrackr: Invalid API key. Please check and try again.",
        "Get New Key"
      ).then((selection) => {
        if (selection === "Get New Key") {
          vscode.env.openExternal(vscode.Uri.parse("https://code-trackr-frontend.vercel.app/profile"));
        }
      });
    } else {
      vscode.window.showErrorMessage(
        `CodeTrackr: Verification failed - ${err.message}`,
        "OK"
      );
    }
    return null;
  }
}

async function showApiKeyInfo() {
  await vscode.window.showInformationMessage(
    "CodeTrackr: Authentication is disabled for testing. Activity tracking runs without API keys."
  );
}

// Store context globally for access in promptForApiKey
let globalContext = null;

// --------- VS Code hooks ----------
function activate(context) {
  console.log("💻 CodeTrackr extension activated");
  globalContext = context;

  initializeTelemetry(context);

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
  const cmdSetupApiKey = vscode.commands.registerCommand("codetrackr.setupApiKey", () =>
    vscode.window.showInformationMessage(
      "CodeTrackr: API key setup is disabled because authentication is turned off for testing."
    )
  );
  const cmdShowInfo = vscode.commands.registerCommand("codetrackr.showInfo", () =>
    showApiKeyInfo()
  );

  context.subscriptions.push(cmdStart, cmdStop, cmdFlush, cmdSetupApiKey, cmdShowInfo);

  vscode.window.setStatusBarMessage(
    "CodeTrackr: Auth disabled (testing mode)",
    4000
  );
  start(context);
}

function deactivate() {
  stop();
}

module.exports = { activate, deactivate };
