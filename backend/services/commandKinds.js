'use strict';

/**
 * Command kinds on the server (plan E1/B5). Pure.
 *
 * Extension 2.6.0 sends only kinds. Extension 2.5.0 and older send a short command text in
 * `terminalAnalytics.lastCommand` and `repeatedFailedCommands[].command` (e.g. "g++ two_sum.cpp").
 * Ingest passes both through toKind()/kindFailures(), so from the moment this is deployed no command
 * text is stored, whatever version the extension is.
 *
 * commandKind() mirrors extension/src/commandKind.ts. Both are tested against the same table
 * (extension/tests/fixtures/commandKinds.json); change the table first, then both.
 */

const COMMAND_KINDS = ['install', 'run', 'compile', 'build', 'test', 'git', 'docker', 'other'];
const KIND_SET = new Set(COMMAND_KINDS);
const MAX_COUNT = 10000; // per upload; a real interval has a handful

const INSTALL_WORDS = new Set(['install', 'i', 'ci', 'add', 'init', 'create', 'update', 'upgrade', 'uninstall', 'remove', 'rm', 'link', 'restore', 'require']);
const PACKAGE_MANAGERS = new Set(['pip', 'pip3', 'conda', 'brew', 'apt', 'apt-get', 'choco', 'winget', 'gem', 'composer', 'pipx', 'poetry']);
const COMPILERS = new Set(['gcc', 'g++', 'cc', 'c++', 'clang', 'clang++', 'javac', 'tsc', 'rustc', 'kotlinc', 'nvcc', 'csc', 'gfortran']);
const TEST_RUNNERS = new Set(['pytest', 'jest', 'vitest', 'mocha', 'karma', 'playwright', 'cypress', 'phpunit', 'rspec']);
const RUNNERS = new Set(['node', 'nodemon', 'ts-node', 'tsx', 'java', 'ruby', 'php', 'perl', 'flask', 'uvicorn', 'gunicorn', 'streamlit', 'electron', 'lua', 'rscript', 'julia']);
const OTHER_SCRIPTS = /^(lint|format|fmt|prettier|typecheck|type-check|check|clean)(:|$)/;
// Same as the extension's ignore list (commandClassifier.ts): never counted.
const INTERNAL_PREFIXES = ['__vscode', 'vscode', 'code --', 'code-insiders --'];
const SHELL_HOUSEKEEPING = new Set(['cd', 'pwd', 'clear', 'cls', 'exit']);

function words(raw) {
  const w = String(raw || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  while (w[0] === 'sudo') w.shift();
  return w;
}

const programOf = (word) => word.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/, '');

function packageScriptKind(prog, rest) {
  const [sub = '', script = ''] = rest;
  if (!sub) return prog === 'yarn' ? 'install' : 'other';
  if (sub === 'exec' || sub === 'x' || sub === 'dlx') return rest.length > 1 ? commandKind(rest.slice(1).join(' ')) : 'other';
  const name = sub === 'run' || sub === 'run-script' ? script : sub;
  if (sub !== 'run' && sub !== 'run-script' && INSTALL_WORDS.has(sub)) return 'install';
  if (!name) return 'other';
  if (name === 'test' || name === 't' || name.startsWith('test:')) return 'test';
  if (name === 'build' || name.startsWith('build:')) return 'build';
  if (OTHER_SCRIPTS.test(name)) return 'other';
  return 'run';
}

function pythonKind(rest) {
  const [first = '', mod = '', modArg = ''] = rest;
  if (first === '-m') {
    if (mod === 'pip') return modArg === 'list' || modArg === 'show' || modArg === 'freeze' ? 'other' : 'install';
    if (mod === 'venv' || mod === 'virtualenv') return 'install';
    if (mod === 'pytest' || mod === 'unittest') return 'test';
    return 'run';
  }
  if (first === 'manage.py' && mod === 'test') return 'test';
  return 'run';
}

