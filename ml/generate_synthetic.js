#!/usr/bin/env node
'use strict';
/**
 * Generates the SYNTHETIC training dataset for the work-type classifier (decision D-45).
 *
 *   node ml/generate_synthetic.js [--people 60] [--seed 20261021] [--out ml/data]
 *
 * How it tries to look real:
 *  - People, not sessions, are simulated first. Each person has habits that carry across all their
 *    sessions: typing speed, whether they use VS Code's terminal at all, whether Git is set up,
 *    whether they use the debugger, how they name practice files, where they keep them, their main
 *    language, how much they paste (AI completions, snippets), how deep they focus, and their own mix
 *    of work types. That is what makes "test on people the model never saw" a real test.
 *  - Sessions are generated as RAW counts the extension would send (minutes, lines, file names, the
 *    actual terminal commands with pass/fail), not as features. Commands are classified with the same
 *    rules as extension/src/commandClassifier.ts (so g++ counts as a build, npm run dev counts as npm),
 *    and the 18 features are computed by backend/services/workTypeFeatures.js, the production code.
 *  - Messiness on purpose: ~20% of sessions mix in a second kind of work, some people never produce
 *    terminal or Git signals, tutorials can have problem-like file names, practice repos can hold a
 *    learning session, and ~4% of labels are "wrong" the way a person mis-taps or disagrees.
 *
 *  - Since 2026-10-22 (feature version 3) it also produces what extension 2.6.0 sends: the writing /
 *    reading / running split, per-file time, command kinds, Code Runner and Run Without Debugging runs
 *    (some people never touch the terminal), real debugging with breakpoint stops, jumps, files created,
 *    and the kind of project (cloned tutorial repos, tiny DSA folders, repos with package files).
 *
 * Every row is tagged source=synthetic. Scores measured on this data are NOT real-world accuracy.
 */
const fs = require('fs');
const path = require('path');
const { sessionFeatures, sessionFeaturesV3, FEATURES_BY_VERSION } = require('../backend/services/workTypeFeatures');
const { commandKind } = require('../backend/services/commandKinds');
const { classifyWorkType, WORK_TYPES } = require('../backend/services/workType');

// ---------- args ----------
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const PEOPLE = Number(arg('people', 60));
const SEED = Number(arg('seed', 20261021));
const OUT = path.resolve(arg('out', path.join(__dirname, 'data')));
// Feature version 3 (extension 2.6.0 signals) by default; --features 2 rebuilds the older dataset.
const FEATURE_VER = Number(arg('features', 3));

// ---------- seeded random ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const U = (a = 0, b = 1) => a + (b - a) * rnd();
const chance = (p) => rnd() < p;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function normal(m = 0, s = 1) { let u = 0; while (u === 0) u = rnd(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
const logN = (median, sigma) => median * Math.exp(normal(0, sigma));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function gamma(k) { // Marsaglia–Tsang
  if (k < 1) return gamma(k + 1) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
const beta = (mean, conc = 12) => { const a = gamma(mean * conc), b = gamma((1 - mean) * conc); return a / (a + b); };
function poisson(l) { if (l <= 0) return 0; if (l > 30) return Math.max(0, Math.round(normal(l, Math.sqrt(l)))); let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; }
function weighted(obj) { const e = Object.entries(obj); let r = rnd() * e.reduce((s, [, w]) => s + w, 0); for (const [k, w] of e) { if ((r -= w) <= 0) return k; } return e[e.length - 1][0]; }
function dirichletAround(weights, conc) { const g = Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, gamma(Math.max(0.05, w * conc))])); const s = Object.values(g).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v / s])); }

// ---------- command classification: mirrors extension/src/commandClassifier.ts ----------
const BUILD = ['npm run build', 'pnpm build', 'yarn build', 'gradle build', 'mvn package', 'mvn install', 'cargo build', 'go build', 'gcc', 'g++', 'clang'];
const TEST = ['npm test', 'pnpm test', 'yarn test', 'pytest', 'jest', 'mvn test', 'gradle test', 'cargo test', 'go test'];
function category(cmd) {
  const base = cmd.trim().toLowerCase().split(/\s+/)[0];
  return ({ git: 'git', npm: 'npm', pnpm: 'npm', yarn: 'npm', node: 'node', python: 'python', python3: 'python',
    docker: 'docker', pip: 'pip', pip3: 'pip', java: 'java', javac: 'java', gcc: 'gcc', 'g++': 'gcc', clang: 'gcc', 'clang++': 'gcc' })[base] || 'misc';
}
const starts = (cmd, list) => list.some((p) => cmd.toLowerCase().startsWith(p));

