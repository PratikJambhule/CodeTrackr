/**
 * "CodeTrackr: Sign In" — device-code sign-in (roadmap item 13), run against
 * the built bundle and a tiny fake API that answers "pending" twice and then
 * hands out a key.
 *
 * Run: npm run build && node tests/signIn.test.js
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}: ${err.message}`); }
}

const ISSUED_KEY = 'ct_0123456789abcdef_' + 'B'.repeat(43);

function fakeApi() {
  let polls = 0;
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/device/code') {
        res.statusCode = 201;
        return res.end(JSON.stringify({
          deviceCode: 'd'.repeat(43), userCode: 'WXYZ-2345',
          verificationUri: 'http://dash.test/device', verificationUriComplete: 'http://dash.test/device?code=WXYZ-2345',
          expiresIn: 600, interval: 0,
        }));
      }
      if (req.url === '/api/device/token') {
        polls += 1;
        if (polls < 3) { res.statusCode = 428; return res.end(JSON.stringify({ error: 'authorization_pending' })); }
        return res.end(JSON.stringify({ apiKey: ISSUED_KEY }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })));
}

(async () => {
  console.log('\nsign in with a device code');
  const api = await fakeApi();
  const stub = createVscodeStub({ settings: { apiBase: `http://127.0.0.1:${api.port}`, apiKey: '' } });
  installVscodeStub(stub.vscode);
  const ext = require(path.join(__dirname, '..', 'dist', 'extension.js'));
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

  await check('the command is contributed and registered', async () => {
    const manifest = require('../package.json');
    assert.ok(manifest.contributes.commands.some((c) => c.command === 'codetrackr.signIn'));
    assert.strictEqual(typeof stub.commandHandlers['codetrackr.signIn'], 'function');
  });

  await stub.commandHandlers['codetrackr.signIn']();

  await check('it names the device and polls until approved', async () => {
    assert.strictEqual(api.calls[0].url, '/api/device/code');
    assert.match(api.calls[0].body.clientName, /^VS Code \(/);
    assert.strictEqual(api.calls.filter((c) => c.url === '/api/device/token').length, 3);
  });

  await check('the code is copied and the approval page opened', async () => {
    assert.deepStrictEqual(stub.clipboard, ['WXYZ-2345']);
    assert.ok(stub.opened.some((u) => u.includes('/device?code=WXYZ-2345')));
  });

  await check('the issued key is stored in SecretStorage, not settings', async () => {
    assert.strictEqual(vault['codetrackr.apiKey'], ISSUED_KEY);
    assert.ok(!stub.settings.apiKey);
  });

  await check('the user is told it worked', async () => {
    assert.ok(stub.infos.some((m) => /signed in/i.test(m)), JSON.stringify(stub.infos));
  });

  await ext.deactivate();
  api.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
