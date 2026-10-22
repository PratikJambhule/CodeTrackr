/**
 * Counts how often something was RUN in an interval (plan E7 + E8): terminal commands, tasks,
 * "Run Without Debugging" sessions (also what most ▶ Run buttons start), and Code Runner runs.
 * Running TIME is measured by the time engine (heartbeat.ts); this only counts runs.
 *
 * Code Runner runs in its own Output channel. It prints "[Running] …" when a run starts and
 * "[Done] exited with code=N …" when it ends; those markers are the only thing read, to know when a
 * run starts and ends. The text is never stored or sent.
 */

import * as vscode from "vscode";
import { classifyCommand } from "./commandClassifier";

export interface RunCounts {
  terminal: number;
  task: number;
  debugNoDebug: number;
  codeRunner: number;
}

export interface RunHooks {
  /** Code Runner started / finished a run (for the time engine). */
  onCodeRunnerStart?: (ts: number) => void;
  onCodeRunnerEnd?: (ts: number) => void;
}

const CODE_RUNNER_ID = /code-runner/i;
const RUNNING_MARK = /^\[Running\]/m;
const DONE_MARK = /^\[Done\]/m;

/** Is this the Code Runner output channel? (Other output channels are ignored.) */
export function isCodeRunnerOutput(doc?: { uri?: { scheme?: string; toString?: () => string }; fileName?: string }): boolean {
  if (!doc || doc.uri?.scheme !== "output") return false;
  return CODE_RUNNER_ID.test(String(doc.uri?.toString?.() ?? "")) || CODE_RUNNER_ID.test(String(doc.fileName ?? ""));
}

export class RunsTracker {
  private subscriptions: vscode.Disposable[] = [];
  private counts: RunCounts = RunsTracker.empty();
  private codeRunnerActive = false;

  constructor(private hooks: RunHooks = {}) {}

  private static empty(): RunCounts {
    return { terminal: 0, task: 0, debugNoDebug: 0, codeRunner: 0 };
  }

  public start(context: vscode.ExtensionContext): void {
    if (typeof vscode.window.onDidStartTerminalShellExecution === "function") {
      this.subscriptions.push(vscode.window.onDidStartTerminalShellExecution((e) => {
        if (!classifyCommand(e.execution.commandLine.value).isIgnored) this.counts.terminal += 1;
      }));
    }
    if (vscode.tasks && typeof vscode.tasks.onDidStartTaskProcess === "function") {
      this.subscriptions.push(vscode.tasks.onDidStartTaskProcess(() => { this.counts.task += 1; }));
    }
    this.subscriptions.push(
      vscode.debug.onDidStartDebugSession((session) => {
        if (session?.configuration?.noDebug === true) this.counts.debugNoDebug += 1;
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!isCodeRunnerOutput(event.document)) return;
        for (const change of event.contentChanges || []) this.onCodeRunnerOutput(change.text || "", Date.now());
      })
    );
    context.subscriptions.push(...this.subscriptions);
  }

  public stop(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.subscriptions = [];
  }

  /** New text in the Code Runner channel. Exposed for tests. */
  public onCodeRunnerOutput(text: string, ts: number): void {
    if (RUNNING_MARK.test(text) && !this.codeRunnerActive) {
      this.codeRunnerActive = true;
      this.counts.codeRunner += 1;
      this.hooks.onCodeRunnerStart?.(ts);
    }
    if (DONE_MARK.test(text) && this.codeRunnerActive) {
      this.codeRunnerActive = false;
      this.hooks.onCodeRunnerEnd?.(ts);
    }
  }

  public getIntervalSnapshot(): RunCounts {
    return { ...this.counts };
  }

  public consumeInterval(): RunCounts {
    const snapshot = this.getIntervalSnapshot();
    this.counts = RunsTracker.empty();
    return snapshot;
  }
}
