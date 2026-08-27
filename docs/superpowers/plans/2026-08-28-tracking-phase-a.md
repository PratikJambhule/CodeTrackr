# Tracking Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CodeTrackr's two broken activity signals and add Tier-A editor/focus/git counters, then derive five productivity metrics from them server-side.

**Architecture:** The VS Code extension gains three new trackers that accumulate counters per flush interval, mirroring the existing `TerminalTracker` pattern (`consumeInterval()` returns a snapshot and resets). They are attached to the existing `/api/extension/track` payload as new sub-documents — no new endpoint, no event streaming. The backend adds matching additive schema fields, normalises them on ingest, and a new `metricsService` computes derived metrics as pure functions over MongoDB aggregates.

**Tech Stack:** TypeScript 5 + esbuild (extension), Node 18 + Express 5 + Mongoose 8 (backend), plain `node:assert` test scripts (no test framework — matches existing `tests/streak.test.js` and `tests/activation.test.js`).

**Spec:** `docs/TRACKING_ROADMAP.md` (Part 0 fixes, Part 1 Tier A, Part 2 schema, Part 3 derived metrics 1, 4, 14, 16, 18)

## Global Constraints

- **No git repository exists yet.** Task 0 creates it. Every later task ends with a commit.
- **Extension is published** as `CodeTrackr-ext.codetrackr-vscode`. Payload changes must be **purely additive** — backend must keep accepting v2.0.11 payloads that lack the new fields.
- **Schema changes are additive only.** Existing `Activity` documents lack the new sub-documents; every read path must treat missing as zero.
- **`Activity.duration` is in SECONDS.** All new duration fields are in **milliseconds** and must be named `...Ms` to prevent a repeat of the 60× goals bug.
- **Privacy:** never transmit file contents, diffs, commit messages, or absolute paths. File identity is basename + extension only. Branch names must be sanitised.
- **Private metrics never reach the leaderboard.** `churn`, `readMs`, `undoCount` and derived friction metrics are per-user only.
- **Test command:** `npm test` in `backend/` and in `extension/`. Extension `pretest` runs the build, so tests always run against the real bundle.
- **Node version:** extension targets ES2020 / Node 18 (VS Code ^1.85.0).

---

## File Structure

**Extension — create:**
- `extension/src/editorTracker.ts` — gross char/line counts, churn, undo/redo, saves, file switches, unique files, read vs write time
- `extension/src/focusTracker.ts` — window focus/blur time, blur events, completed flow blocks
- `extension/src/gitStateTracker.ts` — commits and uncommitted work age via the built-in Git extension API
- `extension/tests/helpers/vscodeStub.js` — shared VS Code API stub (extracted from `activation.test.js`)
- `extension/tests/trackers.test.js` — unit tests for the three trackers

**Extension — modify:**
- `extension/src/extension.ts` — remove net-line counting, wire trackers, extend payload, re-export trackers for tests
- `extension/tests/activation.test.js` — use the shared stub, assert new payload fields

**Backend — create:**
- `backend/services/metricsService.js` — pure derived-metric functions + query wrappers
- `backend/routes/metrics.js` — `GET /api/metrics` (own user only)
- `backend/tests/metrics.test.js` — unit tests for the pure functions
- `backend/tests/ingest.test.js` — normaliser tests

**Backend — modify:**
- `backend/models/Activity.js` — add `editorAnalytics`, `focusAnalytics`, `gitAnalytics`
- `backend/routes/extension.js` — normalise and persist the new sub-documents
- `backend/app.js` — mount `/api/metrics`
- `backend/package.json` — run all test files

---

### Task 0: Initialise version control

**Files:**
- Create: `.gitignore` additions (root `.gitignore` already exists)

**Interfaces:**
- Consumes: nothing
- Produces: a git repository with a baseline commit, so every later task can commit and roll back

- [ ] **Step 1: Confirm no repository exists**

Run: `git rev-parse --is-inside-work-tree`
Expected: `fatal: not a git repository`

- [ ] **Step 2: Verify .gitignore covers secrets and build output**

Run: `cat .gitignore`
Expected output must contain `node_modules/`, `.env`, `dist/`. If any are missing, append them:

```bash
printf '\nnode_modules/\n.env\ndist/\n*.vsix\n' >> .gitignore
```

- [ ] **Step 3: Initialise and make the baseline commit**

```bash
git init
git add -A
git status --short | head -20
```

Confirm no `.env` or `node_modules` appear in the staged list before committing.

```bash
git commit -m "chore: baseline commit before tracking Phase A

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Create the working branch**

```bash
git checkout -b feat/tracking-phase-a
git log --oneline -1
```
Expected: one commit, on branch `feat/tracking-phase-a`.

---

### Task 1: Shared VS Code stub for tests

**Files:**
- Create: `extension/tests/helpers/vscodeStub.js`
- Modify: `extension/tests/activation.test.js` (replace inline stub with the import)

**Interfaces:**
- Consumes: nothing
- Produces: `createVscodeStub(overrides?) -> { vscode, emit, registeredCommands, warnings, infos, settings }`
  - `vscode` — the stub module object to return from `require('vscode')`
  - `emit` — `{ [eventName: string]: (payload) => void }`, fires every handler registered for that event
  - `registeredCommands` — `string[]`
  - `settings` — mutable config object read by `getConfiguration().get`

- [ ] **Step 1: Write the failing test**

Create `extension/tests/helpers/vscodeStub.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && node tests/helpers/vscodeStub.test.js`
Expected: FAIL with `Cannot find module './vscodeStub'`

- [ ] **Step 3: Write the stub**

Create `extension/tests/helpers/vscodeStub.js`:

```js
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
      getExtension: (id) => (overrides.gitExtension && id === 'vscode.git' ? overrides.gitExtension : undefined),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extension && node tests/helpers/vscodeStub.test.js`
Expected: `vscodeStub: 2 passed`

- [ ] **Step 5: Commit**

```bash
git add extension/tests/helpers/
git commit -m "test: add shared VS Code API stub for extension tests

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: EditorTracker — gross edits, churn, focus-time split

**Files:**
- Create: `extension/src/editorTracker.ts`
- Test: `extension/tests/trackers.test.js` (created here, extended in Tasks 3 and 4)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface EditorAnalyticsSnapshot { charsInserted, charsDeleted, linesInserted, linesDeleted, churnLines, undoCount, redoCount, saveCount, fileSwitches, uniqueFiles, readMs, writeMs, largeInsertCount, largeInsertChars }` — all `number`
  - `export class EditorTracker` with `start(context: vscode.ExtensionContext): void`, `stop(): void`, `consumeInterval(): EditorAnalyticsSnapshot`, `getIntervalSnapshot(): EditorAnalyticsSnapshot`, and test seams `recordChange(change, reason?)`, `recordSave()`, `recordFileSwitch(fileName)`, `sampleAttention(nowMs)`
  - `export function createEditorTracker(): EditorTracker`

**Design notes for the implementer:**
- `churnLines` counts lines that were inserted and then deleted **within 10 minutes**. Track insert timestamps in a rolling array of `{ atMs, lines }`; when a deletion occurs, consume from the newest entries still inside the window.
- `readMs` vs `writeMs`: `sampleAttention(nowMs)` is called on a 5-second interval. If an edit arrived since the previous sample, the elapsed time counts as `writeMs`, otherwise `readMs`. The caller only samples while the window is focused.
- A "large insert" is a single content change with `text.length > 80`. Count it; do **not** store the text.

- [ ] **Step 1: Write the failing test**

Create `extension/tests/trackers.test.js`:

```js
const assert = require('assert');
const path = require('path');
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');

const stub = createVscodeStub();
const restore = installVscodeStub(stub.vscode);
const { EditorTracker } = require(path.join(__dirname, '..', 'dist', 'extension.js'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\nEditorTracker');

check('counts gross insertions and deletions separately', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'hello\nworld', rangeLength: 0 });
  t.recordChange({ text: '', rangeLength: 5 });
  const s = t.consumeInterval();
  assert.strictEqual(s.charsInserted, 11);
  assert.strictEqual(s.charsDeleted, 5);
  assert.strictEqual(s.linesInserted, 1);
});

