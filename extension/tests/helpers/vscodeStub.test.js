const assert = require('assert');
const { createVscodeStub } = require('./vscodeStub');

const { vscode, emit } = createVscodeStub();

let seen = 0;
vscode.workspace.onDidSaveTextDocument(() => { seen++; });
emit.onDidSaveTextDocument({ fileName: 'a.ts' });
emit.onDidSaveTextDocument({ fileName: 'b.ts' });

assert.strictEqual(seen, 2, 'emit must invoke every registered handler');

const { vscode: v2 } = createVscodeStub({ settings: { apiKey: 'abc' } });
assert.strictEqual(v2.workspace.getConfiguration().get('apiKey'), 'abc');

console.log('vscodeStub: 2 passed');
