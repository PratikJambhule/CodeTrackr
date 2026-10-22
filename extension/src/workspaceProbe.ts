/**
 * What kind of project is open (plan E10). Run once per session and again when the workspace
 * changes. Sends only a size bucket and yes/no flags: never a path, file name, URL or e-mail.
 *
 * Why: whose code this is separates learning from building. A repo cloned last week that has no
 * commits by you is probably a tutorial; your own repo with your commits is a project.
 */

import * as vscode from "vscode";

export interface WorkspaceSnapshot {
  /** How many source files the project has, as a bucket. */
  sourceFilesBucket: string;
  hasPackageJson: boolean;
  /** requirements.txt or pyproject.toml */
  hasRequirements: boolean;
  hasGit: boolean;
  /** The repo has commits by you (your git user.email); null when it cannot be told. */
  ownCommits: boolean | null;
  /** The repo was cloned (not created) within the last 14 days. */
  clonedRecently: boolean;
}

export interface ProbeDeps {
  countSourceFiles(): Promise<number>;
  exists(relativePath: string): Promise<boolean>;
  readText(relativePath: string): Promise<string | undefined>;
  ownCommits(): Promise<boolean | null>;
}

const CLONE_WINDOW_DAYS = 14;
const MAX_COUNT = 501; // enough to tell "500+"
const SOURCE_GLOB = "**/*.{js,jsx,ts,tsx,mjs,cjs,py,java,kt,c,cc,cpp,cxx,h,hpp,cs,go,rs,rb,php,swift,dart,vue,svelte,scala,lua}";
const EXCLUDE_GLOB = "**/{node_modules,.git,dist,build,out,.venv,venv,env,target,__pycache__,.next,coverage}/**";

export function sizeBucket(n: number): string {
  if (!(n > 0)) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  if (n <= 100) return "21-100";
  if (n <= 500) return "101-500";
  return "500+";
}

/**
 * Git writes a clone as the first line of .git/logs/HEAD:
 *   "<old> <new> Name <email> <unix-seconds> <tz>\tclone: from <url>"
 * Only the "clone:" marker and the time are read.
 */
export function clonedWithin(headLog: string | undefined, nowMs: number, days = CLONE_WINDOW_DAYS): boolean {
  const first = (headLog || "").split(/\r?\n/, 1)[0] || "";
  if (!/\tclone: /.test(first)) return false;
  const m = first.match(/ (\d{9,11}) [+-]\d{4}\t/);
  if (!m) return false;
  const ageMs = nowMs - Number(m[1]) * 1000;
  return ageMs >= 0 && ageMs <= days * 86400000;
}

export async function probeWorkspace(deps: ProbeDeps, nowMs: number): Promise<WorkspaceSnapshot> {
  const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await f(); } catch { return fallback; }
  };
  const [count, pkg, req, pyproject, git, own] = await Promise.all([
    safe(() => deps.countSourceFiles(), 0),
    safe(() => deps.exists("package.json"), false),
    safe(() => deps.exists("requirements.txt"), false),
    safe(() => deps.exists("pyproject.toml"), false),
    safe(() => deps.exists(".git"), false),
    safe(() => deps.ownCommits(), null),
  ]);
  const headLog = git ? await safe(() => deps.readText(".git/logs/HEAD"), undefined) : undefined;
  return {
    sourceFilesBucket: sizeBucket(count),
    hasPackageJson: pkg,
    hasRequirements: req || pyproject,
    hasGit: git,
    ownCommits: own,
    clonedRecently: git && clonedWithin(headLog, nowMs),
  };
}

/** The real inputs: the first workspace folder, VS Code's file search and the Git extension. */
export function vscodeProbeDeps(): ProbeDeps | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;
  const uriOf = (rel: string) => vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
  return {
    countSourceFiles: async () =>
      (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SOURCE_GLOB), EXCLUDE_GLOB, MAX_COUNT)).length,
    exists: async (rel) => { await vscode.workspace.fs.stat(uriOf(rel)); return true; },
    readText: async (rel) => Buffer.from(await vscode.workspace.fs.readFile(uriOf(rel))).toString("utf8"),
    ownCommits: async () => {
      const api = (vscode.extensions.getExtension("vscode.git") as any)?.exports?.getAPI?.(1);
      const repo = api?.getRepository?.(folder.uri) ?? api?.repositories?.[0];
      if (!repo) return null;
      const email = String((await repo.getConfig?.("user.email")) || "").trim().toLowerCase();
      if (!email) return null;
      const log: Array<{ authorEmail?: string }> = (await repo.log?.({ maxEntries: 50 })) || [];
      return log.some((c) => String(c.authorEmail || "").toLowerCase() === email);
    },
  };
}
