/**
 * Work-mode picker (plan E12): the user tells CodeTrackr what kind of work they are doing.
 *
 * The choice is remembered per workspace, but it only counts as a LABEL when it was picked or
 * confirmed in the current coding session (user decision 2026-10-22). A remembered mode from an
 * earlier session is shown with a "?" and sent with confirmed: false, so a stale choice ("DSA" left
 * on from yesterday) never becomes a wrong label. A confirmation lasts while uploads keep coming;
 * after SESSION_GAP_MS with no upload (the same 30-minute gap that starts a new coding session on
 * the server, services/sessionize.js) it has to be confirmed again.
 *
 * Pure: storage and the clock are passed in, so this is tested without VS Code.
 */

export const WORK_MODES = ["auto", "dsa", "project", "debugging", "learning", "setup"] as const;
export type WorkModeId = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkModeId, string> = {
  auto: "Auto",
  dsa: "DSA practice",
  project: "Project building",
  debugging: "Debugging",
  learning: "Learning & exploring",
  setup: "Setup & config",
};

const WORK_MODE_HINTS: Record<WorkModeId, string> = {
  auto: "Let CodeTrackr guess from what you do",
  dsa: "LeetCode, Codeforces, lab programs",
  project: "Building an app or a feature",
  debugging: "Fixing something that is broken",
  learning: "Reading code or docs, following a tutorial",
  setup: "Installing, configuring, getting a project to run",
};

const SHORT: Record<WorkModeId, string> = {
  auto: "Auto", dsa: "DSA", project: "Project", debugging: "Debugging", learning: "Learning", setup: "Setup",
};

export const SESSION_GAP_MS = 30 * 60 * 1000;
const STORE_KEY = "codetrackr.workMode";

export interface ModeStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface UserModePayload {
  mode: WorkModeId;
  confirmed: boolean;
}

export interface PickItem {
  label: string;
  description: string;
  mode: WorkModeId;
  confirmOnly?: boolean;
}

export function isWorkMode(v: unknown): v is WorkModeId {
  return typeof v === "string" && (WORK_MODES as readonly string[]).includes(v);
}

export class WorkMode {
  private confirmedAt: number | null = null;
  private lastUse: number | null = null;

  constructor(private store: ModeStore, private now: () => number = Date.now) {}

  /** The remembered mode for this workspace ("auto" when none). */
  current(): WorkModeId {
    const saved = this.store.get<string>(STORE_KEY);
    return isWorkMode(saved) ? saved : "auto";
  }

  /** True when the current mode was picked or confirmed in this coding session. */
  isConfirmed(): boolean {
    if (this.confirmedAt === null || this.current() === "auto") return false;
    const last = this.lastUse ?? this.confirmedAt;
    if (this.now() - last > SESSION_GAP_MS) {
      this.confirmedAt = null; // the session ended: ask again
      return false;
    }
    return true;
  }

  /** The user picked a mode: remember it and count it as confirmed now. */
  async set(mode: WorkModeId): Promise<void> {
    await this.store.update(STORE_KEY, mode);
    this.confirmedAt = mode === "auto" ? null : this.now();
    this.lastUse = this.confirmedAt;
  }

  /** "Still DSA practice": confirm the remembered mode without changing it. */
  confirm(): void {
    if (this.current() === "auto") return;
    this.confirmedAt = this.now();
    this.lastUse = this.confirmedAt;
  }

  /**
   * What goes into an upload. Each upload with a confirmed mode keeps the confirmation alive
   * (it is the same coding session); the check happens before the upload refreshes it.
   */
  payload(): UserModePayload {
    const confirmed = this.isConfirmed();
    if (confirmed) this.lastUse = this.now();
    return { mode: this.current(), confirmed };
  }

  /** Status-bar text: a "?" means "remembered, not confirmed in this session". */
  statusText(): string {
    const mode = this.current();
    if (mode === "auto") return "$(symbol-event) CodeTrackr: Auto";
    return `$(symbol-event) CodeTrackr: ${SHORT[mode]}${this.isConfirmed() ? "" : "?"}`;
  }

  tooltip(): string {
    const mode = this.current();
    if (mode === "auto") return "CodeTrackr guesses what kind of work this is. Click to tell it instead.";
    return this.isConfirmed()
      ? `You said: ${WORK_MODE_LABELS[mode]}. It labels this session. Click to change.`
      : `Last time you said: ${WORK_MODE_LABELS[mode]}. Click to confirm or change it for this session.`;
  }

  /** Quick Pick entries: "Still …" first when a remembered mode needs confirming. */
  pickItems(): PickItem[] {
    const mode = this.current();
    const items: PickItem[] = [];
    if (mode !== "auto" && !this.isConfirmed()) {
      items.push({ label: `$(check) Still ${WORK_MODE_LABELS[mode]}`, description: "Confirm for this session", mode, confirmOnly: true });
    }
    for (const m of WORK_MODES) {
      items.push({ label: `${m === mode ? "$(circle-filled)" : "$(circle-outline)"} ${WORK_MODE_LABELS[m]}`, description: WORK_MODE_HINTS[m], mode: m });
    }
    return items;
  }

  /** Apply what the user chose in the Quick Pick. */
  async choose(item: PickItem | undefined): Promise<void> {
    if (!item) return;
    if (item.confirmOnly) this.confirm();
    else await this.set(item.mode);
  }
}