check('a replace-in-place edit is not invisible (regression: net lineCount delta)', () => {
  const t = new EditorTracker();
  // Delete 10 lines, write 10 back: the old net-delta metric reported zero.
  t.recordChange({ text: '', rangeLength: 200, linesRemoved: 10 });
  t.recordChange({ text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', rangeLength: 0 });
  const s = t.consumeInterval();
  assert.ok(s.charsInserted > 0, 'insertions recorded');
  assert.ok(s.charsDeleted > 0, 'deletions recorded');
});

check('counts lines written then deleted within 10 min as churn', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'a\nb\nc\nd', rangeLength: 0 }, undefined, 1_000_000);
  t.recordChange({ text: '', rangeLength: 8, linesRemoved: 3 }, undefined, 1_060_000); // 1 min later
  const s = t.consumeInterval();
  assert.strictEqual(s.churnLines, 3);
});

check('deletions after the 10 minute window are not churn', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'a\nb\nc\nd', rangeLength: 0 }, undefined, 1_000_000);
  t.recordChange({ text: '', rangeLength: 8, linesRemoved: 3 }, undefined, 1_700_000); // 11.6 min later
  const s = t.consumeInterval();
  assert.strictEqual(s.churnLines, 0);
});

check('counts undo and redo', () => {
  const t = new EditorTracker();
  t.recordChange({ text: '', rangeLength: 3 }, 1); // Undo
  t.recordChange({ text: 'x', rangeLength: 0 }, 2); // Redo
  const s = t.consumeInterval();
  assert.strictEqual(s.undoCount, 1);
  assert.strictEqual(s.redoCount, 1);
});

check('counts file switches and unique files', () => {
  const t = new EditorTracker();
  t.recordFileSwitch('a.ts');
  t.recordFileSwitch('b.ts');
  t.recordFileSwitch('a.ts');
  const s = t.consumeInterval();
  assert.strictEqual(s.fileSwitches, 3);
  assert.strictEqual(s.uniqueFiles, 2);
});

check('splits attention into read and write time', () => {
  const t = new EditorTracker();
  t.sampleAttention(0);
  t.recordChange({ text: 'x', rangeLength: 0 }, undefined, 1000);
  t.sampleAttention(5000);   // edit happened -> write
  t.sampleAttention(10000);  // no edit since -> read
  const s = t.consumeInterval();
  assert.strictEqual(s.writeMs, 5000);
  assert.strictEqual(s.readMs, 5000);
});

check('flags large inserts without storing their text', () => {
  const t = new EditorTracker();
  t.recordChange({ text: 'y'.repeat(200), rangeLength: 0 });
  const s = t.consumeInterval();
  assert.strictEqual(s.largeInsertCount, 1);
  assert.strictEqual(s.largeInsertChars, 200);
  assert.ok(!JSON.stringify(s).includes('yyy'), 'snapshot must not contain inserted text');
});

check('consumeInterval resets the counters', () => {
  const t = new EditorTracker();
  t.recordSave();
  assert.strictEqual(t.consumeInterval().saveCount, 1);
  assert.strictEqual(t.consumeInterval().saveCount, 0);
});

restore();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm run build && node tests/trackers.test.js`
Expected: FAIL — `EditorTracker is not a constructor` (not yet exported from the bundle)

- [ ] **Step 3: Write the implementation**

Create `extension/src/editorTracker.ts`:

```ts
/**
 * Editor Analytics Tracker
 * Accumulates gross edit volume, churn, attention split and navigation
 * counters for the current flush interval.
 *
 * Replaces the net `doc.lineCount` delta, which reported zero for any
 * replace-in-place edit (i.e. most refactoring).
 */

import * as vscode from "vscode";

const CHURN_WINDOW_MS = 10 * 60 * 1000;
const LARGE_INSERT_CHARS = 80;
const ATTENTION_SAMPLE_MS = 5000;

export interface EditorAnalyticsSnapshot {
  charsInserted: number;
  charsDeleted: number;
  linesInserted: number;
  linesDeleted: number;
  churnLines: number;
  undoCount: number;
  redoCount: number;
  saveCount: number;
  fileSwitches: number;
  uniqueFiles: number;
  readMs: number;
  writeMs: number;
  largeInsertCount: number;
  largeInsertChars: number;
}

interface ChangeLike {
  text?: string;
  rangeLength?: number;
  /** Optional explicit removed-line count; otherwise derived from the range. */
  linesRemoved?: number;
  range?: { start: { line: number }; end: { line: number } };
}

interface InsertRecord {
  atMs: number;
  lines: number;
}

export class EditorTracker {
  private subscriptions: vscode.Disposable[] = [];
  private sampler?: NodeJS.Timeout;

  private counters = EditorTracker.empty();
  private files = new Set<string>();
  private recentInserts: InsertRecord[] = [];
  private lastEditMs = 0;
  private lastSampleMs = 0;

  private static empty(): EditorAnalyticsSnapshot {
    return {
      charsInserted: 0,
      charsDeleted: 0,
      linesInserted: 0,
      linesDeleted: 0,
      churnLines: 0,
      undoCount: 0,
      redoCount: 0,
      saveCount: 0,
      fileSwitches: 0,
      uniqueFiles: 0,
      readMs: 0,
      writeMs: 0,
      largeInsertCount: 0,
      largeInsertChars: 0,
    };
  }

  public start(context: vscode.ExtensionContext): void {
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const change of event.contentChanges || []) {
          this.recordChange(change as ChangeLike, (event as any).reason);
        }
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.recordSave()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document?.fileName) {
          this.recordFileSwitch(editor.document.fileName);
        }
      })
    );

    this.lastSampleMs = Date.now();
    this.sampler = setInterval(() => {
      // Only attribute attention while the window actually has focus.
      if (vscode.window.state?.focused !== false) {
        this.sampleAttention(Date.now());
      } else {
        this.lastSampleMs = Date.now();
      }
    }, ATTENTION_SAMPLE_MS);

    context.subscriptions.push(...this.subscriptions);
  }

  public stop(): void {
    if (this.sampler) {
      clearInterval(this.sampler);
      this.sampler = undefined;
    }
    this.subscriptions.forEach((s) => s.dispose());
    this.subscriptions = [];
  }

  public recordChange(change: ChangeLike, reason?: number, nowMs?: number): void {
    const now = nowMs ?? Date.now();
    const text = change.text || "";
    const removedChars = Number(change.rangeLength) || 0;

    if (reason === 1) this.counters.undoCount += 1;
    if (reason === 2) this.counters.redoCount += 1;

    if (text.length > 0) {
      this.counters.charsInserted += text.length;
      const insertedLines = (text.match(/\n/g) || []).length;
      this.counters.linesInserted += insertedLines;

      if (text.length > LARGE_INSERT_CHARS) {
        this.counters.largeInsertCount += 1;
        this.counters.largeInsertChars += text.length;
      }
      if (insertedLines > 0) {
        this.recentInserts.push({ atMs: now, lines: insertedLines });
      }
    }

    if (removedChars > 0) {
      this.counters.charsDeleted += removedChars;
      const removedLines =
        typeof change.linesRemoved === "number"
          ? change.linesRemoved
          : change.range
          ? change.range.end.line - change.range.start.line
          : 0;
      this.counters.linesDeleted += removedLines;
      if (removedLines > 0) this.consumeChurn(removedLines, now);
    }

    this.lastEditMs = now;
  }

  /** Attribute deleted lines against still-fresh insertions. */
  private consumeChurn(removedLines: number, nowMs: number): void {
    this.recentInserts = this.recentInserts.filter(
      (r) => nowMs - r.atMs <= CHURN_WINDOW_MS
    );

    let remaining = removedLines;
    for (let i = this.recentInserts.length - 1; i >= 0 && remaining > 0; i--) {
      const record = this.recentInserts[i];
      const taken = Math.min(record.lines, remaining);
      record.lines -= taken;
      remaining -= taken;
      this.counters.churnLines += taken;
      if (record.lines === 0) this.recentInserts.splice(i, 1);
    }
  }

  public recordSave(): void {
    this.counters.saveCount += 1;
  }

  public recordFileSwitch(fileName: string): void {
    this.counters.fileSwitches += 1;
    this.files.add(fileName);
  }

  /** Called on a fixed interval; splits elapsed time into read vs write. */
  public sampleAttention(nowMs: number): void {
    const elapsed = nowMs - this.lastSampleMs;
    this.lastSampleMs = nowMs;
    if (elapsed <= 0) return;

    if (this.lastEditMs > nowMs - elapsed) {
      this.counters.writeMs += elapsed;
    } else {
      this.counters.readMs += elapsed;
    }
  }

  public getIntervalSnapshot(): EditorAnalyticsSnapshot {
    return { ...this.counters, uniqueFiles: this.files.size };
  }

  public consumeInterval(): EditorAnalyticsSnapshot {
    const snapshot = this.getIntervalSnapshot();
    this.counters = EditorTracker.empty();
    this.files.clear();
    this.recentInserts = [];
    return snapshot;
  }
}