// ---------- vocab ----------
const LANGS = {
  cpp: { ext: 'cpp', run: (f) => [`g++ ${f} -o a`, './a'], weight: 0.4 },
  py: { ext: 'py', run: (f) => [`python ${f}`], weight: 0.27 },
  java: { ext: 'java', run: (f) => [`javac ${f}`, `java ${f.replace(/\.java$/, '')}`], weight: 0.2 },
  js: { ext: 'js', run: (f) => [`node ${f}`], weight: 0.13 },
};
const DSA_TITLES = ['two_sum', 'valid_parentheses', 'merge_intervals', 'longest_substring', 'binary_search', 'climbing_stairs',
  'coin_change', 'number_of_islands', 'kth_largest', 'reverse_linked_list', 'max_subarray', 'lis', 'n_queens', 'rotate_matrix',
  'top_k_frequent', 'three_sum', 'dijkstra', 'topological_sort', 'min_stack', 'sudoku_solver', 'word_search', 'fib', 'sieve', 'knapsack'];
const camel = (s) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
function dsaFileName(person, i) {
  const ext = LANGS[person.lang].ext;
  switch (person.naming) {
    case 'titles': { const t = pick(DSA_TITLES); return person.lang === 'java' ? `${camel(t)}.java` : `${t}.${ext}`; }
    case 'numbers': return chance(0.5) ? `${Math.floor(U(1, 3200))}.${ext}` : `${pick(['q', 'p', 'lc_'])}${Math.floor(U(1, 9))}.${ext}`;
    case 'letters': return `${pick(['A', 'B', 'C', 'D', 'E'])}.${ext}`;
    default: return person.lang === 'java' ? pick(['Main.java', 'Solution.java']) : `${pick(['main', 'sol', 'solution', 'test', 'prog'])}${i ? i : ''}.${ext}`;
  }
}
const PROJECT_FILES = {
  js: ['App.jsx', 'index.js', 'server.js', 'routes.js', 'api.js', 'auth.js', 'Navbar.jsx', 'Dashboard.jsx', 'utils.js', 'db.js', 'models.js', 'styles.css', 'index.html', 'Login.jsx', 'controller.js'],
  py: ['app.py', 'main.py', 'models.py', 'views.py', 'urls.py', 'utils.py', 'db.py', 'train.py', 'dataset.py', 'api.py', 'forms.py', 'serializers.py', 'notebook.ipynb'],
  java: ['Main.java', 'UserService.java', 'Controller.java', 'Repository.java', 'Library.java', 'Book.java', 'Student.java', 'Utils.java', 'DbConnection.java'],
  cpp: ['main.cpp', 'bank.cpp', 'bank.h', 'utils.cpp', 'game.cpp', 'player.h', 'library.cpp', 'menu.cpp'],
};
const CONFIG_FILES = ['package.json', 'Dockerfile', 'docker-compose.yml', '.env', 'tsconfig.json', 'requirements.txt', 'vite.config.js', '.eslintrc.cjs', 'ci.yml', '.gitignore', 'pyproject.toml', 'pom.xml', 'tailwind.config.js', 'nginx.conf'];
const LEARN_FILES = ['notes.md', 'README.md', 'lesson1.py', 'example.js', 'intro.py', 'tutorial.js', 'demo.java', 'hooks_demo.jsx', 'decorators.py', 'async_example.js', 'pointers.cpp', 'oop_basics.java'];
const PRACTICE_FOLDERS = ['leetcode', 'LeetCode-Solutions', 'dsa', 'DSA-Sheet', 'cp', 'codeforces', 'gfg-potd', 'striver-a2z-dsa'];
const GENERIC_FOLDERS = ['practice', 'cpp-programs', 'college-lab', 'codes', 'Desktop', 'sem3', 'programs'];
const PROJECTS = ['chat-app', 'portfolio', 'ecommerce-site', 'library-management', 'ml-mini-project', 'todo-api', 'expense-tracker', 'hackathon-bot', 'attendance-system', 'weather-app', 'blog-backend', 'college-fest-site'];
const LEARN_FOLDERS = ['react-tutorial', 'learning-python', 'udemy-node-course', 'java-oops', 'docker-practice', 'nptel-assignments'];

