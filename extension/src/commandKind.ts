/**
 * What KIND of command a terminal command line is: install, run, compile, build, test, git, docker
 * or other. Pure. Only the kind ever leaves the laptop, never the command text (plan E1/E2).
 *
 * Mirrored on the server by backend/services/commandKinds.js (it reduces text sent by older
 * extensions). Both are tested against extension/tests/fixtures/commandKinds.json, so keep them
 * in step: change the table first, then both classifiers.
 */

export const COMMAND_KINDS = ["install", "run", "compile", "build", "test", "git", "docker", "other"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

const INSTALL_WORDS = new Set(["install", "i", "ci", "add", "init", "create", "update", "upgrade", "uninstall", "remove", "rm", "link", "restore", "require"]);
const PACKAGE_MANAGERS = new Set(["pip", "pip3", "conda", "brew", "apt", "apt-get", "choco", "winget", "gem", "composer", "pipx", "poetry"]);
const COMPILERS = new Set(["gcc", "g++", "cc", "c++", "clang", "clang++", "javac", "tsc", "rustc", "kotlinc", "nvcc", "csc", "gfortran"]);
const TEST_RUNNERS = new Set(["pytest", "jest", "vitest", "mocha", "karma", "playwright", "cypress", "phpunit", "rspec"]);
const RUNNERS = new Set(["node", "nodemon", "ts-node", "tsx", "java", "ruby", "php", "perl", "flask", "uvicorn", "gunicorn", "streamlit", "electron", "lua", "rscript", "julia"]);
const OTHER_SCRIPTS = /^(lint|format|fmt|prettier|typecheck|type-check|check|clean)(:|$)/;

/** Lower-case words, without a leading `sudo`. */
function words(raw: string): string[] {
  const w = String(raw || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  while (w[0] === "sudo") w.shift();
  return w;
}

/** The program name without its folder or a Windows extension: C:\bin\node.exe -> node. */
function programOf(word: string): string {
  return word.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/** npm / yarn / pnpm / bun: "run <script>" or a sub-command. */
function packageScriptKind(prog: string, rest: string[]): CommandKind {
  const [sub = "", script = ""] = rest;
  if (!sub) return prog === "yarn" ? "install" : "other";
  if (sub === "exec" || sub === "x" || sub === "dlx") return rest.length > 1 ? commandKind(rest.slice(1).join(" ")) : "other";
  const name = sub === "run" || sub === "run-script" ? script : sub;
  if (sub !== "run" && sub !== "run-script" && INSTALL_WORDS.has(sub)) return "install";
  if (!name) return "other";
  if (name === "test" || name === "t" || name.startsWith("test:")) return "test";
  if (name === "build" || name.startsWith("build:")) return "build";
  if (OTHER_SCRIPTS.test(name)) return "other";
  return "run"; // dev, start, serve, preview, seed, a .ts file under bun…
}

function pythonKind(rest: string[]): CommandKind {
  const [first = "", mod = "", modArg = ""] = rest;
  if (first === "-m") {
    if (mod === "pip") return modArg === "list" || modArg === "show" || modArg === "freeze" ? "other" : "install";
    if (mod === "venv" || mod === "virtualenv") return "install";
    if (mod === "pytest" || mod === "unittest") return "test";
    return "run";
  }
  if (first === "manage.py" && mod === "test") return "test";
  return "run"; // a script, or the REPL
}

export function commandKind(raw: string): CommandKind {
  const w = words(raw);
  if (!w.length) return "other";
  const prog = programOf(w[0]);
  const rest = w.slice(1);
  const sub = rest[0] || "";

  if (prog === "npx" || prog === "pnpx" || prog === "bunx") {
    if (!sub) return "other";
    if (sub.startsWith("create-")) return "install";
    return commandKind(rest.join(" "));
  }
  if (prog === "git") return "git";
  if (prog === "docker" || prog === "docker-compose" || prog === "podman") return "docker";
  if (prog === "npm" || prog === "yarn" || prog === "pnpm" || prog === "bun") return packageScriptKind(prog, rest);
  if (PACKAGE_MANAGERS.has(prog)) return INSTALL_WORDS.has(sub) ? "install" : "other";
  if (prog === "python" || prog === "python3" || prog === "py") return pythonKind(rest);
  if (COMPILERS.has(prog)) return "compile";
  if (TEST_RUNNERS.has(prog)) return "test";

  switch (prog) {
    case "make": case "ninja": case "ant":
      return rest.includes("test") || rest.includes("check") ? "test" : "build";
    case "cmake": return "build";
    case "mvn": case "mvnw": case "gradle": case "gradlew":
      return rest.includes("test") ? "test" : "build";
    case "cargo":
      if (sub === "build" || sub === "check") return "build";
      if (sub === "test") return "test";
      if (sub === "run") return "run";
      return sub === "add" || sub === "install" ? "install" : "other";
    case "go":
      if (sub === "build") return "build";
      if (sub === "test") return "test";
      if (sub === "run") return "run";
      return sub === "get" || sub === "install" || sub === "mod" ? "install" : "other";
    case "dotnet":
      if (sub === "build") return "build";
      if (sub === "test") return "test";
      if (sub === "run") return "run";
      return sub === "add" || sub === "restore" ? "install" : "other";
    case "deno":
      return sub === "test" ? "test" : "run";
    case "vite": case "next": case "nuxt": case "astro":
      return sub === "build" ? "build" : "run";
  }
  if (RUNNERS.has(prog)) return "run";
  // ./a.out, ./main, .\a.exe, a.exe: running a program you just built
  if (/[\\/]/.test(w[0]) || /\.(exe|out)$/.test(w[0])) return "run";
  return "other";
}
