/**
 * Persisted FIFO of uploads that have not reached the server yet (roadmap
 * item 8, fixes M-30 and the "time is lost on restart" gap).
 *
 * Before 2.5.0 an unsent payload was merged into the next one in memory: a
 * restart lost it, a long outage produced one payload over 3600 s that was then
 * dropped whole, and the merged time took the NEWEST interval's project and
 * timestamp. Now every upload keeps its own flushId, timestamp, project and
 * language, waits here (saved in VS Code's globalState) and is sent oldest
 * first. Because a retry re-sends the same flushId, the server's idempotency
 * check (ingestreceipts) makes "sent twice" count once.
 */

export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** What the sender reports for one item. */
export type SendResult = "ok" | "drop" | "retry";

const STORE_KEY = "codetrackr.outbox";
// The server refuses timestamps older than 24 h; keep a margin for clock skew.
const MAX_AGE_MS = 23.5 * 60 * 60 * 1000;

export class Outbox {
  private items: any[];
  private draining = false;

  constructor(private store?: KeyValueStore, private maxItems = 500) {
    const saved = store?.get<unknown>(STORE_KEY);
    this.items = Array.isArray(saved) ? saved.filter((p) => p && typeof p === "object") : [];
  }

  get size(): number {
    return this.items.length;
  }

  /** Copy of the queue, oldest first (tests and the status command). */
  peekAll(): any[] {
    return this.items.slice();
  }

  async enqueue(payload: any): Promise<void> {
    this.items.push(payload);
    if (this.items.length > this.maxItems) {
      this.items.splice(0, this.items.length - this.maxItems);
    }
    await this.persist();
  }

  /**
   * Send items oldest first. "ok" and "drop" remove the item; "retry" stops the
   * drain and keeps it (and everything behind it) for next time. Re-entrant
   * calls return immediately, so a timer tick cannot double-send.
   */
  async drain(send: (payload: any) => Promise<SendResult>): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      this.pruneStale();
      while (this.items.length > 0) {
        const result = await send(this.items[0]);
        if (result === "retry") break;
        this.items.shift();
        await this.persist();
      }
    } finally {
      this.draining = false;
      await this.persist();
    }
  }

  private pruneStale(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    const before = this.items.length;
    this.items = this.items.filter((p) => {
      const t = new Date(p.timestamp).getTime();
      return !Number.isFinite(t) || t >= cutoff;
    });
    const dropped = before - this.items.length;
    if (dropped > 0) {
      console.warn(`CodeTrackr: dropped ${dropped} queued upload(s) older than the server accepts (24 h)`);
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store?.update(STORE_KEY, this.items);
    } catch (err) {
      console.error("CodeTrackr: could not persist the upload queue", err);
    }
  }
}
