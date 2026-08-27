/**
 * Activation smoke test for the packaged bundle.
 *
 * Loads dist/extension.js (the exact file that ships) against a stubbed `vscode`
 * module, activates it, and asserts that every command contributed in
 * package.json is actually registered. Shipping 2.0.10 with two contributed-but-
 * unregistered commands is precisely what this catches.
 *
 * Run: npm run build && node tests/activation.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Module = require('module');

const BUNDLE = path.join(__dirname, '..', 'dist', 'extension.js');
const MANIFEST = require('../package.json');

assert.ok(fs.existsSync(BUNDLE), 'dist/extension.js not found — run `npm run build` first');

// ---- vscode stub ----------------------------------------------------------
const disposable = { dispose() {} };
const listener = () => disposable;

const registeredCommands = [];
const warnings = [];
const infos = [];

const settings = {
  apiBase: 'https://example.invalid',
  apiKey: '', // deliberately empty: must not perform any network call
  flushIntervalSeconds: 30,
  minFlushMinutes: 0.5,
  debug: false,
};

const vscodeStub = {
  window: {
    terminals: [],
    activeTextEditor: undefined,
    setStatusBarMessage: () => disposable,
    showInformationMessage: (msg) => { infos.push(msg); return Promise.resolve(undefined); },
    showWarningMessage: (msg) => { warnings.push(msg); return Promise.resolve(undefined); },
    showErrorMessage: (msg) => { warnings.push(msg); return Promise.resolve(undefined); },
    showInputBox: () => Promise.resolve(undefined),
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    onDidOpenTerminal: listener,
    onDidCloseTerminal: listener,
    onDidChangeActiveTextEditor: listener,
    onDidStartTerminalShellExecution: listener,
    onDidEndTerminalShellExecution: listener,
  },
  workspace: {
    name: 'test-workspace',
    rootPath: '/tmp/test-workspace',
    textDocuments: [],
    getConfiguration: () => ({
      get: (key, fallback) => (key in settings ? settings[key] : fallback),
      update: (key, value) => { settings[key] = value; return Promise.resolve(); },
    }),
    onDidOpenTextDocument: listener,
    onDidSaveTextDocument: listener,
    onDidChangeTextDocument: listener,
    onDidChangeConfiguration: listener,
  },
  commands: {
    registerCommand: (id, handler) => {
      registeredCommands.push(id);
      assert.strictEqual(typeof handler, 'function', `handler for ${id} must be a function`);
      return disposable;
    },
    executeCommand: () => Promise.resolve(),
  },
  debug: {
    onDidStartDebugSession: listener,
    onDidTerminateDebugSession: listener,
    onDidChangeBreakpoints: listener,
  },
  env: { openExternal: () => Promise.resolve(true) },
  Uri: { parse: (u) => ({ toString: () => u }) },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
};

// Intercept require('vscode') for the bundle.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.apply(this, arguments);
};

// Fail loudly if activation performs a network call with no API key configured.
let networkCalls = 0;
const http = require('http');
const https = require('https');
for (const mod of [http, https]) {
  const orig = mod.request;
  mod.request = function (...args) {
    networkCalls++;
    return orig.apply(this, args);
  };
}

// ---- run ------------------------------------------------------------------
let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    failed++;
  }
}

(async () => {
  const ext = require(BUNDLE);

  console.log('\nbundle');
  check('exports activate and deactivate', () => {
    assert.strictEqual(typeof ext.activate, 'function');
    assert.strictEqual(typeof ext.deactivate, 'function');
  });

  const context = { subscriptions: [], globalState: { get: () => undefined, update: () => Promise.resolve() } };
  await ext.activate(context);

  console.log('\ncommand registration');
  const contributed = MANIFEST.contributes.commands.map((c) => c.command).sort();

  check('every contributed command is registered', () => {
    const missing = contributed.filter((c) => !registeredCommands.includes(c));
    assert.deepStrictEqual(missing, [], `not registered: ${missing.join(', ')}`);
  });

  check('no command is registered that is not contributed', () => {
    const extra = registeredCommands.filter((c) => !contributed.includes(c));
    assert.deepStrictEqual(extra, [], `undeclared: ${extra.join(', ')}`);
  });

  check('setupApiKey is registered (regression: missing in 2.0.10)', () => {
    assert.ok(registeredCommands.includes('codetrackr.setupApiKey'));
  });

  check('showInfo is registered (regression: missing in 2.0.10)', () => {
    assert.ok(registeredCommands.includes('codetrackr.showInfo'));
  });

  console.log('\nbehaviour');
  check('subscriptions are registered for disposal', () => {
    assert.ok(context.subscriptions.length >= contributed.length);
  });

  check('warns the user when no API key is configured', () => {
    assert.ok(
      warnings.some((w) => /API key/i.test(w)),
      `expected an API-key warning, got: ${JSON.stringify(warnings)}`
    );
  });

  check('makes no network call without an API key', () => {
    assert.strictEqual(networkCalls, 0, `${networkCalls} request(s) attempted`);
  });

  console.log('\nmanifest');
  check('apiBase default is not localhost', () => {
    const def = MANIFEST.contributes.configuration.properties['codetrackr.apiBase'].default;
    assert.ok(
      /^https:\/\//.test(def) && !/localhost|127\.0\.0\.1/.test(def),
      `apiBase default is "${def}"`
    );
  });

  check('vscode:prepublish compiles before packaging', () => {
    assert.match(MANIFEST.scripts['vscode:prepublish'], /build/);
    assert.match(MANIFEST.scripts.build, /typecheck/);
  });

  check('main points at the bundle', () => {
    assert.strictEqual(MANIFEST.main, './dist/extension.js');
  });

  await ext.deactivate();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
