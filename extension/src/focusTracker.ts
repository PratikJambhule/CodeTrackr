/**
 * Window Focus + Flow Block Tracker
 *
 * Focus state removes phantom time (VS Code open but not the foreground app).
 * Flow blocks capture the *shape* of a session: eighteen 5-minute blocks and
 * one 90-minute block both total 90 minutes but are very different days.
 */

import * as vscode from "vscode";

const BLOCK_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const TICK_MS = 15000;

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
  private paused = false;
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

  /**
   * Idle-pause gate. `focusedMs` is wall-clock time with the window in the
   * foreground, so leaving VS Code focused while away from the keyboard used to
   * accrue hours of phantom "focused" time — which then became the denominator
   * of deepWorkRatio. While paused we stop accruing entirely; the clock is
   * fast-forwarded so unpausing never back-fills the idle gap.
   */
  public setPaused(paused: boolean, nowMs: number = Date.now()): void {
    if (paused === this.paused) return;
    this.accrue(nowMs); // bank real time up to the pause boundary
    this.paused = paused;
    this.lastStateChangeMs = nowMs;
  }

  public isPaused(): boolean {
    return this.paused;
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
    // While idle-paused, advance the clock but bank nothing: the user is away.
    if (elapsed > 0 && !this.paused) {
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