export function createEditorTracker(): EditorTracker {
  return new EditorTracker();
}
```

- [ ] **Step 4: Export it from the bundle for tests**

In `extension/src/extension.ts`, add near the imports:

```ts
import { EditorTracker, createEditorTracker } from "./editorTracker";
```

and at the end of the file:

```ts
// Re-exported so tests can exercise the trackers through the built bundle.
export { EditorTracker };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extension && npm run build && node tests/trackers.test.js`
Expected: `9 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add extension/src/editorTracker.ts extension/src/extension.ts extension/tests/trackers.test.js
git commit -m "feat(extension): add EditorTracker with gross edit, churn and attention metrics

Replaces the net lineCount delta, which recorded zero for replace-in-place edits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: FocusTracker — window focus and flow blocks

**Files:**
- Create: `extension/src/focusTracker.ts`
- Modify: `extension/tests/trackers.test.js` (append a `FocusTracker` section)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface FocusAnalyticsSnapshot { focusedMs, blurredMs, blurEvents, flowBlocksMs: number[], longestBlockMs }`
  - `export class FocusTracker` with `start(context)`, `stop()`, `consumeInterval(): FocusAnalyticsSnapshot`, `getIntervalSnapshot()`, and test seams `noteActivity(nowMs)`, `setFocused(focused: boolean, nowMs: number)`, `tick(nowMs: number)`
  - `export function createFocusTracker(): FocusTracker`

**Design notes for the implementer:**
- A **flow block** starts at the first activity after a gap and ends when 2 minutes pass with no activity, or on blur lasting ≥2 minutes. On close, push its duration to `flowBlocksMs`.
- `tick(nowMs)` is called on an interval to close blocks that have gone idle; it must be callable with an explicit clock for testing.
- An open block at `consumeInterval()` time stays open — do not emit partial blocks, or a long block would be split across flushes and destroy the metric.

- [ ] **Step 1: Write the failing test**

Append to `extension/tests/trackers.test.js`, immediately before the `restore();` line:

```js
console.log('\nFocusTracker');
const { FocusTracker } = require(path.join(__dirname, '..', 'dist', 'extension.js'));

check('accumulates focused and blurred time', () => {
  const t = new FocusTracker();
  t.setFocused(true, 0);
  t.setFocused(false, 10_000);
  t.setFocused(true, 25_000);
  t.tick(30_000);
  const s = t.consumeInterval();
  assert.strictEqual(s.focusedMs, 15_000);
  assert.strictEqual(s.blurredMs, 15_000);
  assert.strictEqual(s.blurEvents, 1);
});

check('closes a flow block after 2 minutes idle', () => {
  const t = new FocusTracker();
  t.setFocused(true, 0);
  t.noteActivity(0);
  t.noteActivity(60_000);        // 1 min of work
  t.tick(200_000);               // >2 min since last activity -> close
  const s = t.consumeInterval();
  assert.deepStrictEqual(s.flowBlocksMs, [60_000]);
  assert.strictEqual(s.longestBlockMs, 60_000);
});

check('a gap starts a new block rather than extending the old one', () => {
  const t = new FocusTracker();
  t.setFocused(true, 0);
  t.noteActivity(0);
  t.noteActivity(30_000);
  t.tick(200_000);               // closes block 1 (30s)
  t.noteActivity(300_000);       // new block starts
  t.noteActivity(360_000);
  t.tick(500_000);               // closes block 2 (60s)
  const s = t.consumeInterval();
  assert.deepStrictEqual(s.flowBlocksMs, [30_000, 60_000]);
  assert.strictEqual(s.longestBlockMs, 60_000);
});

