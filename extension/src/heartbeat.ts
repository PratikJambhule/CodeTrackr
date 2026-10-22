/**
 * The time engine (plan §2, tasks E3 + E6). Pure: every method takes the time as an argument, so the
 * rules are tested to the second without real clocks.
 *
 * How time is counted:
 *  - Every action is a heartbeat: typing = writing; scrolling, moving the cursor, switching files,
 *    coming back to VS Code = reading; a command, task or debug session starting = running.
 *  - The gap between two heartbeats counts if it is at most GAP_CAP (60 s); a longer gap was a break
 *    and counts 0 (user decision 2026-10-22). The gap takes the KIND of the heartbeat that ends it
 *    (the pause before a keystroke was spent on that edit) and the FILE that was active during it.
 *  - While something runs (terminal command, task, debug session), time counts as running, even with
 *    VS Code in the background (user decision 2026-10-22; the server caps it), up to RUN_CAP (30 min)
 *    per run — but only the time you are NOT doing something else. What you do wins (user decision
 *    2026-10-22, D-54): typing with a dev server running is writing, not running. No second is
 *    counted twice.
 *  - So running is counted with a delay: a moment can still be claimed by your next action until
 *    GAP_CAP after your last one (or FOCUS_GRACE after you left VS Code); running time is only
 *    counted up to that "settled" point, minus the moments your actions already claimed.
 *  - Leaving VS Code: back within FOCUS_GRACE (30 s) → the time away counts as reading; away longer →
 *    it counts 0.
 *  - Time after the last heartbeat counts 0 until the next one arrives (it may never: you left).
 */

export type TimeKind = "writing" | "reading" | "running";
const KINDS: TimeKind[] = ["writing", "reading", "running"];

export interface TimeEngineOptions {
  gapCapMs?: number;
  focusGraceMs?: number;
  runCapMs?: number;
  maxFiles?: number;
}

export interface FileTime {
  name: string;
  language: string;
  seconds: number;
  writing: number;
  reading: number;
  running: number;
}

export interface TimeSnapshot {
  /** When the first counted second of this interval happened (null if nothing was counted). */
  startMs: number | null;
  seconds: number;
  writingSec: number;
  readingSec: number;
  runningSec: number;
  /** Sums exactly to `seconds`; at most maxFiles entries (the rest merged into OTHER_FILES). */
  perFile: FileTime[];
}

export const OTHER_FILES = "(other files)";
const UNKNOWN = "unknown";

interface Beat {
  ts: number;
  kind: TimeKind;
  file: string;
  language: string;
}

type Totals = Record<TimeKind, number>;
const zero = (): Totals => ({ writing: 0, reading: 0, running: 0 });

export class TimeEngine {
  readonly gapCapMs: number;
  readonly focusGraceMs: number;
  readonly runCapMs: number;
  readonly maxFiles: number;

  private last: Beat | null = null;
  private activeFile = UNKNOWN;
  private activeLanguage = UNKNOWN;
  private focused = true;
  private blurAt: number | null = null;
  private blurFromActivity = false;

  private runs = new Map<unknown, number>(); // run id -> start ms
  private finishedRuns: Array<{ start: number; end: number }> = []; // recent, already capped
  private runCursor: number | null = null; // running time is accounted up to here (a settled point)
  private activity: Array<[number, number]> = []; // recent spans claimed by the user's actions

  private totals = zero();
  private files = new Map<string, { language: string; t: Totals }>();
  private firstCountedMs: number | null = null;

  constructor(opts: TimeEngineOptions = {}) {
    this.gapCapMs = opts.gapCapMs ?? 60_000;
    this.focusGraceMs = opts.focusGraceMs ?? 30_000;
    this.runCapMs = opts.runCapMs ?? 30 * 60_000;
    this.maxFiles = opts.maxFiles ?? 30;
  }

  // ---------- events ----------

  /** A user action. `file` is the base name of the active file, if any. */
  beat(ts: number, kind: "writing" | "reading", file?: string, language?: string): void {
    if (!this.focused) return; // events while VS Code is in the background are not the user's actions
    this.accountRunning(ts);
    this.countGapTo(ts, kind);
    this.setActive(file, language);
    this.last = { ts, kind, file: this.activeFile, language: this.activeLanguage };
  }