// ---------- people ----------
const PROFILES = {
  'dsa-grinder': { dsa: 0.55, project: 0.15, debugging: 0.1, learning: 0.12, setup: 0.08 },
  builder: { dsa: 0.1, project: 0.45, debugging: 0.2, learning: 0.1, setup: 0.15 },
  learner: { dsa: 0.22, project: 0.18, debugging: 0.1, learning: 0.4, setup: 0.1 },
  balanced: { dsa: 0.22, project: 0.25, debugging: 0.2, learning: 0.18, setup: 0.15 },
};
function makePerson(i) {
  const profile = weighted({ 'dsa-grinder': 0.32, builder: 0.28, learner: 0.18, balanced: 0.22 });
  return {
    id: `p${String(i + 1).padStart(3, '0')}`,
    profile,
    mix: dirichletAround(PROFILES[profile], 8),
    speed: logN(1, 0.35),
    usesTerminal: chance(0.85),           // others run code with a "Run" button or outside VS Code
    cmdRate: logN(1, 0.4),
    usesGit: chance(0.8),
    commitHabit: logN(1, 0.6),
    usesDebugger: chance(0.4),
    usesRunButton: chance(0.25),          // runs code with Code Runner's ▶ instead of the terminal
    ctrlF5: chance(0.2),                  // starts programs with Run Without Debugging
    naming: weighted({ titles: 0.45, numbers: 0.2, letters: 0.1, generic: 0.25 }),
    keepsPracticeFolder: chance(0.35),
    practiceFolder: pick(PRACTICE_FOLDERS),
    genericFolder: pick(GENERIC_FOLDERS),
    lang: weighted(Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.weight]))),
    webLang: chance(0.7) ? 'js' : 'py',
    paste: logN(1, 0.5),
    deepWorker: beta(0.45, 4),
    sessions: Math.round(clamp(logN(26, 0.55), 6, 120)),
  };
}

// ---------- one kind of work, as raw counts ----------
const TYPE = {
  //            minutes   lines/min  insertShare churn  read  paste  switches/min  cmds/min
  dsa:        { min: 40, rate: 2.4, ins: 0.72, churn: 0.32, read: 0.45, paste: 0.08, sw: 0.15, cmd: 0.45 },
  project:    { min: 70, rate: 4.2, ins: 0.76, churn: 0.2, read: 0.4, paste: 0.22, sw: 0.4, cmd: 0.22 },
  debugging:  { min: 45, rate: 1.4, ins: 0.52, churn: 0.48, read: 0.6, paste: 0.08, sw: 0.5, cmd: 0.42 },
  learning:   { min: 35, rate: 0.7, ins: 0.72, churn: 0.25, read: 0.79, paste: 0.38, sw: 0.65, cmd: 0.12 },
  setup:      { min: 25, rate: 0.9, ins: 0.7, churn: 0.18, read: 0.5, paste: 0.42, sw: 0.35, cmd: 0.75 },
};

function filesFor(type, p) {
  const proj = PROJECT_FILES[type === 'dsa' ? p.lang : (p.lang === 'cpp' && chance(0.3) ? 'cpp' : p.webLang)];
  switch (type) {
    case 'dsa': {
      const n = 1 + poisson(0.6);
      const files = Array.from({ length: n }, (_, i) => dsaFileName(p, i));
      if (chance(0.08)) files.push('input.txt');
      return files;
    }
    case 'project': {
      const files = Array.from({ length: 3 + poisson(4) }, () => pick(proj));
      if (chance(0.3)) files.push(pick(CONFIG_FILES));
      if (chance(0.15)) files.push('README.md');
      return files;
    }
    case 'debugging': {
      const files = Array.from({ length: 2 + poisson(2) }, () => pick(proj));
      if (chance(0.3)) files.push(p.webLang === 'py' ? 'test_api.py' : 'api.test.js');
      if (chance(0.15)) files.push(pick(CONFIG_FILES));
      return files;
    }
    case 'learning': {
      const files = Array.from({ length: 3 + poisson(4) }, () => (chance(0.5) ? pick(LEARN_FILES) : pick(proj)));
      if (chance(0.2)) files.push(`${pick(DSA_TITLES)}.${LANGS[p.lang].ext}`); // tutorials have problem-like names too
      return files;
    }
    default: { // setup
      const files = Array.from({ length: 2 + poisson(2.5) }, () => pick(CONFIG_FILES));
      files.push(...Array.from({ length: poisson(1) }, () => pick(proj)));
      return files;
    }
  }
}