check('an open block is not emitted until it closes', () => {
  const t = new FocusTracker();
  t.setFocused(true, 0);
  t.noteActivity(0);
  t.noteActivity(60_000);
  const s = t.consumeInterval();          // still active
  assert.deepStrictEqual(s.flowBlocksMs, []);
  t.tick(300_000);
  assert.deepStrictEqual(t.consumeInterval().flowBlocksMs, [60_000]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm run build && node tests/trackers.test.js`
Expected: FAIL — `FocusTracker is not a constructor`

- [ ] **Step 3: Write the implementation**

Create `extension/src/focusTracker.ts`:

```ts
/**
 * Window Focus + Flow Block Tracker
 *
 * Focus state removes phantom time (VS Code open but not the foreground app).
 * Flow blocks capture the *shape* of a session: eighteen 5-minute blocks and
 * one 90-minute block both total 90 minutes but are very different days.
 */

import * as vscode from "vscode";

const BLOCK_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const TICK_MS = 15_000;

export interface FocusAnalyticsSnapshot {
  focusedMs: number;
  blurredMs: number;
  blurEvents: number;
  flowBlocksMs: number[];
  longestBlockMs: number;
}

export class FocusTracker {
  private subscriptions: vscode.Disposable[] = [];
  private ticker?: NodeJS.Timeout;

  private focused = true;
  private lastStateChangeMs = Date.now();
  private focusedMs = 0;
  private blurredMs = 0;
  private blurEvents = 0;

  private blockStartMs?: number;
  private lastActivityMs = 0;
  private blocks: number[] = [];

  public start(context: vscode.ExtensionContext): void {
    this.lastStateChangeMs = Date.now();
    this.focused = vscode.window.state?.focused !== false;

    this.subscriptions.push(
      vscode.window.onDidChangeWindowState((windowState) => {
        this.setFocused(!!windowState.focused, Date.now());
      })
    );

    this.ticker = setInterval(() => this.tick(Date.now()), TICK_MS);
    context.subscriptions.push(...this.subscriptions);
  }

  public stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    this.subscriptions.forEach((s) => s.dispose());
    this.subscriptions = [];
  }

  public setFocused(focused: boolean, nowMs: number): void {
    this.accrue(nowMs);
    if (this.focused && !focused) this.blurEvents += 1;
    this.focused = focused;
  }

  /** Called whenever the user edits or navigates. */
  public noteActivity(nowMs: number): void {
    if (this.blockStartMs === undefined) {
      this.blockStartMs = nowMs;
    }
    this.lastActivityMs = nowMs;
  }

  /** Closes an idle block. Safe to call on a timer. */
  public tick(nowMs: number): void {
    this.accrue(nowMs);
    if (
      this.blockStartMs !== undefined &&
      nowMs - this.lastActivityMs >= BLOCK_IDLE_TIMEOUT_MS
    ) {
      const duration = this.lastActivityMs - this.blockStartMs;
      if (duration > 0) this.blocks.push(duration);
      this.blockStartMs = undefined;
    }
  }

  private accrue(nowMs: number): void {
    const elapsed = nowMs - this.lastStateChangeMs;
    if (elapsed > 0) {
      if (this.focused) this.focusedMs += elapsed;
      else this.blurredMs += elapsed;
    }
    this.lastStateChangeMs = nowMs;
  }

  public getIntervalSnapshot(): FocusAnalyticsSnapshot {
    return {
      focusedMs: this.focusedMs,
      blurredMs: this.blurredMs,
      blurEvents: this.blurEvents,
      flowBlocksMs: [...this.blocks],
      longestBlockMs: this.blocks.reduce((max, b) => Math.max(max, b), 0),
    };
  }

  public consumeInterval(): FocusAnalyticsSnapshot {
    const snapshot = this.getIntervalSnapshot();
    this.focusedMs = 0;
    this.blurredMs = 0;
    this.blurEvents = 0;
    this.blocks = [];
    // An in-progress block is deliberately left open.
    return snapshot;
  }
}

export function createFocusTracker(): FocusTracker {
  return new FocusTracker();
}
```

- [ ] **Step 4: Export it from the bundle**

In `extension/src/extension.ts`, add the import and extend the re-export:

```ts
import { FocusTracker, createFocusTracker } from "./focusTracker";
// ...
export { EditorTracker, FocusTracker };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extension && npm run build && node tests/trackers.test.js`
Expected: `13 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add extension/src/focusTracker.ts extension/src/extension.ts extension/tests/trackers.test.js
git commit -m "feat(extension): add FocusTracker for window focus and flow blocks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: GitStateTracker — commits via the Git extension API

**Files:**
- Create: `extension/src/gitStateTracker.ts`
- Modify: `extension/tests/trackers.test.js` (append a `GitStateTracker` section)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export interface GitAnalyticsSnapshot { commits, filesChanged, uncommittedFiles, uncommittedAgeMs }`
  - `export class GitStateTracker` with `start(context)`, `stop()`, `consumeInterval(): GitAnalyticsSnapshot`, `getIntervalSnapshot()`, and test seam `handleStateChange(state, nowMs)`
  - `export function createGitStateTracker(): GitStateTracker`

**Design notes for the implementer:**
- `gitTracker.ts` (terminal command classification) stays as-is; this tracker is additive and catches GUI commits that the terminal path misses.
- `state` shape from the Git API: `{ HEAD: { commit: string, name: string }, workingTreeChanges: any[], indexChanges: any[] }`.
- A commit is detected when `HEAD.commit` changes to a value we have not already counted.
- `uncommittedAgeMs` = time since the working tree first became dirty while staying dirty. Reset when it goes clean.
- If the Git extension is absent, `start()` must no-op silently — never throw.

- [ ] **Step 1: Write the failing test**

Append to `extension/tests/trackers.test.js`, before `restore();`:

```js
console.log('\nGitStateTracker');
const { GitStateTracker } = require(path.join(__dirname, '..', 'dist', 'extension.js'));

check('counts a commit when HEAD moves', () => {
  const t = new GitStateTracker();
  t.handleStateChange({ HEAD: { commit: 'aaa' }, workingTreeChanges: [], indexChanges: [] }, 0);
  t.handleStateChange({ HEAD: { commit: 'bbb' }, workingTreeChanges: [], indexChanges: [] }, 1000);
  assert.strictEqual(t.consumeInterval().commits, 1);
});

check('does not double-count an unchanged HEAD', () => {
  const t = new GitStateTracker();
  t.handleStateChange({ HEAD: { commit: 'aaa' }, workingTreeChanges: [], indexChanges: [] }, 0);
  t.handleStateChange({ HEAD: { commit: 'aaa' }, workingTreeChanges: [], indexChanges: [] }, 1000);
  t.handleStateChange({ HEAD: { commit: 'aaa' }, workingTreeChanges: [], indexChanges: [] }, 2000);
  assert.strictEqual(t.consumeInterval().commits, 0);
});

check('tracks uncommitted work age while the tree stays dirty', () => {
  const t = new GitStateTracker();
  t.handleStateChange({ HEAD: { commit: 'a' }, workingTreeChanges: [{}, {}], indexChanges: [] }, 1_000_000);
  t.handleStateChange({ HEAD: { commit: 'a' }, workingTreeChanges: [{}, {}], indexChanges: [] }, 1_060_000);
  const s = t.consumeInterval();
  assert.strictEqual(s.uncommittedFiles, 2);
  assert.strictEqual(s.uncommittedAgeMs, 60_000);
});

check('resets uncommitted age when the tree goes clean', () => {
  const t = new GitStateTracker();
  t.handleStateChange({ HEAD: { commit: 'a' }, workingTreeChanges: [{}], indexChanges: [] }, 0);
  t.handleStateChange({ HEAD: { commit: 'a' }, workingTreeChanges: [], indexChanges: [] }, 60_000);
  const s = t.consumeInterval();
  assert.strictEqual(s.uncommittedFiles, 0);
  assert.strictEqual(s.uncommittedAgeMs, 0);
});

check('start() is a no-op when the Git extension is unavailable', () => {
  const t = new GitStateTracker();
  t.start({ subscriptions: [] });   // stub has no vscode.git extension
  assert.deepStrictEqual(t.consumeInterval().commits, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm run build && node tests/trackers.test.js`
Expected: FAIL — `GitStateTracker is not a constructor`

- [ ] **Step 3: Write the implementation**

Create `extension/src/gitStateTracker.ts`:

```ts
/**
 * Git State Tracker
 *
 * Reads commits from the built-in Git extension rather than parsing terminal
 * commands, so commits made through the Source Control panel, GitLens or any
 * GUI are counted. Terminal-based git classification (gitTracker.ts) remains
 * for command-usage stats.
 *
 * Never transmits commit messages, diffs or branch contents.
 */

import * as vscode from "vscode";

export interface GitAnalyticsSnapshot {
  commits: number;
  filesChanged: number;
  uncommittedFiles: number;
  uncommittedAgeMs: number;
}

interface RepoStateLike {
  HEAD?: { commit?: string; name?: string };
  workingTreeChanges?: unknown[];
  indexChanges?: unknown[];
}

export class GitStateTracker {
  private subscriptions: vscode.Disposable[] = [];

  private lastCommit?: string;
  private commits = 0;
  private filesChanged = 0;

  private dirtySinceMs?: number;
  private uncommittedFiles = 0;
  private uncommittedAgeMs = 0;

  public start(context: vscode.ExtensionContext): void {
    try {
      const extension = vscode.extensions.getExtension("vscode.git");
      const api = extension?.exports?.getAPI?.(1);
      if (!api) {
        console.log("CodeTrackr: Git extension unavailable, skipping git tracking");
        return;
      }

      const attach = (repo: any) => {
        this.handleStateChange(repo.state, Date.now());
        const sub = repo.state.onDidChange(() =>
          this.handleStateChange(repo.state, Date.now())
        );
        this.subscriptions.push(sub);
      };

      (api.repositories || []).forEach(attach);
      if (typeof api.onDidOpenRepository === "function") {
        this.subscriptions.push(api.onDidOpenRepository(attach));
      }

      context.subscriptions.push(...this.subscriptions);
      console.log("Git state tracker started");
    } catch (err) {
      console.log(`CodeTrackr: git tracking unavailable (${err})`);
    }
  }

  public stop(): void {
    this.subscriptions.forEach((s) => {
      try {
        s.dispose();
      } catch {
        // ignore
      }
    });
    this.subscriptions = [];
  }

  public handleStateChange(state: RepoStateLike, nowMs: number): void {
    const head = state?.HEAD?.commit;

    if (head) {
      if (this.lastCommit === undefined) {
        this.lastCommit = head;
      } else if (head !== this.lastCommit) {
        this.commits += 1;
        this.filesChanged += this.uncommittedFiles;
        this.lastCommit = head;
      }
    }

    const working = state?.workingTreeChanges?.length || 0;
    const staged = state?.indexChanges?.length || 0;
    const dirty = working + staged;

    this.uncommittedFiles = dirty;

    if (dirty > 0) {
      if (this.dirtySinceMs === undefined) this.dirtySinceMs = nowMs;
      this.uncommittedAgeMs = nowMs - this.dirtySinceMs;
    } else {
      this.dirtySinceMs = undefined;
      this.uncommittedAgeMs = 0;
    }
  }

  public getIntervalSnapshot(): GitAnalyticsSnapshot {
    return {
      commits: this.commits,
      filesChanged: this.filesChanged,
      uncommittedFiles: this.uncommittedFiles,
      uncommittedAgeMs: this.uncommittedAgeMs,
    };
  }

  public consumeInterval(): GitAnalyticsSnapshot {
    const snapshot = this.getIntervalSnapshot();
    this.commits = 0;
    this.filesChanged = 0;
    // uncommittedFiles / uncommittedAgeMs are point-in-time gauges, not counters.
    return snapshot;
  }
}

export function createGitStateTracker(): GitStateTracker {
  return new GitStateTracker();
}
```

- [ ] **Step 4: Export it from the bundle**

In `extension/src/extension.ts`:

```ts
import { GitStateTracker, createGitStateTracker } from "./gitStateTracker";
// ...
export { EditorTracker, FocusTracker, GitStateTracker };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd extension && npm run build && node tests/trackers.test.js`
Expected: `18 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add extension/src/gitStateTracker.ts extension/src/extension.ts extension/tests/trackers.test.js
git commit -m "feat(extension): track commits via Git extension API

Terminal parsing missed every commit made through the Source Control panel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire trackers into the flush payload

**Files:**
- Modify: `extension/src/extension.ts`
- Modify: `extension/tests/activation.test.js`
- Modify: `extension/package.json` (run both test files)

**Interfaces:**
- Consumes: `EditorTracker`, `FocusTracker`, `GitStateTracker` from Tasks 2–4
- Produces: the `/api/extension/track` payload gains `editorAnalytics`, `focusAnalytics`, `gitAnalytics`. `linesAdded`/`linesRemoved` remain in the payload (backend compatibility) but are now sourced from gross counters.

- [ ] **Step 1: Write the failing test**

In `extension/tests/activation.test.js`, replace the whole inline stub block (from `const disposable = ...` down to the `Module._load` override) with:

```js
const { createVscodeStub, installVscodeStub } = require('./helpers/vscodeStub');
const stub = createVscodeStub();
const { vscode: vscodeStub, emit, registeredCommands, warnings, infos, settings } = stub;
const restoreLoader = installVscodeStub(vscodeStub);
```

Then append this section immediately before `await ext.deactivate();`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extension && npm test`
Expected: FAIL — `ext.buildPayloadForTest is not a function`

- [ ] **Step 3: Modify `extension.ts`**

**3a.** Add module-level tracker variables next to the existing ones:

```ts
let editorTracker: EditorTracker;
let focusTracker: FocusTracker;
let gitStateTracker: GitStateTracker;
```

**3b.** Delete the `linesAdded`/`linesRemoved` accumulation inside `onDidChangeTextDocument` (the whole `try { ... } catch { ... }` block that diffs `doc.lineCount`) and the `lineCounts` map together with `initLineCountForDocument`. Replace the handler body with:

```ts
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Volume is accumulated by EditorTracker; this only refreshes idle state.
      focusTracker?.noteActivity(Date.now());
      markActivity(event.document.fileName);
    })
```

Remove the three now-unused `initLineCountForDocument(...)` calls in the other document listeners, and the `vscode.workspace.textDocuments.forEach(initLineCountForDocument);` line.

**3c.** Delete the `linesAdded` / `linesRemoved` properties from the `AppState` interface and the `state` object, and delete the two reset lines at the end of `sendActivity`.

`showStats()` currently reads both (`Lines +${state.linesAdded}/-${state.linesRemoved}`) and will not compile once they are gone. Replace that segment of the message with live tracker data:

```ts
  const editorSnapshot = editorTracker?.getIntervalSnapshot();
  const focusSnapshot = focusTracker?.getIntervalSnapshot();
```

and swap the `Lines +.../-...` fragment for:

```ts
      `Lines +${editorSnapshot?.linesInserted ?? 0}/-${editorSnapshot?.linesDeleted ?? 0} ` +
      `(churn ${editorSnapshot?.churnLines ?? 0}) · ` +
      `Focus: ${Math.round((focusSnapshot?.focusedMs ?? 0) / 60000)} min, ` +
      `longest block ${Math.round((focusSnapshot?.longestBlockMs ?? 0) / 60000)} min · `
```

Run `npm run typecheck` after this step; it must pass before continuing.

**3d.** Add a payload builder and use it in `sendActivity`. Insert above `sendActivity`:

```ts
/** Composes the flush payload. Exported for tests via buildPayloadForTest. */
function buildPayload(durationSeconds: number, fileOpened?: string) {
  const fullPath =
    fileOpened || vscode.window.activeTextEditor?.document?.fileName || "unknown";
  const { fileType, projectName, language } = getFileMeta(fullPath);

  const terminalAnalytics = terminalTracker?.consumeInterval() || emptyTerminalAnalytics();
  const editorAnalytics = editorTracker?.consumeInterval() || emptyEditorAnalytics();
  const focusAnalytics = focusTracker?.consumeInterval() || emptyFocusAnalytics();
  const gitAnalytics = gitStateTracker?.consumeInterval() || emptyGitAnalytics();

  const debugCounts = debugTracker?.consumeInterval();
  if (debugCounts) {
    terminalAnalytics.debuggingSessions += debugCounts.debugSessions;
  }

  return {
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

function emptyEditorAnalytics() {
  return {
    charsInserted: 0, charsDeleted: 0, linesInserted: 0, linesDeleted: 0,
    churnLines: 0, undoCount: 0, redoCount: 0, saveCount: 0,
    fileSwitches: 0, uniqueFiles: 0, readMs: 0, writeMs: 0,
    largeInsertCount: 0, largeInsertChars: 0,
  };
}

function emptyFocusAnalytics() {
  return { focusedMs: 0, blurredMs: 0, blurEvents: 0, flowBlocksMs: [] as number[], longestBlockMs: 0 };
}

function emptyGitAnalytics() {
  return { commits: 0, filesChanged: 0, uncommittedFiles: 0, uncommittedAgeMs: 0 };
}

/** Test seam: build a payload without performing the network call. */
export function buildPayloadForTest(durationSeconds: number) {
  return buildPayload(durationSeconds);
}
```

**3e.** In `sendActivity`, replace the block that builds `terminalAnalytics`, `debugCounts` and `payload` with:

```ts
  const payload = buildPayload(durationSeconds, fileOpened);
```

keeping the existing `durationSeconds` guards above it and the axios call below it. Delete the trailing `state.linesAdded = 0; state.linesRemoved = 0;` lines.

**3f.** In `activate`, start the new trackers after `terminalTracker.start(context);`:

```ts
    editorTracker = createEditorTracker();
    editorTracker.start(context);

    focusTracker = createFocusTracker();
    focusTracker.start(context);

    gitStateTracker = createGitStateTracker();
    gitStateTracker.start(context);
```

**3g.** In `deactivate`, stop them alongside the others:

```ts
    editorTracker?.stop();
    focusTracker?.stop();
    gitStateTracker?.stop();
```

**3h.** In `markActivity`, notify the focus tracker so flow blocks track real activity:

```ts
function markActivity(fileNameMaybe?: string): void {
  state.lastActivityMs = Date.now();
  focusTracker?.noteActivity(state.lastActivityMs);
  // ...rest unchanged
```

- [ ] **Step 4: Update the test script to run both files**

In `extension/package.json`:

```json
"test": "node tests/trackers.test.js && node tests/activation.test.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd extension && npm test`
Expected: trackers `18 passed, 0 failed`, then activation `14 passed, 0 failed`

- [ ] **Step 6: Commit**

```bash
git add extension/src/extension.ts extension/tests/activation.test.js extension/package.json
git commit -m "feat(extension): attach editor, focus and git analytics to flush payload

Removes the net lineCount delta entirely; linesAdded/linesRemoved now come
from gross counters and remain in the payload for backend compatibility.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Backend schema and ingest normalisation

**Files:**
- Modify: `backend/models/Activity.js`
- Modify: `backend/routes/extension.js`
- Create: `backend/tests/ingest.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: the payload shape from Task 5
- Produces:
  - `normalizeEditorAnalytics(body) -> object` — exported from `routes/extension.js`
  - `normalizeFocusAnalytics(body) -> object`
  - `normalizeGitAnalytics(body) -> object`
  - All three exported as `module.exports.router` plus named normalisers; `app.js` must then mount `require('./routes/extension').router`.

**Important:** `routes/extension.js` currently does `module.exports = router`. Changing it to an object **breaks `app.js`** unless `app.js` is updated in the same commit. Do both in Step 3.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/ingest.test.js`:

```js
const assert = require('assert');
const { normalizeEditorAnalytics, normalizeFocusAnalytics, normalizeGitAnalytics } =
  require('../routes/extension');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}

console.log('\nnormalizeEditorAnalytics');

check('defaults every field to 0 for a v2.0.11 payload with no editorAnalytics', () => {
  const r = normalizeEditorAnalytics({});
  assert.strictEqual(r.charsInserted, 0);
  assert.strictEqual(r.churnLines, 0);
  assert.strictEqual(r.readMs, 0);
});

check('passes through supplied numbers', () => {
  const r = normalizeEditorAnalytics({ editorAnalytics: { charsInserted: 120, churnLines: 8, readMs: 4000 } });
  assert.strictEqual(r.charsInserted, 120);
  assert.strictEqual(r.churnLines, 8);
  assert.strictEqual(r.readMs, 4000);
});

check('coerces junk to 0 rather than NaN', () => {
  const r = normalizeEditorAnalytics({ editorAnalytics: { charsInserted: 'abc', saveCount: null } });
  assert.strictEqual(r.charsInserted, 0);
  assert.strictEqual(r.saveCount, 0);
});

check('rejects negative values', () => {
  const r = normalizeEditorAnalytics({ editorAnalytics: { charsInserted: -50 } });
  assert.strictEqual(r.charsInserted, 0);
});

console.log('\nnormalizeFocusAnalytics');

check('keeps flowBlocksMs as an array of positive numbers', () => {
  const r = normalizeFocusAnalytics({ focusAnalytics: { flowBlocksMs: [1000, -5, 'x', 2000] } });
  assert.deepStrictEqual(r.flowBlocksMs, [1000, 2000]);
});

check('caps flowBlocksMs length to prevent unbounded documents', () => {
  const many = Array.from({ length: 500 }, () => 1000);
  const r = normalizeFocusAnalytics({ focusAnalytics: { flowBlocksMs: many } });
  assert.ok(r.flowBlocksMs.length <= 200, `got ${r.flowBlocksMs.length}`);
});

check('defaults to an empty array when absent', () => {
  assert.deepStrictEqual(normalizeFocusAnalytics({}).flowBlocksMs, []);
});

console.log('\nnormalizeGitAnalytics');

check('defaults and passes through', () => {
  assert.strictEqual(normalizeGitAnalytics({}).commits, 0);
  assert.strictEqual(normalizeGitAnalytics({ gitAnalytics: { commits: 3 } }).commits, 3);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node tests/ingest.test.js`
Expected: FAIL — `normalizeEditorAnalytics is not a function`

- [ ] **Step 3: Implement the normalisers and schema**

**3a.** In `backend/models/Activity.js`, add before the closing `}, { timestamps: true });`:

```js
    editorAnalytics: {
        charsInserted: { type: Number, default: 0 },
        charsDeleted: { type: Number, default: 0 },
        linesInserted: { type: Number, default: 0 },
        linesDeleted: { type: Number, default: 0 },
        churnLines: { type: Number, default: 0 },
        undoCount: { type: Number, default: 0 },
        redoCount: { type: Number, default: 0 },
        saveCount: { type: Number, default: 0 },
        fileSwitches: { type: Number, default: 0 },
        uniqueFiles: { type: Number, default: 0 },
        readMs: { type: Number, default: 0 },
        writeMs: { type: Number, default: 0 },
        largeInsertCount: { type: Number, default: 0 },
        largeInsertChars: { type: Number, default: 0 }
    },
    focusAnalytics: {
        focusedMs: { type: Number, default: 0 },
        blurredMs: { type: Number, default: 0 },
        blurEvents: { type: Number, default: 0 },
        flowBlocksMs: { type: [Number], default: [] },
        longestBlockMs: { type: Number, default: 0 }
    },
    gitAnalytics: {
        commits: { type: Number, default: 0 },
        filesChanged: { type: Number, default: 0 },
        uncommittedFiles: { type: Number, default: 0 },
        uncommittedAgeMs: { type: Number, default: 0 }
    },
```

**3b.** In `backend/routes/extension.js`, add above the route handlers:

```js
const MAX_FLOW_BLOCKS = 200;

/** Non-negative finite number, else 0. */
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

const EDITOR_FIELDS = [
    'charsInserted', 'charsDeleted', 'linesInserted', 'linesDeleted',
    'churnLines', 'undoCount', 'redoCount', 'saveCount',
    'fileSwitches', 'uniqueFiles', 'readMs', 'writeMs',
    'largeInsertCount', 'largeInsertChars'
];

function normalizeEditorAnalytics(body) {
    const source = body?.editorAnalytics || {};
    const result = {};
    for (const field of EDITOR_FIELDS) result[field] = num(source[field]);
    return result;
}

function normalizeFocusAnalytics(body) {
    const source = body?.focusAnalytics || {};
    const blocks = Array.isArray(source.flowBlocksMs) ? source.flowBlocksMs : [];
    const flowBlocksMs = blocks
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, MAX_FLOW_BLOCKS);

    return {
        focusedMs: num(source.focusedMs),
        blurredMs: num(source.blurredMs),
        blurEvents: num(source.blurEvents),
        flowBlocksMs,
        longestBlockMs: num(source.longestBlockMs)
    };
}

function normalizeGitAnalytics(body) {
    const source = body?.gitAnalytics || {};
    return {
        commits: num(source.commits),
        filesChanged: num(source.filesChanged),
        uncommittedFiles: num(source.uncommittedFiles),
        uncommittedAgeMs: num(source.uncommittedAgeMs)
    };
}
```

**3c.** In the `/track` handler, add the three fields to `Activity.create({ ... })`:

```js
            editorAnalytics: normalizeEditorAnalytics(req.body),
            focusAnalytics: normalizeFocusAnalytics(req.body),
            gitAnalytics: normalizeGitAnalytics(req.body),
```

and the same three inside the `/track/batch` `preparedActivities` map, using `normalizeEditorAnalytics(activity)` etc.

**3d.** Change the export at the bottom of `routes/extension.js`:

```js
module.exports = router;
module.exports.router = router;
module.exports.normalizeEditorAnalytics = normalizeEditorAnalytics;
module.exports.normalizeFocusAnalytics = normalizeFocusAnalytics;
module.exports.normalizeGitAnalytics = normalizeGitAnalytics;
```

Attaching the named exports to the router function keeps `app.js`'s existing `app.use('/api/extension', extensionRoutes)` working unchanged — **no `app.js` edit is needed**.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node tests/ingest.test.js`
Expected: `9 passed, 0 failed`

- [ ] **Step 5: Update the backend test script**

In `backend/package.json`:

```json
"test": "node tests/streak.test.js && node tests/ingest.test.js"
```

Run: `cd backend && npm test`
Expected: both suites pass.

- [ ] **Step 6: Commit**

```bash
git add backend/models/Activity.js backend/routes/extension.js backend/tests/ingest.test.js backend/package.json
git commit -m "feat(backend): accept editor, focus and git analytics on ingest

Additive schema; payloads from older extension versions still validate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: metricsService — the five derived metrics

**Files:**
- Create: `backend/services/metricsService.js`
- Create: `backend/tests/metrics.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: the schema from Task 6
- Produces (all exported from `metricsService.js`):
  - `deepWorkRatio(flowBlocksMs: number[], totalFocusedMs: number) -> number` (0–1, 2dp)
  - `flowBlockStats(flowBlocksMs: number[]) -> { medianMs, longestMs, deepBlockCount, blockCount }`
  - `consistencyIndex(dailyMinutes: number[]) -> number` (0–1, higher is steadier)
  - `truePeakWindow(hourly: Array<{hour, commits, linesInserted, churnLines, minutes}>) -> { hour, score } | null`
  - `estimationCalibration(pairs: Array<{estimatedHours, actualHours}>) -> { factor, sampleSize } | null`
  - `async buildMetrics(userId, { days, timezoneOffset }) -> object`

**Definitions the implementer must follow exactly:**
- `deepWorkRatio` = sum of blocks ≥ 25 min ÷ total focused ms. Returns 0 when `totalFocusedMs` is 0.
- `consistencyIndex` = `1 - (stddev ÷ mean)`, clamped to `[0, 1]`. Returns 0 when mean is 0.
- `truePeakWindow` score = `commits × 10 + linesInserted ÷ 10 − churnLines ÷ 5`, considering only hours with `minutes > 0`. Highest score wins; ties break toward the earlier hour.
- `estimationCalibration` factor = `mean(actualHours ÷ estimatedHours)`, ignoring pairs where `estimatedHours <= 0`. Returns `null` for fewer than 2 usable pairs.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/metrics.test.js`:

```js
const assert = require('assert');
const m = require('../services/metricsService');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}: ${err.message}`); failed++; }
}
const MIN = 60_000;

console.log('\ndeepWorkRatio');
check('counts only blocks of 25 minutes or more', () => {
  // 30 + 40 deep = 70 min of 100 min focused
  assert.strictEqual(m.deepWorkRatio([30*MIN, 40*MIN, 5*MIN, 5*MIN], 100*MIN), 0.7);
});
check('returns 0 when nothing is deep', () => {
  assert.strictEqual(m.deepWorkRatio([5*MIN, 10*MIN], 60*MIN), 0);
});
check('returns 0 rather than dividing by zero', () => {
  assert.strictEqual(m.deepWorkRatio([], 0), 0);
});

console.log('\nflowBlockStats');
check('reports median, longest and deep-block count', () => {
  const s = m.flowBlockStats([10*MIN, 30*MIN, 50*MIN]);
  assert.strictEqual(s.medianMs, 30*MIN);
  assert.strictEqual(s.longestMs, 50*MIN);
  assert.strictEqual(s.deepBlockCount, 2);
  assert.strictEqual(s.blockCount, 3);
});
check('median of an even-length set averages the middle two', () => {
  assert.strictEqual(m.flowBlockStats([10*MIN, 20*MIN, 30*MIN, 40*MIN]).medianMs, 25*MIN);
});
check('handles an empty set', () => {
  assert.deepStrictEqual(m.flowBlockStats([]), { medianMs: 0, longestMs: 0, deepBlockCount: 0, blockCount: 0 });
});

console.log('\nconsistencyIndex');
check('a perfectly steady week scores 1', () => {
  assert.strictEqual(m.consistencyIndex([60, 60, 60, 60]), 1);
});
check('an erratic week scores lower than a steady one', () => {
  const steady = m.consistencyIndex([50, 55, 60, 55]);
  const erratic = m.consistencyIndex([5, 200, 10, 180]);
  assert.ok(erratic < steady, `erratic ${erratic} should be < steady ${steady}`);
});
check('never returns a negative value', () => {
  assert.ok(m.consistencyIndex([0, 0, 500]) >= 0);
});
check('returns 0 for no activity', () => {
  assert.strictEqual(m.consistencyIndex([0, 0, 0]), 0);
});

console.log('\ntruePeakWindow');
check('prefers the productive hour over the merely busy one', () => {
  const result = m.truePeakWindow([
    { hour: 14, commits: 0, linesInserted: 100, churnLines: 400, minutes: 120 }, // busy, churny
    { hour: 21, commits: 4, linesInserted: 200, churnLines: 10, minutes: 60 },   // productive
  ]);
  assert.strictEqual(result.hour, 21);
});
check('ignores hours with no tracked time', () => {
  const result = m.truePeakWindow([
    { hour: 3, commits: 99, linesInserted: 0, churnLines: 0, minutes: 0 },
    { hour: 9, commits: 1, linesInserted: 10, churnLines: 0, minutes: 30 },
  ]);
  assert.strictEqual(result.hour, 9);
});
check('returns null with no usable data', () => {
  assert.strictEqual(m.truePeakWindow([]), null);
});

console.log('\nestimationCalibration');
check('detects consistent underestimation', () => {
  const r = m.estimationCalibration([
    { estimatedHours: 10, actualHours: 20 },
    { estimatedHours: 5, actualHours: 10 },
  ]);
  assert.strictEqual(r.factor, 2);
  assert.strictEqual(r.sampleSize, 2);
});
check('ignores goals with a zero estimate', () => {
  const r = m.estimationCalibration([
    { estimatedHours: 0, actualHours: 5 },
    { estimatedHours: 10, actualHours: 10 },
    { estimatedHours: 4, actualHours: 4 },
  ]);
  assert.strictEqual(r.sampleSize, 2);
  assert.strictEqual(r.factor, 1);
});
check('returns null below two samples', () => {
  assert.strictEqual(m.estimationCalibration([{ estimatedHours: 5, actualHours: 6 }]), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node tests/metrics.test.js`
Expected: FAIL — `Cannot find module '../services/metricsService'`

- [ ] **Step 3: Write the implementation**

Create `backend/services/metricsService.js`:

```js
/**
 * Derived productivity metrics.
 *
 * The exported helpers are PURE so they can be unit tested without a database.
 * buildMetrics() is the only function that touches MongoDB.
 *
 * See docs/TRACKING_ROADMAP.md Part 3 for the definitions these implement.
 */

const Activity = require('../models/Activity');
const Goal = require('../models/Goal');

const DEEP_BLOCK_MS = 25 * 60 * 1000;

// ---------- pure helpers ----------

function deepWorkRatio(flowBlocksMs, totalFocusedMs) {
    if (!Array.isArray(flowBlocksMs) || !totalFocusedMs || totalFocusedMs <= 0) return 0;
    const deepMs = flowBlocksMs
        .filter((b) => Number(b) >= DEEP_BLOCK_MS)
        .reduce((sum, b) => sum + Number(b), 0);
    return Math.round((deepMs / totalFocusedMs) * 100) / 100;
}

function flowBlockStats(flowBlocksMs) {
    const blocks = (Array.isArray(flowBlocksMs) ? flowBlocksMs : [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);

    if (blocks.length === 0) {
        return { medianMs: 0, longestMs: 0, deepBlockCount: 0, blockCount: 0 };
    }

    const mid = Math.floor(blocks.length / 2);
    const medianMs = blocks.length % 2 === 0
        ? (blocks[mid - 1] + blocks[mid]) / 2
        : blocks[mid];

    return {
        medianMs,
        longestMs: blocks[blocks.length - 1],
        deepBlockCount: blocks.filter((b) => b >= DEEP_BLOCK_MS).length,
        blockCount: blocks.length
    };
}

function consistencyIndex(dailyMinutes) {
    const values = (Array.isArray(dailyMinutes) ? dailyMinutes : []).map(Number).filter(Number.isFinite);
    if (values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean <= 0) return 0;

    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.round(Math.max(0, Math.min(1, 1 - cv)) * 100) / 100;
}

function truePeakWindow(hourly) {
    const rows = (Array.isArray(hourly) ? hourly : []).filter((h) => Number(h?.minutes) > 0);
    if (rows.length === 0) return null;

    let best = null;
    for (const row of rows) {
        const score =
            Number(row.commits || 0) * 10 +
            Number(row.linesInserted || 0) / 10 -
            Number(row.churnLines || 0) / 5;
        if (!best || score > best.score) {
            best = { hour: Number(row.hour), score: Math.round(score * 100) / 100 };
        }
    }
    return best;
}

function estimationCalibration(pairs) {
    const usable = (Array.isArray(pairs) ? pairs : []).filter(
        (p) => Number(p?.estimatedHours) > 0 && Number.isFinite(Number(p?.actualHours))
    );
    if (usable.length < 2) return null;

    const ratios = usable.map((p) => Number(p.actualHours) / Number(p.estimatedHours));
    const factor = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    return { factor: Math.round(factor * 100) / 100, sampleSize: usable.length };
}

// ---------- database-backed assembly ----------

async function buildMetrics(userId, { days = 30, timezoneOffset = 0 } = {}) {
    const userIdStr = String(userId);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const offsetMs = Number(timezoneOffset) * 60000;

    const [totals] = await Activity.aggregate([
        { $match: { userId: userIdStr, timestamp: { $gte: since } } },
        {
            $group: {
                _id: null,
                focusedMs: { $sum: { $ifNull: ['$focusAnalytics.focusedMs', 0] } },
                blocks: { $push: { $ifNull: ['$focusAnalytics.flowBlocksMs', []] } },
                churnLines: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } },
                linesInserted: { $sum: { $ifNull: ['$editorAnalytics.linesInserted', 0] } },
                readMs: { $sum: { $ifNull: ['$editorAnalytics.readMs', 0] } },
                writeMs: { $sum: { $ifNull: ['$editorAnalytics.writeMs', 0] } },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', 0] } }
            }
        }
    ]);

    const flowBlocksMs = (totals?.blocks || []).flat();

    const daily = await Activity.aggregate([
        { $match: { userId: userIdStr, timestamp: { $gte: since } } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: { $subtract: ['$timestamp', offsetMs] }
                    }
                },
                minutes: { $sum: { $divide: ['$duration', 60] } }
            }
        }
    ]);

    const hourly = await Activity.aggregate([
        { $match: { userId: userIdStr, timestamp: { $gte: since } } },
        {
            $group: {
                _id: { $hour: { date: '$timestamp', timezone: 'UTC' } },
                minutes: { $sum: { $divide: ['$duration', 60] } },
                commits: { $sum: { $ifNull: ['$gitAnalytics.commits', 0] } },
                linesInserted: { $sum: { $ifNull: ['$editorAnalytics.linesInserted', 0] } },
                churnLines: { $sum: { $ifNull: ['$editorAnalytics.churnLines', 0] } }
            }
        },
        { $project: { _id: 0, hour: '$_id', minutes: 1, commits: 1, linesInserted: 1, churnLines: 1 } }
    ]);

    const goals = await Goal.find({ userId, status: 'completed' }).lean();
    const goalPairs = [];
    for (const goal of goals) {
        const [actual] = await Activity.aggregate([
            { $match: { userId: userIdStr, language: goal.techStack, timestamp: { $lte: goal.updatedAt || new Date() } } },
            { $group: { _id: null, seconds: { $sum: '$duration' } } }
        ]);
        goalPairs.push({
            estimatedHours: goal.targetHours,
            actualHours: (actual?.seconds || 0) / 3600
        });
    }

    const totalWriteRead = (totals?.readMs || 0) + (totals?.writeMs || 0);

    return {
        windowDays: days,
        deepWorkRatio: deepWorkRatio(flowBlocksMs, totals?.focusedMs || 0),
        flowBlocks: flowBlockStats(flowBlocksMs),
        consistencyIndex: consistencyIndex(daily.map((d) => d.minutes)),
        truePeakWindow: truePeakWindow(hourly),
        estimationCalibration: estimationCalibration(goalPairs),
        churnRatio: totals?.linesInserted
            ? Math.round((totals.churnLines / totals.linesInserted) * 100) / 100
            : 0,
        comprehensionLoad: totalWriteRead
            ? Math.round((totals.readMs / totalWriteRead) * 100) / 100
            : 0,
        commits: totals?.commits || 0
    };
}

module.exports = {
    deepWorkRatio,
    flowBlockStats,
    consistencyIndex,
    truePeakWindow,
    estimationCalibration,
    buildMetrics
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node tests/metrics.test.js`
Expected: `16 passed, 0 failed`

- [ ] **Step 5: Update the backend test script and run everything**

```json
"test": "node tests/streak.test.js && node tests/ingest.test.js && node tests/metrics.test.js"
```

Run: `cd backend && npm test`
Expected: all three suites pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/metricsService.js backend/tests/metrics.test.js backend/package.json
git commit -m "feat(backend): add metricsService with five derived productivity metrics

Deep work ratio, flow block stats, consistency index, true peak window and
estimation calibration. Pure functions unit tested without a database.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Expose metrics over HTTP

**Files:**
- Create: `backend/routes/metrics.js`
- Modify: `backend/app.js`

**Interfaces:**
- Consumes: `buildMetrics` from Task 7
- Produces: `GET /api/metrics?days=30&timezone=-330` returning the `buildMetrics` object for **the authenticated user only**

**Security requirement:** this route must read the user from `req.user`, never from a path or query parameter. It must not repeat the IDOR pattern documented as H-1 in `IMPROVEMENT_PLAN.md`.

- [ ] **Step 1: Write the route**

Create `backend/routes/metrics.js`:

```js
const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { buildMetrics } = require('../services/metricsService');

const MAX_WINDOW_DAYS = 365;

// GET /api/metrics — derived productivity metrics for the signed-in user.
// The user is taken from the session only; there is deliberately no :userId
// parameter, so this route cannot leak another user's analytics.
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const requestedDays = parseInt(req.query.days, 10);
        const days = Number.isFinite(requestedDays)
            ? Math.min(Math.max(requestedDays, 1), MAX_WINDOW_DAYS)
            : 30;

        const requestedTz = parseInt(req.query.timezone, 10);
        const timezoneOffset = Number.isFinite(requestedTz) ? requestedTz : 0;

        const metrics = await buildMetrics(req.user._id.toString(), { days, timezoneOffset });
        res.json({ success: true, metrics });
    } catch (error) {
        console.error('Error building metrics:', error);
        res.status(500).json({ success: false, message: 'Failed to build metrics' });
    }
});

module.exports = router;
```

- [ ] **Step 2: Mount it**

In `backend/app.js`, beside the other route requires:

```js
const metricsRoutes = require('./routes/metrics');
```

and beside the other mounts:

```js
app.use('/api/metrics', metricsRoutes);
```

- [ ] **Step 3: Verify the app still loads**

Run: `cd backend && node --check routes/metrics.js && node --check app.js`
Expected: no output (both parse).

Run: `cd backend && node -e "const r=require('./routes/metrics'); console.log('route stack:', r.stack.length)"`
Expected: `route stack: 1`

- [ ] **Step 4: Confirm the route has no user-supplied identity**

Run: `cd backend && grep -n "req.params\|req.query.userId" routes/metrics.js`
Expected: no matches — identity comes from `req.user` only.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all three suites pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/metrics.js backend/app.js
git commit -m "feat(backend): expose GET /api/metrics for the signed-in user

Identity comes from the session only; no :userId parameter, so this route
cannot repeat the H-1 IDOR pattern.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Version bump and documentation

**Files:**
- Modify: `extension/package.json` (version)
- Modify: `extension/CHANGELOG.md`
- Modify: `docs/TRACKING_ROADMAP.md` (mark Phase A done)
- Modify: `docs/ARCHITECTURE.md` (new payload and schema)

- [ ] **Step 1: Bump the extension version**

In `extension/package.json`, set `"version": "2.1.0"` (a minor bump — new capability, backward compatible).

- [ ] **Step 2: Add the changelog entry**

Insert below the header line in `extension/CHANGELOG.md`:

```markdown
## [2.1.0] - 2026-08-28

### Added
- **Editor analytics**: gross characters and lines inserted/deleted, churn (lines written
  then deleted within 10 minutes), undo/redo counts, saves, file switches, unique files,
  and a read-vs-write attention split.
- **Focus analytics**: real window focus/blur time and completed "flow blocks", so the
  shape of a session is recorded rather than just its total.
- **Git analytics**: commits are now detected through the built-in Git extension, so
  commits made from the Source Control panel or any GUI are counted.

### Fixed
- `linesAdded`/`linesRemoved` were net `lineCount` deltas, so any replace-in-place edit
  (most refactoring) recorded as zero activity. They are now gross counters.

### Privacy
- No file contents, diffs, commit messages or absolute paths are transmitted.
```

- [ ] **Step 3: Mark Phase A complete in the roadmap**

In `docs/TRACKING_ROADMAP.md`, under `## Part 4 — Suggested phasing`, change the Phase A line to begin with `**Phase A — DONE 2026-08-28.**` and note that Phase B is next.

- [ ] **Step 4: Update the architecture doc**

In `docs/ARCHITECTURE.md`, under section 3 (Storage), add the three new sub-documents to the `Activity` field list, and under section 2 note that commits now come from the Git extension API rather than terminal parsing.

- [ ] **Step 5: Run everything one final time**

```bash
cd backend && npm test
cd ../extension && npm test
cd ../extension && npx vsce ls
```

Expected: all suites pass; `vsce ls` lists exactly `README.md`, `package.json`, `LICENSE`, `CHANGELOG.md`, `dist/extension.js`, `images/icon.png`.

- [ ] **Step 6: Commit**

```bash
git add extension/package.json extension/CHANGELOG.md docs/
git commit -m "docs: record tracking Phase A, bump extension to 2.1.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification checklist

Before declaring Phase A done:

- [ ] `cd backend && npm test` — streak, ingest, metrics suites all pass
- [ ] `cd extension && npm test` — trackers and activation suites all pass
- [ ] `npx vsce ls` shows exactly 6 files
- [ ] A v2.0.11-shaped payload (no `editorAnalytics`) still ingests without error — covered by `ingest.test.js`
- [ ] `grep -rn "lineCounts" extension/src/` returns nothing — the broken net-delta metric is fully removed
- [ ] `GET /api/metrics` takes no user identifier from the request

## Known limitations to record, not fix

- `deepWorkRatio` and `flowBlocks` return 0 for activity recorded before 2.1.0. This is expected; metrics fill in as new data arrives.
- `estimationCalibration` matches goals to activity by `language === goal.techStack`, which is coarse. Accepted for Phase A.
- `truePeakWindow` buckets by UTC hour in the aggregation. The timezone offset is applied to daily buckets but not hourly ones; correcting it belongs with the Phase B diagnostics work.
