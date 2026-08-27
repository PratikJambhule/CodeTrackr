/**
 * Git command helpers for terminal analytics.
 */

const GIT_ACTIONS = new Set(["commit", "push", "pull", "checkout", "merge", "clone"]);

export function detectGitAction(normalizedCommand: string): string | null {
  const parts = normalizedCommand.split(" ");
  if (parts[0] !== "git" || parts.length < 2) return null;
  const action = parts[1];
  return GIT_ACTIONS.has(action) ? action : null;
}