  setFocus(focused: boolean, ts: number): void {
    if (focused === this.focused) return;
    this.accountRunning(ts);
    if (!focused) {
      const active = !!this.last && ts - this.last.ts <= this.gapCapMs;
      if (active && this.last) this.addSpan(this.last.ts, ts, this.last.kind, this.last.file, this.last.language);
      this.blurAt = ts;
      this.blurFromActivity = active;
      this.last = null;
    } else {
      if (this.blurAt !== null && this.blurFromActivity && ts - this.blurAt <= this.focusGraceMs) {
        this.addSpan(this.blurAt, ts, "reading", this.activeFile, this.activeLanguage);
      }
      this.blurAt = null;
      this.last = { ts, kind: "reading", file: this.activeFile, language: this.activeLanguage };
    }
    this.focused = focused;
  }

  /** A terminal command, task or debug session started. Starting it is also a user action. */
  runStart(id: unknown, ts: number): void {
    this.accountRunning(ts);
    if (this.focused) {
      this.countGapTo(ts, "running");
      this.last = { ts, kind: "running", file: this.activeFile, language: this.activeLanguage };
    }
    if (!this.runs.has(id)) this.runs.set(id, ts);
  }

  /** The run finished. Reading its output right after counts like any other activity. */
  runEnd(id: unknown, ts: number): void {
    const start = this.runs.get(id);
    if (start === undefined) return;
    this.accountRunning(ts);
    this.runs.delete(id);
    this.finishedRuns.push({ start, end: Math.min(ts, start + this.runCapMs) });
    if (this.focused) {
      this.last = { ts, kind: "reading", file: this.activeFile, language: this.activeLanguage };
    }
  }

  /** The active file changed without a user action we can see (e.g. restored at startup). */
  setActiveFile(file?: string, language?: string): void {
    this.setActive(file, language);
  }

  // ---------- state ----------

  /** Account running time up to `ts` (call on every timer tick). */
  advance(ts: number): void {
    this.accountRunning(ts);
  }

  isRunning(ts: number): boolean {
    for (const start of this.runs.values()) if (ts < start + this.runCapMs) return true;
    return false;
  }

  /** Nothing is running and the user is gone: away for more than the grace, or no action for 60 s. */
  isIdle(ts: number): boolean {
    if (this.isRunning(ts)) return false;
    if (!this.focused) return this.blurAt === null || ts - this.blurAt > this.focusGraceMs;
    return !this.last || ts - this.last.ts > this.gapCapMs;
  }

  /** Counted milliseconds not yet taken. */
  countedMs(ts?: number): number {
    if (ts !== undefined) this.accountRunning(ts);
    return this.totals.writing + this.totals.reading + this.totals.running;
  }

