// A stream's live readers, told when it has moved on: one Durable Object per stream, holding no
// data. A write tells it where the stream now ends, and the D1 bookmark of the write (server.ts);
// a reader at the end waits on it (long-poll, SSE), then reads what's new from its own nearest
// replica, from that bookmark on. Nothing here is stored: if the object restarts, a waiter waits
// out its timeout and reads again, so a lost notice delays a reader but never loses data.
import { DurableObject } from "cloudflare:workers";

/** Where a stream has got to: its generation, its end, the write's bookmark, and if it's closed. */
export type Moved = {
  generation: string;
  offset: string;
  bookmark: string | null;
  closed: boolean;
  /** The stream was deleted (or expired): readers stop. */
  gone: boolean;
};

type Waiter = { generation: string; after: string; done: (moved: Moved | null) => void };

/** Whether `moved` is news to a reader of `generation` that has read up to `after`. */
const isNews = (moved: Moved, generation: string, after: string) =>
  moved.generation !== generation || moved.gone || moved.closed || moved.offset > after;

export class StreamNotifier extends DurableObject {
  private last: Moved | undefined;
  private readonly waiters = new Set<Waiter>();

  /**
   * Wait until the stream (this generation of it) goes past `after`, closes or goes, for at most
   * `timeoutMs`: where it got to, or null if nothing happened.
   */
  async wait(generation: string, after: string, timeoutMs: number): Promise<Moved | null> {
    if (this.last && isNews(this.last, generation, after)) return this.last;
    return new Promise((resolve) => {
      const waiter: Waiter = {
        generation,
        after,
        done: (moved) => {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(moved);
        },
      };
      const timer = setTimeout(() => waiter.done(null), timeoutMs);
      this.waiters.add(waiter);
    });
  }

  /** The stream was written to (or closed, or deleted): every waiter it's news to is told. */
  async moved(moved: Moved): Promise<void> {
    const later =
      !this.last ||
      this.last.generation !== moved.generation ||
      moved.gone ||
      moved.offset >= this.last.offset;
    if (later) this.last = moved;
    // A Set goes on correctly while what it has visited is deleted (done removes each waiter).
    for (const waiter of this.waiters)
      if (isNews(moved, waiter.generation, waiter.after)) waiter.done(moved);
  }
}
