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

// ---- vscode stub (shared helper) ------------------------------------------
const { createVscodeStub, installVscodeStub } = require("./helpers/vscodeStub");
const stub = createVscodeStub();
const { vscode: vscodeStub, registeredCommands, warnings, infos, settings } = stub;
const restoreLoader = installVscodeStub(vscodeStub);

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

  console.log('\npayload composition');
  check('buildPayloadForTest includes the three new analytics blocks', () => {
    assert.strictEqual(typeof ext.buildPayloadForTest, 'function');
    const payload = ext.buildPayloadForTest(120);
    for (const key of ['terminalAnalytics', 'editorAnalytics', 'focusAnalytics', 'gitAnalytics']) {
      assert.ok(payload[key], `payload.${key} missing`);
    }
    assert.strictEqual(payload.duration, 120);
  });

  check('payload carries gross line counts, not net deltas', () => {
    const payload = ext.buildPayloadForTest(60);
    assert.ok('linesAdded' in payload && 'linesRemoved' in payload, 'backend contract fields kept');
    assert.ok('linesInserted' in payload.editorAnalytics, 'gross insert count present');
    assert.ok('churnLines' in payload.editorAnalytics, 'churn present');
  });

  check('payload contains no file contents or absolute paths', () => {
    const payload = ext.buildPayloadForTest(60);
    const json = JSON.stringify(payload);
    assert.ok(!json.includes('/tmp/test-workspace'), 'absolute workspace path leaked');
  });

  await ext.deactivate();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
