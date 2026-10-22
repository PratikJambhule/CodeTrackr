/**
 * Command classification helpers. Only counts and kinds leave this module's callers: the command
 * text itself is never stored or sent (plan E1).
 */

import { detectGitAction } from "./gitTracker";
import { commandKind, CommandKind } from "./commandKind";

export type CommandCategory =
  | "git"
  | "npm"
  | "node"
  | "python"
  | "docker"
  | "pip"
  | "java"
  | "gcc"
  | "misc";

export interface ClassifiedCommand {
  category: CommandCategory;
  normalized: string;
  gitAction: string | null;
  isBuild: boolean;
  isTest: boolean;
  isDebug: boolean;
  isIgnored: boolean;
  kind: CommandKind;
}

const BUILD_COMMANDS = [
  "npm run build",
  "pnpm build",
  "yarn build",
  "gradle build",
  "mvn package",
  "mvn install",
  "cargo build",
  "go build",
  "gcc",
  "g++",
  "clang",
];

const TEST_COMMANDS = [
  "npm test",
  "pnpm test",
  "yarn test",
  "pytest",
  "jest",
  "mvn test",
  "gradle test",
  "cargo test",
  "go test",
];

const DEBUG_PATTERNS = ["--inspect", "debugpy", "-m pdb", "gdb", "lldb", "node inspect", "dlv"];

const INTERNAL_PREFIXES = ["__vscode", "vscode", "code --", "code-insiders --"];
const SHELL_STARTUP_COMMANDS = new Set(["cd", "pwd", "clear", "cls", "exit"]);

export function classifyCommand(rawCommand: string): ClassifiedCommand {
  const trimmed = rawCommand.trim();
  const normalized = normalizeCommand(trimmed);
  const category = classifyCategory(normalized);
  const gitAction = detectGitAction(normalized);
  const isBuild = startsWithAny(normalized, BUILD_COMMANDS);
  const isTest = startsWithAny(normalized, TEST_COMMANDS);
  // Checked on the whole command line: normalizing drops flags, so "--inspect" was never seen (L-17).
  const lowered = trimmed.toLowerCase();
  const isDebug = DEBUG_PATTERNS.some((pattern) => lowered.includes(pattern));
  const isIgnored = isIgnoredCommand(normalized);

  return {
    category,
    normalized,
    gitAction,
    isBuild,
    isTest,
    isDebug,
    isIgnored,
    kind: commandKind(trimmed),
  };
}

export function normalizeCommand(rawCommand: string): string {
  const normalized = rawCommand.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "";

  const parts = normalized.split(" ");
  const base = parts[0];

  if (base === "git" && parts[1]) {
    return `git ${parts[1]}`;
  }

  if ((base === "npm" || base === "pnpm" || base === "yarn") && parts[1]) {
    if (parts[1] === "run" && parts[2]) {
      return `${base} run ${parts[2]}`;
    }
    return `${base} ${parts[1]}`;
  }

  if ((base === "python" || base === "python3") && parts[1] === "-m" && parts[2]) {
    return `${base} -m ${parts[2]}`;
  }

  if (parts[1] && !parts[1].startsWith("-")) {
    return `${base} ${parts[1]}`;
  }

  return base;
}

function classifyCategory(normalized: string): CommandCategory {
  const base = normalized.split(" ")[0];
  switch (base) {
    case "git":
      return "git";
    case "npm":
    case "pnpm":
    case "yarn":
      return "npm";
    case "node":
      return "node";
    case "python":
    case "python3":
      return "python";
    case "docker":
      return "docker";
    case "pip":
    case "pip3":
      return "pip";
    case "java":
    case "javac":
      return "java";
    case "gcc":
    case "g++":
    case "clang":
    case "clang++":
      return "gcc";
    default:
      return "misc";
  }
}

function startsWithAny(normalized: string, patterns: string[]): boolean {
  return patterns.some((pattern) => normalized.startsWith(pattern));
}

function isIgnoredCommand(normalized: string): boolean {
  if (!normalized) return true;
  if (INTERNAL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  // "cd src" is housekeeping too, not only a bare "cd"
  if (SHELL_STARTUP_COMMANDS.has(normalized.split(" ")[0])) return true;
  return false;
}