function commandsFor(type, p, files, n) {
  const code = files.filter((f) => /\.(cpp|py|java|js)$/.test(f));
  const runOf = (f) => LANGS[{ cpp: 'cpp', py: 'py', java: 'java', js: 'js' }[f.split('.').pop()]].run(f);
  const js = p.webLang === 'js';
  const menus = {
    dsa: () => (code.length && chance(0.92) ? pick(runOf(pick(code))) : pick(['git add .', 'git commit -m "sol"', 'ls', 'cat input.txt'])),
    project: () => weighted(js
      ? { 'npm run dev': 4, 'npm install': 1.2, 'npm run build': 1, 'npm test': 0.8, 'git status': 1.5, 'git add .': 1, 'git commit -m "wip"': 0.8, 'git push': 0.5, 'node server.js': 1, 'npx prisma migrate dev': 0.3, 'curl localhost:3000/api': 0.5 }
      : { 'python app.py': 3, 'python manage.py runserver': 1.5, 'pip install requests': 0.8, 'pytest': 0.8, 'git status': 1.5, 'git add .': 1, 'git commit -m "wip"': 0.8, 'git push': 0.5, 'python train.py': 0.6 }),
    debugging: () => weighted(js
      ? { 'npm run dev': 3, 'npm test': 2, 'npm run build': 1.5, 'node server.js': 1.5, 'git diff': 1, 'git stash': 0.3, 'curl localhost:3000/api': 1, 'node --inspect server.js': 0.3 }
      : { 'python app.py': 3, 'pytest': 2.5, 'python -m pdb app.py': 0.4, 'git diff': 1, 'pip install -r requirements.txt': 0.4, 'python manage.py runserver': 1 }),
    learning: () => weighted({ [code.length ? pick(runOf(pick(code))) : 'python intro.py']: 3, 'npm install': 0.5, 'git clone https://github.com/x/y': 0.6, 'ls': 0.8, 'pip install numpy': 0.4 }),
    setup: () => weighted({ 'npm install': 3, 'npm init -y': 0.8, 'npx create-vite@latest': 0.6, 'pip install -r requirements.txt': 1.2, 'docker compose up': 1.5, 'docker build .': 1, 'git init': 0.6, 'git add .': 0.8, 'git commit -m "init"': 0.3, 'npm run dev': 0.8, 'python -m venv .venv': 0.6, 'nvm use 20': 0.3 }),
  };
  const failP = { dsa: 0.32, project: 0.12, debugging: 0.45, learning: 0.15, setup: 0.22 }[type];
  const out = [];
  for (let i = 0; i < n; i++) {
    const cmd = menus[type]();
    let fp = failP;
    if (starts(cmd, ['g++', 'gcc', 'javac', 'npm run build', 'npm test', 'pytest'])) fp *= 1.4; // builds/tests fail more
    if (starts(cmd, ['git status', 'git diff', 'ls', 'cat', 'git add'])) fp = 0.01;
    out.push({ cmd, failed: chance(clamp(fp, 0, 0.95)) });
  }
  return out;
}

function flowBlocks(activeMin, p, type) {
  const blocks = [];
  let left = activeMin * 60000;
  const meanBlock = (p.deepWorker * 40 + 6) * (type === 'learning' ? 0.7 : type === 'setup' ? 0.6 : 1) * 60000;
  while (left > 60000) { const b = Math.min(left, Math.max(60000, logN(meanBlock, 0.6))); blocks.push(Math.round(b)); left -= b + 0; }
  return blocks;
}