  /** Everything counted so far, in whole seconds, and reset the counters (the clock state is kept). */
  take(ts: number): TimeSnapshot {
    this.accountRunning(ts);
    const kindSec = {} as Totals;
    for (const k of KINDS) kindSec[k] = Math.round(this.totals[k] / 1000);

    // Split each kind's whole seconds across files by largest remainder, so files sum exactly.
    const names = [...this.files.keys()];
    const perKind = {} as Record<TimeKind, Map<string, number>>;
    for (const k of KINDS) perKind[k] = largestRemainder(names.map((n) => this.files.get(n)!.t[k] / 1000), kindSec[k], names);

    let rows: FileTime[] = names.map((name) => {
      const writing = perKind.writing.get(name) || 0;
      const reading = perKind.reading.get(name) || 0;
      const running = perKind.running.get(name) || 0;
      return { name, language: this.files.get(name)!.language, seconds: writing + reading + running, writing, reading, running };
    }).filter((r) => r.seconds > 0).sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));

    if (rows.length > this.maxFiles) {
      const keep = rows.slice(0, this.maxFiles - 1);
      const rest = rows.slice(this.maxFiles - 1);
      const other: FileTime = { name: OTHER_FILES, language: UNKNOWN, seconds: 0, writing: 0, reading: 0, running: 0 };
      for (const r of rest) { other.seconds += r.seconds; other.writing += r.writing; other.reading += r.reading; other.running += r.running; }
      rows = [...keep, other];
    }

    const snap: TimeSnapshot = {
      startMs: this.firstCountedMs,
      seconds: kindSec.writing + kindSec.reading + kindSec.running,
      writingSec: kindSec.writing,
      readingSec: kindSec.reading,
      runningSec: kindSec.running,
      perFile: rows,
    };
    this.totals = zero();
    this.files.clear();
    this.firstCountedMs = null;
    return snap;
  }

  // ---------- internals ----------

  private setActive(file?: string, language?: string): void {
    if (file) {
      this.activeFile = file;
      this.activeLanguage = language || UNKNOWN;
    }
  }

  /** The gap from the last heartbeat to `ts`, if it was short enough, minus time already counted as running. */
  private countGapTo(ts: number, kind: TimeKind): void {
    if (!this.last) return;
    const gap = ts - this.last.ts;
    if (gap <= 0 || gap > this.gapCapMs) return;
    this.addSpan(this.last.ts, ts, kind, this.last.file, this.last.language);
  }

  /**
   * Add [from, to) as `kind`: the user's own action claims this time, even if something was running
   * (running is counted later, only for moments nobody claimed). Spans never overlap: each starts at
   * the previous heartbeat or at a blur, both after anything already claimed.
   */
  private addSpan(from: number, to: number, kind: TimeKind, file: string, language: string): void {
    if (to <= from) return;
    const start = Math.max(from, this.runCursor ?? from); // never re-claim time already settled
    if (to <= start) return;
    this.add(kind, to - start, file, language, start);
    this.activity.push([start, to]);
  }

  /** The latest moment that no future action can claim any more. */
  private settledTo(ts: number): number {
    if (this.focused) {
      if (this.last && ts - this.last.ts <= this.gapCapMs) return Math.min(ts, this.last.ts);
      return ts;
    }
    if (this.blurAt !== null && this.blurFromActivity && ts - this.blurAt <= this.focusGraceMs) {
      return Math.min(ts, this.blurAt);
    }
    return ts;
  }

  /**
   * Running time from the cursor up to the settled point, counted once even when several runs
   * overlap, minus the moments the user's actions claimed (what you do wins, D-54).
   */
  private accountRunning(ts: number): void {
    if (this.runCursor === null) { this.runCursor = this.settledTo(ts); return; }
    const upTo = this.settledTo(ts);
    if (upTo <= this.runCursor) return;
    const free = subtract(this.runIntervals(this.runCursor, upTo), this.activity);
    let ms = 0;
    for (const [a, b] of free) ms += b - a;
    if (ms > 0) this.add("running", ms, this.activeFile, this.activeLanguage, free[0][0]);
    this.runCursor = upTo;
    this.activity = this.activity.filter(([, b]) => b > upTo);
    // Finished runs are only needed while unsettled time could still overlap them.
    const keepAfter = upTo - 2 * this.gapCapMs;
    this.finishedRuns = this.finishedRuns.filter((r) => r.end > keepAfter);
  }

  /** The union of running intervals inside [from, to), as sorted, non-overlapping [a, b) pairs. */
  private runIntervals(from: number, to: number): Array<[number, number]> {
    const raw: Array<[number, number]> = [];
    for (const r of this.finishedRuns) raw.push([r.start, r.end]);
    for (const start of this.runs.values()) raw.push([start, start + this.runCapMs]);
    const clipped = raw
      .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    const out: Array<[number, number]> = [];
    for (const [a, b] of clipped) {
      const prev = out[out.length - 1];
      if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
      else out.push([a, b]);
    }
    return out;
  }

  private add(kind: TimeKind, ms: number, file: string, language: string, fromTs: number): void {
    this.totals[kind] += ms;
    const f = this.files.get(file) || { language, t: zero() };
    if (f.language === UNKNOWN && language !== UNKNOWN) f.language = language;
    f.t[kind] += ms;
    this.files.set(file, f);
    if (this.firstCountedMs === null || fromTs < this.firstCountedMs) this.firstCountedMs = fromTs;
  }
}

/** `spans` minus `cut`; both sorted lists of [a, b) pairs (cut may overlap itself). */
function subtract(spans: Array<[number, number]>, cut: Array<[number, number]>): Array<[number, number]> {
  const holes = cut.slice().sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a0, b] of spans) {
    let a = a0;
    for (const [c, d] of holes) {
      if (d <= a || c >= b) continue;
      if (c > a) out.push([a, c]);
      a = Math.max(a, d);
      if (a >= b) break;
    }
    if (a < b) out.push([a, b]);
  }
  return out;
}

/** Whole numbers proportional to `values` that sum exactly to `total` (Hamilton's method). */
function largestRemainder(values: number[], total: number, names: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const sum = values.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return out;
  const exact = values.map((v) => (v / sum) * total);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - floors[i], i] as [number, number]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  names.forEach((n, i) => { if (floors[i] > 0) out.set(n, floors[i]); });
  return out;
}
