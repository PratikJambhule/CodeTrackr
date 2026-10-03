# CodeTrackr — working rules for Claude

Claude Code loads this file automatically at the start of every session in this folder.
Follow it on every task.

## 1. Start of every session

1. Read `docs/SESSION_STATE.md` first. It records what was in progress, what is done, and what
   comes next. Resume from it rather than re-deriving the project.
2. For background, read `README.md` and `docs/ARCHITECTURE.md`. Go deeper only as needed:
   `CODETRACKR_PROJECT_CONTEXT.md` (full reference), `docs/IMPROVEMENT_PLAN.md` (every known
   weakness, H-/M-/L- ids).
3. When a doc and the code disagree, the code wins. Fix the doc in the same task.

## 2. Keep the session state current (protects against context loss)

The conversation can be compacted or cut off at any time, with no warning Claude can rely on.
So `docs/SESSION_STATE.md` is updated **as you go**, not only at the end:

- after finishing each step of a multi-step task;
- before any long or risky operation (big refactor, migration, long test run);
- whenever a decision is made or a bug is found;
- at the end of every task.

Keep it short and overwrite stale sections; it is a snapshot, not a log. Write it so a fresh
session with no memory of this one can continue the work. The history belongs in
`docs/PROGRESS.md`.

## 3. Keep the project docs current

After every meaningful change, in the same task as the code:

| File | Update when |
|---|---|
| `README.md` | what it does, stack, or how to run/test changes |
| `docs/ARCHITECTURE.md` | components, data flow or deployment change |
| `docs/DECISIONS.md` | a choice is made: what, why, alternatives rejected, trade-offs |
| `docs/PROGRESS.md` | anything is built, tested, or a bug is found/fixed (dated, newest first) |
| `docs/INTERVIEW_PREP.md` | an answer, number or weakness changes |
| `docs/IMPROVEMENT_PLAN.md` | a finding is found, fixed or changes (keep the H-/M-/L- ids) |
| `CODETRACKR_PROJECT_CONTEXT.md` | any fact in it becomes wrong |
| `docs/interview-preparation/*` | any answer, number, weakness or design in them changes: always the cheat sheet and the "October 2026 update" box at the top of each long guide; then rebuild the PDFs (`bash build_pdfs.sh` in that folder) |
| `docs/interview-preparation/CodeTrackr_Resume_Current.tex` | a resume claim gains or loses evidence (numbers only once measured) |

Write in plain language a fresher could say out loud. Every number needs a source that can be
re-checked (a command, a file, a dated measurement).

## 4. Honesty rules

- Never present unbuilt or unverified work as done. The ML work-type classifier is
  **designed, not built** (`docs/ML_INTEGRATION_PLAN.md`).
- Resume and interview material must match the code and live data. If a claim is not true,
  say which follow-up question would expose it and offer to reword it or build it.

## 5. Verify before calling anything done

```bash
cd backend && npm test
```

```bash
cd extension && npm test
```

```bash
cd frontend && npm run build
```

Report failures with their output. A task is done only when these are green and the change has
been seen working.

## 6. Git and safety

- The user commits and pushes. Leave changes uncommitted unless asked; hand over an explicit
  `git add <paths>` list (never `git add -A`, `git add docs`, or a directory) and a draft message
  in `.git/COMMIT_DRAFT.txt`.
- Leave these permanently-dirty files alone and unstaged: `THEME_USER_GUIDE.md`,
  `extension/extension.js`, `extension/index.html`.
- The live database is read-only for Claude. Migration `--apply` runs and `vsce publish` are the
  user's actions.