function rawSession(type, p, scale = 1) {
  const t = TYPE[type];
  const activeMin = clamp(logN(t.min, 0.5) * scale, scale < 1 ? 2 : 6, 240);
  const editVolume = Math.round(logN(t.rate, 0.45) * p.speed * activeMin);
  const inserted = Math.round(editVolume * beta(t.ins, 15));
  const deleted = editVolume - inserted;
  const churn = Math.round(inserted * beta(t.churn, 10));
  const focusFrac = beta(0.85, 20);
  const attention = activeMin * 60000 * focusFrac;
  const readFrac = beta(t.read, 14);
  const readMs = Math.round(attention * readFrac);
  const charsInserted = Math.round(inserted * U(22, 42));
  const pasteMean = clamp(t.paste * p.paste, 0.01, 0.9);
  const largeInsertChars = type === 'dsa' && chance(0.15) ? Math.round(charsInserted * beta(0.5, 6)) // template paste
    : Math.round(charsInserted * beta(pasteMean, 8));
  const files = filesFor(type, p);
  const fileSwitches = poisson(logN(t.sw, 0.4) * activeMin);
  const nCmd = p.usesTerminal ? poisson(t.cmd * p.cmdRate * activeMin * logN(1, 0.3)) : 0;
  let cmds = commandsFor(type, p, files, nCmd);
  // Runs that never reach the terminal: Code Runner's ▶ button and Run Without Debugging (Ctrl+F5).
  const runs = { terminal: 0, task: 0, debugNoDebug: 0, codeRunner: 0 };
  if (p.usesRunButton && (type === 'dsa' || type === 'learning')) {
    const viaButton = cmds.filter((c) => ['run', 'compile'].includes(commandKind(c.cmd)) && chance(0.85));
    runs.codeRunner = viaButton.length + (p.usesTerminal ? 0 : poisson(0.5 * activeMin));
    cmds = cmds.filter((c) => !viaButton.includes(c));
  }
  if (p.ctrlF5 && (type === 'project' || type === 'debugging')) {
    const viaF5 = cmds.filter((c) => commandKind(c.cmd) === 'run' && chance(0.4));
    runs.debugNoDebug = viaF5.length;
    cmds = cmds.filter((c) => !viaF5.includes(c));
  }
  if ((type === 'project' || type === 'setup') && chance(0.15)) runs.task = 1 + poisson(1);
  runs.terminal = cmds.length;
  const kinds = {};
  const kindFailed = {};
  const usage = {};
  let failedCommands = 0, buildRuns = 0, failedBuilds = 0, testRuns = 0, gitCommits = 0;
  for (const { cmd, failed } of cmds) {
    const c = category(cmd); usage[c] = (usage[c] || 0) + 1;
    const k = commandKind(cmd); kinds[k] = (kinds[k] || 0) + 1;
    if (failed) { failedCommands++; kindFailed[k] = (kindFailed[k] || 0) + 1; }
    if (starts(cmd, BUILD)) { buildRuns++; if (failed) failedBuilds++; }
    if (starts(cmd, TEST)) testRuns++;
    if (cmd.startsWith('git commit') && !failed) gitCommits++;
  }
  const commitRate = { dsa: 0.03, project: 0.75, debugging: 0.35, learning: 0.05, setup: 0.25 }[type]; // per hour, GUI commits too
  const commits = p.usesGit ? gitCommits + poisson(commitRate * p.commitHabit * activeMin / 60) : 0;
  const debugRate = { dsa: 0.15, project: 0.25, debugging: 2.2, learning: 0.1, setup: 0.05 }[type];
  const debuggingSessions = p.usesDebugger ? poisson(debugRate * activeMin / 60) : (type === 'debugging' && chance(0.08) ? 1 : 0);
  // Time split (heartbeat engine): running = time something ran (≤ 70% of the session), the rest
  // split into reading and writing like the attention above.
  const activeSec = Math.round(activeMin * 60);
  const runSec = (cmd) => {
    // A server runs for the whole session, but since D-54 only the time you just wait on it is running.
    if (/npm run dev|runserver|compose up|server\.js/.test(cmd)) return U(30, 240);
    return { compile: U(3, 15), run: U(2, 40), install: U(15, 120), test: U(10, 90), build: U(20, 120), docker: U(30, 300), git: U(1, 5) }[commandKind(cmd)] || U(1, 10);
  };
  let running = cmds.reduce((a, c) => a + runSec(c.cmd), 0) + (runs.codeRunner + runs.debugNoDebug) * U(2, 30)
    + runs.task * U(20, 120) + debuggingSessions * U(60, 600);
  running = Math.round(Math.min(running, activeSec * 0.7));
  const readingSec = Math.round((activeSec - running) * readFrac);
  const writingSec = activeSec - running - readingSec;
  // Per-file time: the first file usually dominates (the problem, the component being built).
  const uniq = [...new Set(files)];
  const weights = uniq.map((_, i) => gamma(i === 0 ? (type === 'dsa' ? 6 : 2.5) : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const fileSec = {};
  uniq.forEach((f, i) => { fileSec[f] = { seconds: Math.round(activeSec * weights[i] / wsum) }; });
  const nav = { dsa: 0.1, project: 0.25, debugging: 0.5, learning: 0.6, setup: 0.1 }[type];
  const openedRate = { dsa: 0.2, project: 1, debugging: 1.5, learning: 3, setup: 0.5 }[type];
  const reading = {
    scrollEvents: poisson((readingSec / 60) * 1.2),
    navigations: poisson(nav * activeMin),
    filesOpenedNotEdited: Math.min(uniq.length, poisson(openedRate)),
  };
  const filesCreated = poisson({ dsa: 0.8, project: 0.5, debugging: 0.1, learning: 0.3, setup: 1.5 }[type]);
  const debug = { sessions: debuggingSessions, breakpointStops: poisson(3 * debuggingSessions), steps: poisson(8 * debuggingSessions) };
  const web = p.webLang === 'js';
  const workspace = {
    dsa: () => ({ sourceFilesBucket: p.keepsPracticeFolder ? pick(['21-100', '101-500']) : pick(['1', '2-5', '6-20']),
      hasPackageJson: false, hasRequirements: false, hasGit: p.keepsPracticeFolder && p.usesGit, ownCommits: p.keepsPracticeFolder && p.usesGit, clonedRecently: false }),
    project: () => ({ sourceFilesBucket: pick(['6-20', '21-100', '21-100', '101-500']), hasPackageJson: web, hasRequirements: !web,
      hasGit: p.usesGit, ownCommits: p.usesGit, clonedRecently: chance(0.05) }),
    debugging: () => ({ sourceFilesBucket: pick(['6-20', '21-100', '101-500']), hasPackageJson: web, hasRequirements: !web,
      hasGit: p.usesGit, ownCommits: p.usesGit && chance(0.85), clonedRecently: chance(0.08) }),
    learning: () => { const cloned = chance(0.5);
      return { sourceFilesBucket: pick(['2-5', '6-20', '21-100']), hasPackageJson: web && chance(0.6), hasRequirements: !web && chance(0.4),
        hasGit: cloned || chance(0.3), ownCommits: cloned ? false : chance(0.3), clonedRecently: cloned }; },
    setup: () => ({ sourceFilesBucket: pick(['1', '2-5', '6-20']), hasPackageJson: web || chance(0.3), hasRequirements: !web,
      hasGit: chance(0.6), ownCommits: chance(0.5), clonedRecently: chance(0.2) }),
  }[type]();
  let projects;
  if (type === 'dsa') projects = [p.keepsPracticeFolder ? p.practiceFolder : p.genericFolder];
  else if (type === 'learning') projects = [chance(0.06) && p.keepsPracticeFolder ? p.practiceFolder : (chance(0.55) ? pick(LEARN_FOLDERS) : pick(PROJECTS))];
  else projects = [pick(PROJECTS)];
  return {
    durationSec: Math.round(activeMin * 60), linesInserted: inserted, linesDeleted: deleted, churnLines: churn,
    charsInserted, largeInsertChars, readMs, writeMs: Math.round(attention - readMs), fileSwitches,
    files, projects, totalCommands: cmds.length, failedCommands, commandUsage: usage, buildRuns, failedBuilds,
    testRuns, debuggingSessions, commits, flowBlocksMs: flowBlocks(activeMin, p, type),
    // extension 2.6.0 (payload v3) signals
    writingSec, readingSec, runningSec: running, fileSec, runs, debug, reading, filesCreated, filesDeleted: poisson(0.1), workspace,
    commandKinds: { ...kinds, failed: kindFailed },
  };
}

function merge(a, b) {
  const out = { ...a };
  for (const k of ['durationSec', 'linesInserted', 'linesDeleted', 'churnLines', 'charsInserted', 'largeInsertChars', 'readMs', 'writeMs',
    'fileSwitches', 'totalCommands', 'failedCommands', 'buildRuns', 'failedBuilds', 'testRuns', 'debuggingSessions', 'commits']) out[k] = a[k] + b[k];
  out.files = [...a.files, ...b.files];
  out.projects = [...new Set([...a.projects, ...b.projects])];
  out.commandUsage = { ...a.commandUsage };
  for (const [k, v] of Object.entries(b.commandUsage)) out.commandUsage[k] = (out.commandUsage[k] || 0) + v;
  out.flowBlocksMs = [...a.flowBlocksMs, ...b.flowBlocksMs];
  for (const k of ['writingSec', 'readingSec', 'runningSec', 'filesCreated', 'filesDeleted']) out[k] = a[k] + b[k];
  const addAll = (x, y) => { const o = { ...x }; for (const [k, v] of Object.entries(y || {})) o[k] = typeof v === 'object' ? addAll(o[k] || {}, v) : (o[k] || 0) + v; return o; };
  for (const k of ['runs', 'debug', 'reading', 'commandKinds']) out[k] = addAll(a[k], b[k]);
  out.fileSec = { ...a.fileSec };
  for (const [f, v] of Object.entries(b.fileSec)) out.fileSec[f] = { seconds: ((out.fileSec[f] && out.fileSec[f].seconds) || 0) + v.seconds };
  out.workspace = a.workspace; // the session's own project
  return out;
}

const NEIGHBOUR = { dsa: ['debugging', 'learning'], project: ['debugging', 'setup', 'learning'], debugging: ['project', 'dsa'], learning: ['project', 'dsa'], setup: ['project'] };
// what a second kind of work inside a session usually is
const SECONDARY = { dsa: { learning: 2, debugging: 1 }, project: { debugging: 3, setup: 1.5, learning: 1 }, debugging: { project: 3, learning: 1 }, learning: { project: 2, dsa: 1, setup: 1 }, setup: { project: 3, debugging: 1 } };

// ---------- generate ----------
const rows = [];
const raws = [];
let n = 0;
for (let i = 0; i < PEOPLE; i++) {
  const p = makePerson(i);
  for (let s = 0; s < p.sessions; s++) {
    const label = weighted(p.mix);
    let raw = rawSession(label, p);
    let mixedWith = '';
    if (chance(0.2)) { mixedWith = weighted(SECONDARY[label]); raw = merge(raw, rawSession(mixedWith, p, U(0.25, 0.6))); }
    const fv = FEATURE_VER === 3 ? sessionFeaturesV3(raw) : sessionFeatures(raw);
    if (fv.meta.activeMin < 5 || (fv.meta.editVolume === 0 && fv.meta.totalCommands === 0)) continue; // "not enough activity": never labelled
    const noisy = chance(0.04);
    const given = noisy ? pick(NEIGHBOUR[label]) : label;
    const rule = classifyWorkType(fv).workType;
    const id = `s${String(++n).padStart(5, '0')}`;
    rows.push({ sessionId: id, personId: p.id, source: 'synthetic', label: given, trueType: label, labelNoise: noisy ? 1 : 0,
      mixedWith, blind: chance(0.2) ? 1 : 0, ruleType: rule, featureVersion: fv.version, activeMin: fv.meta.activeMin, ...fv.features });
    raws.push({ sessionId: id, personId: p.id, label: given, raw });
  }
}

fs.mkdirSync(OUT, { recursive: true });
const cols = ['sessionId', 'personId', 'source', 'label', 'trueType', 'labelNoise', 'mixedWith', 'blind', 'ruleType', 'featureVersion', 'activeMin', ...FEATURES_BY_VERSION[FEATURE_VER]];
fs.writeFileSync(path.join(OUT, `synthetic_sessions_v${FEATURE_VER}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n') + '\n');
fs.writeFileSync(path.join(OUT, `synthetic_sessions_v${FEATURE_VER}_raw.jsonl`), raws.map((r) => JSON.stringify(r)).join('\n') + '\n');

const count = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log(JSON.stringify({ seed: SEED, featureVersion: FEATURE_VER, people: PEOPLE, sessions: rows.length, labels: count('label'), mixed: rows.filter((r) => r.mixedWith).length,
  noisyLabels: rows.filter((r) => r.labelNoise).length, blind: rows.filter((r) => r.blind).length, ruleTypes: count('ruleType'),
  rulesAgreeWithTrueType: +(rows.filter((r) => r.ruleType === r.trueType).length / rows.length).toFixed(3) }, null, 1));
console.log('wrote', path.relative(process.cwd(), path.join(OUT, `synthetic_sessions_v${FEATURE_VER}.csv`)));
void WORK_TYPES;
