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
      const api = (extension as any)?.exports?.getAPI?.(1);
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
