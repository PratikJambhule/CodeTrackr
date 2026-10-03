/**
 * The website forwards the API through its own address (H-19). If these rules
 * break, login silently returns to the third-party-cookie problem, so check the
 * shipped frontend config. Run: node tests/vercelProxy.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'frontend');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const configTs = fs.readFileSync(path.join(root, 'src', 'config.ts'), 'utf8');
const RENDER = 'https://codetrackr-backend-uckp.onrender.com';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

console.log('\nvercel proxy (H-19)');

const idx = (src) => cfg.rewrites.findIndex((r) => r.source === src);

for (const prefix of ['api', 'auth']) {
  check(`/${prefix}/* is forwarded to the Render API with its path kept`, () => {
    const r = cfg.rewrites[idx(`/${prefix}/:path*`)];
    assert.ok(r, `no rewrite for /${prefix}/:path*`);
    assert.strictEqual(r.destination, `${RENDER}/${prefix}/:path*`);
  });
  check(`/${prefix}/* is matched before the single-page-app fallback`, () => {
    assert.ok(idx(`/${prefix}/:path*`) < idx('/(.*)'), 'the catch-all would swallow the API');
  });
  check(`/${prefix}/* responses are never cached by Vercel`, () => {
    const h = cfg.headers.find((x) => x.source === `/${prefix}/:path*`);
    assert.ok(h && h.headers.some((x) => x.key === 'x-vercel-enable-rewrite-caching' && x.value === '0'));
  });
}

check('the single-page-app fallback still exists', () => {
  assert.strictEqual(cfg.rewrites[idx('/(.*)')].destination, '/index.html');
});

check('the production build calls its own address, not Render directly', () => {
  assert.ok(/import\.meta\.env\.PROD\s*\?\s*''/.test(configTs), "config.ts must use '' in production");
  assert.ok(!configTs.includes('onrender.com'), 'config.ts must not hard-code the Render host');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
