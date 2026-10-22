/**
 * Editor Analytics Tracker
 * Accumulates gross edit volume, churn, attention split and navigation
 * counters for the current flush interval.
 *
 * Replaces the net `doc.lineCount` delta, which reported zero for any
 * replace-in-place edit (i.e. most refactoring).
 *
 * Reading vs writing TIME is no longer sampled here: the time engine (heartbeat.ts) measures it from
 * real actions. The old 5-second sampler counted any quiet stretch, idle included, as reading (P8).
 */

import * as vscode from "vscode";

const CHURN_WINDOW_MS = 10 * 60 * 1000;
const LARGE_INSERT_CHARS = 80;
const SCROLL_BURST_MS = 1000; // scroll events arrive many per second; count bursts
const SELECTION_BY_COMMAND = 3; // vscode.TextEditorSelectionChangeKind.Command: Go to Definition, Find, Peek…

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
  largeInsertCount: number;
  largeInsertChars: number;
}

/** Lines inserted and deleted per file (base name) in this interval. */
export type FileLines = Map<string, { linesInserted: number; linesDeleted: number }>;

/** Reading and file signals of this interval (plan E9 + E11). Counts only, no names leave here. */
export interface EditorSignals {
  scrollEvents: number;
  navigations: number;
  filesCreated: number;
  filesDeleted: number;
  /** Base names of files created in this interval, to mark them in perFile. */
  created: Set<string>;
}

/** Only real documents count: the Output panel, Git views and settings fire edit events too. */
export function isUserDocument(doc?: { uri?: { scheme?: string } }): boolean {
  if (!doc) return false;
  const scheme = doc.uri?.scheme ?? "file";
  return scheme === "file" || scheme === "untitled" || scheme === "vscode-notebook-cell";
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

  private counters = EditorTracker.empty();
  private files = new Set<string>();
  private fileLines: FileLines = new Map();
  private recentInserts: InsertRecord[] = [];
  private signals = EditorTracker.emptySignals();
  private lastScrollMs = -Infinity; // so the first scroll always starts a burst

  private static emptySignals(): EditorSignals {
    return { scrollEvents: 0, navigations: 0, filesCreated: 0, filesDeleted: 0, created: new Set() };
  }

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
      largeInsertCount: 0,
      largeInsertChars: 0,
    };
  }

  public start(context: vscode.ExtensionContext): void {
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Text written to the Output panel used to count as typing (L-19).
        if (!isUserDocument(event.document)) return;
        const name = baseName(event.document?.fileName);
        for (const change of event.contentChanges || []) {
          this.recordChange(change as ChangeLike, (event as any).reason, undefined, name);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => { if (isUserDocument(doc)) this.recordSave(); }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document?.fileName && isUserDocument(editor.document)) {
          this.recordFileSwitch(editor.document.fileName);
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (isUserDocument(e.textEditor?.document)) this.recordSelection((e as any).kind);
      })
    );
    // Newer APIs: guarded so an older VS Code still activates.
    if (typeof vscode.window.onDidChangeTextEditorVisibleRanges === "function") {
      this.subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (isUserDocument(e.textEditor?.document)) this.recordScroll(Date.now());
      }));
    }
    if (typeof vscode.workspace.onDidCreateFiles === "function") {
      this.subscriptions.push(
        vscode.workspace.onDidCreateFiles((e) => this.recordCreated((e.files || []).map((u) => u.fsPath || u.path))),
        vscode.workspace.onDidDeleteFiles((e) => { this.signals.filesDeleted += (e.files || []).length; })
      );
    }

    context.subscriptions.push(...this.subscriptions);
  }

  public stop(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.subscriptions = [];
  }

  public recordChange(change: ChangeLike, reason?: number, nowMs?: number, fileName?: string): void {
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
        if (fileName) this.lineCounts(fileName).linesInserted += insertedLines;
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
      if (removedLines > 0) {
        this.consumeChurn(removedLines, now);
        if (fileName) this.lineCounts(fileName).linesDeleted += removedLines;
      }
    }
  }

  private lineCounts(fileName: string) {
    let c = this.fileLines.get(fileName);
    if (!c) { c = { linesInserted: 0, linesDeleted: 0 }; this.fileLines.set(fileName, c); }
    return c;
  }

  /** Per-file line counts of this interval (a copy). */
  public getFileLines(): FileLines {
    return new Map([...this.fileLines].map(([k, v]) => [k, { ...v }]));
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

  /** Scrolling: one count per burst. */
  public recordScroll(nowMs: number): void {
    if (nowMs - this.lastScrollMs > SCROLL_BURST_MS) this.signals.scrollEvents += 1;
    this.lastScrollMs = nowMs;
  }

  /** A selection change made by a command (Go to Definition, Find, Peek…) is a navigation. */
  public recordSelection(kind?: number): void {
    if (kind === SELECTION_BY_COMMAND) this.signals.navigations += 1;
  }

  public recordCreated(paths: string[]): void {
    this.signals.filesCreated += paths.length;
    for (const p of paths) { const n = baseName(p); if (n) this.signals.created.add(n); }
  }

  /** Reading and file signals of this interval (a copy). Read before consumeInterval(). */
  public getSignals(): EditorSignals {
    return { ...this.signals, created: new Set(this.signals.created) };
  }

  public recordSave(): void {
    this.counters.saveCount += 1;
  }

  public recordFileSwitch(fileName: string): void {
    this.counters.fileSwitches += 1;
    this.files.add(fileName);
  }

  public getIntervalSnapshot(): EditorAnalyticsSnapshot {
    return { ...this.counters, uniqueFiles: this.files.size };
  }

  public consumeInterval(): EditorAnalyticsSnapshot {
    const snapshot = this.getIntervalSnapshot();
    this.counters = EditorTracker.empty();
    this.files.clear();
    this.fileLines = new Map();
    this.signals = EditorTracker.emptySignals();
    this.recentInserts = [];
    return snapshot;
  }
}

function baseName(fileName?: string): string | undefined {
  return fileName ? fileName.split(/[\\/]/).pop() : undefined; // Windows "\" and POSIX "/"
}

export function createEditorTracker(): EditorTracker {
  return new EditorTracker();
}
