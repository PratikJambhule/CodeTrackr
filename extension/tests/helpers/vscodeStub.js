/**
 * Shared VS Code API stub for extension tests.
 * `emit.<eventName>(payload)` fires every handler registered via that event.
 */
const DISPOSABLE = { dispose() {} };

function createVscodeStub(overrides = {}) {
  const handlers = {};
  const registeredCommands = [];
  const warnings = [];
  const infos = [];

  const settings = Object.assign(
    {
      apiBase: 'https://example.invalid',
      apiKey: '',
      flushIntervalSeconds: 30,
      minFlushMinutes: 0.5,
      debug: false,
    },
    overrides.settings || {}
  );

  const on = (name) => (handler) => {
    (handlers[name] = handlers[name] || []).push(handler);
    return DISPOSABLE;
  };

  const emit = new Proxy(
    {},
    {
      get: (_t, name) => (payload) => {
        (handlers[name] || []).forEach((h) => h(payload));
      },
    }
  );

  const vscode = {
    window: {
      terminals: [],
      activeTextEditor: overrides.activeTextEditor,
      state: { focused: true },
      setStatusBarMessage: () => DISPOSABLE,
      showInformationMessage: (m) => { infos.push(m); return Promise.resolve(undefined); },
      showWarningMessage: (m) => { warnings.push(m); return Promise.resolve(undefined); },
      showErrorMessage: (m) => { warnings.push(m); return Promise.resolve(undefined); },
      showInputBox: () => Promise.resolve(undefined),
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      onDidOpenTerminal: on('onDidOpenTerminal'),
      onDidCloseTerminal: on('onDidCloseTerminal'),
      onDidChangeActiveTextEditor: on('onDidChangeActiveTextEditor'),
      onDidChangeWindowState: on('onDidChangeWindowState'),
      onDidChangeTextEditorSelection: on('onDidChangeTextEditorSelection'),
      onDidStartTerminalShellExecution: on('onDidStartTerminalShellExecution'),
      onDidEndTerminalShellExecution: on('onDidEndTerminalShellExecution'),
    },
    workspace: {
      name: 'test-workspace',
      rootPath: '/tmp/test-workspace',
      textDocuments: [],
      getConfiguration: () => ({
        get: (key, fallback) => (key in settings ? settings[key] : fallback),
        update: (key, value) => { settings[key] = value; return Promise.resolve(); },
      }),
      onDidOpenTextDocument: on('onDidOpenTextDocument'),
      onDidSaveTextDocument: on('onDidSaveTextDocument'),
      onDidChangeTextDocument: on('onDidChangeTextDocument'),
      onDidChangeConfiguration: on('onDidChangeConfiguration'),
    },
    commands: {
      registerCommand: (id, handler) => {
        registeredCommands.push(id);
        if (typeof handler !== 'function') throw new Error(`handler for ${id} not a function`);
        return DISPOSABLE;
      },
      executeCommand: () => Promise.resolve(),
    },
    debug: {
      onDidStartDebugSession: on('onDidStartDebugSession'),
      onDidTerminateDebugSession: on('onDidTerminateDebugSession'),
      onDidChangeBreakpoints: on('onDidChangeBreakpoints'),
    },
    extensions: {
      getExtension: (id) =>
        overrides.gitExtension && id === 'vscode.git' ? overrides.gitExtension : undefined,
    },
    env: { openExternal: () => Promise.resolve(true) },
    Uri: { parse: (u) => ({ toString: () => u }) },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    TextDocumentChangeReason: { Undo: 1, Redo: 2 },
  };

  return { vscode, emit, registeredCommands, warnings, infos, settings };
}

/** Install the stub as the resolution for require('vscode'). */
function installVscodeStub(stub) {
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return stub;
    return originalLoad.call(this, request, ...rest);
  };
  return () => { Module._load = originalLoad; };
}

module.exports = { createVscodeStub, installVscodeStub };
