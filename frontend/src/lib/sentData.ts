/**
 * Exactly what the VS Code extension sends (2.6.0) and what it never sends. One list, shown on the
 * Privacy page and on Profile, so the two can never disagree (plan W3 + W4). Keep it in step with
 * extension/README.md "What is tracked" and the payload in extension/src/extension.ts.
 */
export const SENT_FROM_VSCODE: string[] = [
  'active time, split into writing (typing), reading (scrolling, moving around, switching files) and running (a command, task, debug session or Code Runner run you are waiting on)',
  'the project (folder) name, the language, and the names of the files you worked on (like two_sum.cpp — never the folder path), each with its time and line counts, up to 30 per summary',
  'edit counts: characters and lines added and removed, saves, undo and redo, file switches',
  'how long the VS Code window had focus',
  'commit counts from the Git extension; debug sessions, breakpoint stops and steps',
  'programs you ran: terminal commands, tasks, Run Without Debugging and Code Runner runs (counts only)',
  'terminal commands counted by kind (install, run, compile, build, test, git, docker or other) and whether they failed, including which kind keeps failing ("compile, 3 times")',
  'reading counts: scroll bursts, jumps such as Go to Definition, files opened but not edited; files created and deleted (counts)',
  'the kind of project: a size range of its source files, whether it has package.json, requirements.txt or .git, whether recent commits are yours (your Git email is compared on your computer, never sent), and whether it was cloned recently',
  'the kind of work you chose in the status bar (DSA, Project, Debugging, Learning, Setup), if you chose one',
];

export const NEVER_SENT: string[] = [
  'your code or file contents',
  'diffs and commit messages',
  'full file paths',
  'keystrokes',
  'the text of your terminal commands (if you still use extension 2.5.0 or older, it sends a shortened command, and the server keeps only its kind; update to 2.6.0)',
  'your Git email',
  'anything from other apps',
];