function commandKind(raw) {
  const w = words(raw);
  if (!w.length) return 'other';
  const prog = programOf(w[0]);
  const rest = w.slice(1);
  const sub = rest[0] || '';

  if (prog === 'npx' || prog === 'pnpx' || prog === 'bunx') {
    if (!sub) return 'other';
    if (sub.startsWith('create-')) return 'install';
    return commandKind(rest.join(' '));
  }
  if (prog === 'git') return 'git';
  if (prog === 'docker' || prog === 'docker-compose' || prog === 'podman') return 'docker';
  if (prog === 'npm' || prog === 'yarn' || prog === 'pnpm' || prog === 'bun') return packageScriptKind(prog, rest);
  if (PACKAGE_MANAGERS.has(prog)) return INSTALL_WORDS.has(sub) ? 'install' : 'other';
  if (prog === 'python' || prog === 'python3' || prog === 'py') return pythonKind(rest);
  if (COMPILERS.has(prog)) return 'compile';
  if (TEST_RUNNERS.has(prog)) return 'test';

  switch (prog) {
    case 'make': case 'ninja': case 'ant':
      return rest.includes('test') || rest.includes('check') ? 'test' : 'build';
    case 'cmake': return 'build';
    case 'mvn': case 'mvnw': case 'gradle': case 'gradlew':
      return rest.includes('test') ? 'test' : 'build';
    case 'cargo':
      if (sub === 'build' || sub === 'check') return 'build';
      if (sub === 'test') return 'test';
      if (sub === 'run') return 'run';
      return sub === 'add' || sub === 'install' ? 'install' : 'other';
    case 'go':
      if (sub === 'build') return 'build';
      if (sub === 'test') return 'test';
      if (sub === 'run') return 'run';
      return sub === 'get' || sub === 'install' || sub === 'mod' ? 'install' : 'other';
    case 'dotnet':
      if (sub === 'build') return 'build';
      if (sub === 'test') return 'test';
      if (sub === 'run') return 'run';
      return sub === 'add' || sub === 'restore' ? 'install' : 'other';
    case 'deno':
      return sub === 'test' ? 'test' : 'run';
    case 'vite': case 'next': case 'nuxt': case 'astro':
      return sub === 'build' ? 'build' : 'run';
    default:
      break;
  }
  if (RUNNERS.has(prog)) return 'run';
  if (/[\\/]/.test(w[0]) || /\.(exe|out)$/.test(w[0])) return 'run';
  return 'other';
}

function isIgnoredCommand(raw) {
  const lower = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!lower) return true;
  if (INTERNAL_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return SHELL_HOUSEKEEPING.has(lower.split(' ')[0]);
}

/** A kind for whatever arrived (a kind, or older command text), or null when there is nothing to keep. */
function toKind(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v === 'unknown') return null;
  if (KIND_SET.has(v)) return v;
  if (isIgnoredCommand(v)) return null;
  return commandKind(v);
}

const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_COUNT, Math.round(n)) : 0;
};

/** Repeated failures as [{ command: kind, count }]: merged per kind, largest first, at most 5. */
function kindFailures(entries) {
  if (!Array.isArray(entries)) return [];
  const byKind = new Map();
  for (const e of entries) {
    const kind = e && typeof e === 'object' ? toKind(e.command) : null;
    const n = e && typeof e === 'object' ? count(e.count) : 0;
    if (kind && n > 0) byKind.set(kind, (byKind.get(kind) || 0) + n);
  }
  return [...byKind].map(([command, n]) => ({ command, count: n }))
    .sort((a, b) => b.count - a.count).slice(0, 5);
}

/** The commandKinds block of an upload, with exactly the known keys. Missing (older extension) → zeros. */
function normalizeKindCounts(src) {
  const s = src && typeof src === 'object' ? src : {};
  const f = s.failed && typeof s.failed === 'object' ? s.failed : {};
  const out = {};
  for (const k of COMMAND_KINDS) out[k] = count(s[k]);
  out.failed = {};
  for (const k of COMMAND_KINDS) out.failed[k] = count(f[k]);
  return out;
}

module.exports = { COMMAND_KINDS, commandKind, isIgnoredCommand, toKind, kindFailures, normalizeKindCounts };
