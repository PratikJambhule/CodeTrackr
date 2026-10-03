/**
 * The API key lives in VS Code SecretStorage (OS keychain), not settings.json.
 * A key left in settings by an older version is moved on activation and the
 * plaintext setting is cleared. Runs against the built bundle.
 *
 * Run: npm run build && node tests/secretKey.test.js
 */
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const BUNDLE = path.join(__dirname, '..', 'dist', 'extension.js');
const OLD_KEY = 'ct_0123456789abcdef_' + 'A'.repeat(43);

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}

(async () => {
  console.log('\nsecret storage');
  const stub = createVscodeStub({ settings: { apiKey: OLD_KEY, apiBase: 'http://127.0.0.1:9' } });
  installVscodeStub(stub.vscode);
  const ext = require(BUNDLE);

  const vault = {};
  const context = {
    subscriptions: [],
    globalState: { get: () => undefined, update: () => Promise.resolve() },
    secrets: {
      get: (k) => Promise.resolve(vault[k]),
      store: (k, v) => { vault[k] = v; return Promise.resolve(); },
      delete: (k) => { delete vault[k]; return Promise.resolve(); },
      onDidChange: () => ({ dispose() {} }),
    },
  };
  await ext.activate(context);

  await check('a key found in settings.json is moved into SecretStorage', async () => {
    assert.strictEqual(vault['codetrackr.apiKey'], OLD_KEY);
  });

  await check('the plaintext setting is cleared after the move', async () => {
    assert.ok(!stub.settings.apiKey, `settings.apiKey is still "${stub.settings.apiKey}"`);
  });

  await check('no "missing API key" warning once the key is in SecretStorage', async () => {
    assert.ok(!stub.warnings.some((w) => /no API key/i.test(w)), JSON.stringify(stub.warnings));
  });

  await ext.deactivate();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
