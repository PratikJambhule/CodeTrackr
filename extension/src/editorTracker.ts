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
  private paused = false;

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

  /**
   * Idle-pause gate. The attention sampler runs on its own interval, so an
   * unattended-but-focused window used to bank the whole idle gap as `readMs`,
   * skewing comprehensionLoad. While paused we advance the clock and bank
   * nothing.
   */
  public setPaused(paused: boolean, nowMs: number = Date.now()): void {
    if (paused === this.paused) return;
    this.sampleAttention(nowMs); // bank real time up to the pause boundary
    this.paused = paused;
    this.lastSampleMs = nowMs;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  /** Called on a fixed interval; splits elapsed time into read vs write. */
  public sampleAttention(nowMs: number): void {
    const elapsed = nowMs - this.lastSampleMs;
    this.lastSampleMs = nowMs;
    if (elapsed <= 0 || this.paused) return;

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
