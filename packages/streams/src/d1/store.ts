// Durable Streams' storage on D1: every stream of an app in its one database (schema.ts). Ported
// from @durable-streams/server-cloudflare 0.1.1's src/store.ts (Apache-2.0, see NOTICE), which kept
// one stream per Durable Object; its storage semantics (offsets, JSON fragments, producers,
// closure, forks) are the same here.
//
// Reads go through a D1 session (Void's createDb with a session), so they're served by the nearest
// read replica that has caught up to the session's bookmark. A write is one D1 batch (a Commit):
// atomic, on the primary, and applied only if the stream is still as the writer read it. Its first
// statement changes the stream's `version` from the one read to one of the writer's own; every
// statement after it applies only where the version is the writer's. A writer that finds the
// stream changed meanwhile reads it again and tries again (server.ts). So no lock is held
// anywhere, and any Worker can write any stream.
import type { createDb } from "void/db";
import { FRAME_OVERHEAD, ZERO_OFFSET } from "./constants.ts";
import type { ProducerState } from "./producer.ts";

/**
 * A D1 client within a session (Void's createDb, typed with the app's schema in an app): Void
 * reads its bookmark (getBookmark).
 */
export type Db = ReturnType<typeof createDb>;

/** A statement and its parameters, made by `q`; one can be put inside another. */
class Query {
  constructor(
    readonly text: string,
    readonly params: unknown[],
  ) {}
}

/** SQL with its values as parameters (and Query values put in as they are). */
function q(strings: TemplateStringsArray, ...values: unknown[]): Query {
  let text = strings[0] ?? "";
  const params: unknown[] = [];
  values.forEach((value, i) => {
    if (value instanceof Query) {
      text += value.text;
      params.push(...value.params);
    } else {
      text += "?";
      params.push(value === undefined ? null : value);
    }
    text += strings[i + 1] ?? "";
  });
  return new Query(text, params);
}

/**
 * The D1 session under Void's client, for statements Drizzle's batch can't take (raw SQL with
 * parameters). The same session: what's run on it moves the client's bookmark on.
 */
const sessionOf = (db: Db) => (db as unknown as { $client: D1DatabaseSession }).$client;

const statement = (db: Db, query: Query) =>
  sessionOf(db)
    .prepare(query.text)
    .bind(...query.params);

async function all<T>(db: Db, query: Query): Promise<T[]> {
  return (await statement(db, query).all<T>()).results;
}

async function run(db: Db, query: Query): Promise<void> {
  await statement(db, query).run();
}

/** How long an idle producer's state is kept (7 days), as the reference server. */
const PRODUCER_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many messages are looked at for one read; more is a partial read. */
const MAX_READ_ROWS = 1000;

export interface ClosedBy {
  producerId: string;
  epoch: number;
  seq: number;
}

export interface StreamMeta {
  path: string;
  /** Minted at creation: distinguishes delete-and-recreate generations. */
  generation: string;
  /** Changes with every write (Commit). */
  version: string;
  contentType: string | undefined;
  ttlSeconds: number | undefined;
  expiresAt: string | undefined;
  closed: boolean;
  closedBy: ClosedBy | undefined;
  currentOffset: string;
  lastSeq: string | undefined;
  createdAt: number;
  lastAccessedAt: number;
  forkedFrom: string | undefined;
  forkOffset: string | undefined;
  forkSubOffset: number | undefined;
  forkSourceGen: string | undefined;
  softDeleted: boolean;
}

export interface StoredMessage {
  data: Uint8Array;
  /** The offset AFTER this message. */
  offset: string;
}

export interface ReadBatch {
  messages: StoredMessage[];
  /** The read stopped early (count or byte budget): more may remain. */
  capped: boolean;
}

type StreamRow = {
  path: string;
  gen: string;
  version: string;
  content_type: string | null;
  ttl_seconds: number | null;
  expires_at: string | null;
  closed: number;
  closed_by: string | null;
  current_offset: string;
  last_seq: string | null;
  created_at: number;
  last_accessed_at: number;
  forked_from: string | null;
  fork_offset: string | null;
  fork_sub_offset: number | null;
  fork_source_gen: string | null;
  soft_deleted: number;
};

const text = new TextEncoder();

/** A BLOB as D1 gives it back (an ArrayBuffer, or an array of byte values), as bytes. */
function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === "string") return text.encode(value);
  return new Uint8Array(0);
}

function parseClosedBy(json: string | null): ClosedBy | undefined {
  if (json === null) return undefined;
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object") return undefined;
  const { producerId, epoch, seq } = parsed as Partial<Record<keyof ClosedBy, unknown>>;
  return typeof producerId === "string" && typeof epoch === "number" && typeof seq === "number"
    ? { producerId, epoch, seq }
    : undefined;
}

/** The offset after appending `payloadLength` bytes at `currentOffset`. */
export function advanceOffset(currentOffset: string, payloadLength: number): string {
  const [readSeq = "0", byteOffset = "0"] = currentOffset.split("_");
  const next = Number(byteOffset) + FRAME_OVERHEAD + payloadLength;
  return `${readSeq.padStart(16, "0")}_${String(next).padStart(16, "0")}`;
}

/**
 * Whether a stream has expired (sliding TTL from its last access, or its expires-at). An invalid
 * expires-at reads as expired.
 */
export function isExpired(meta: StreamMeta, now: number): boolean {
  if (meta.expiresAt !== undefined) {
    const at = new Date(meta.expiresAt).getTime();
    if (!Number.isFinite(at) || now >= at) return true;
  }
  return meta.ttlSeconds !== undefined && now >= meta.lastAccessedAt + meta.ttlSeconds * 1000;
}

/** A stream as stored, whatever its state (expired, soft-deleted); undefined if there's none. */
export async function readMeta(db: Db, path: string): Promise<StreamMeta | undefined> {
  const [row] = await all<StreamRow>(db, q`SELECT * FROM ds_streams WHERE path = ${path}`);
  if (!row) return undefined;
  return {
    path: row.path,
    generation: row.gen,
    version: row.version,
    contentType: row.content_type ?? undefined,
    ttlSeconds: row.ttl_seconds ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    closed: row.closed !== 0,
    closedBy: parseClosedBy(row.closed_by),
    currentOffset: row.current_offset,
    lastSeq: row.last_seq ?? undefined,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    forkedFrom: row.forked_from ?? undefined,
    forkOffset: row.fork_offset ?? undefined,
    forkSubOffset: row.fork_sub_offset ?? undefined,
    forkSourceGen: row.fork_source_gen ?? undefined,
    softDeleted: row.soft_deleted !== 0,
  };
}

/** How many forks hold this stream. */
export async function forkEdgeCount(db: Db, path: string): Promise<number> {
  const [row] = await all<{ n: number }>(
    db,
    q`SELECT COUNT(*) AS n FROM ds_fork_edges WHERE source_path = ${path}`,
  );
  return row?.n ?? 0;
}

/** A producer's state, unless it has been idle past the time it's kept. */
export async function readProducer(
  db: Db,
  path: string,
  producerId: string,
  now: number,
): Promise<ProducerState | undefined> {
  const [row] = await all<{ epoch: number; last_seq: number; last_updated: number }>(
    db,
    q`SELECT epoch, last_seq, last_updated FROM ds_producers
        WHERE path = ${path} AND producer_id = ${producerId}`,
  );
  if (!row || row.last_updated < now - PRODUCER_STATE_TTL_MS) return undefined;
  return { epoch: row.epoch, lastSeq: row.last_seq, lastUpdated: row.last_updated };
}

/**
 * A stream's own messages with `offset > after` (all, for undefined or "-1") and, when `cap` is
 * given, `offset <= cap`, oldest first. Stops at `limit` messages, or before a message would take
 * the read past `byteBudget`: `capped` then. A first message larger than the whole budget is still
 * given (a reader must always get somewhere), unless `allowOversizedFirst` is false.
 */
export async function readRange(
  db: Db,
  path: string,
  after: string | undefined,
  cap: string | undefined,
  limit: number | undefined,
  byteBudget: number | undefined,
  allowOversizedFirst = true,
): Promise<ReadBatch> {
  const from = after === undefined || after === "-1" ? "" : after;
  const upTo = cap === undefined ? q`` : q` AND offset <= ${cap}`;
  const rows = Math.min(limit ?? MAX_READ_ROWS, MAX_READ_ROWS);
  // Their sizes first, so a read never fetches more than its budget.
  const sizes = await all<{ offset: string; size: number }>(
    db,
    q`SELECT offset, length(data) AS size FROM ds_messages
        WHERE path = ${path} AND offset > ${from}${upTo}
        ORDER BY offset LIMIT ${rows + 1}`,
  );
  let take = 0;
  let bytes = 0;
  let capped = false;
  for (const { size } of sizes) {
    if (take >= rows) {
      capped = true;
      break;
    }
    if (
      byteBudget !== undefined &&
      (take > 0 || !allowOversizedFirst) &&
      bytes + size > byteBudget
    ) {
      capped = true;
      break;
    }
    take += 1;
    bytes += size;
  }
  const last = sizes[take - 1];
  if (!last) return { messages: [], capped };
  const found = await all<{ offset: string; data: unknown }>(
    db,
    q`SELECT offset, data FROM ds_messages
        WHERE path = ${path} AND offset > ${from} AND offset <= ${last.offset}
        ORDER BY offset`,
  );
  return { messages: found.map((m) => ({ offset: m.offset, data: bytesOf(m.data) })), capped };
}

/**
 * A read keeping a stream with a TTL alive: its last access moved on. Not a change of the stream,
 * so it doesn't take its version (a writer meanwhile isn't overtaken by it).
 */
export async function touch(db: Db, path: string, generation: string, now: number): Promise<void> {
  await run(
    db,
    q`UPDATE ds_streams SET last_accessed_at = MAX(last_accessed_at, ${now})
        WHERE path = ${path} AND gen = ${generation}`,
  );
}

/** The streams that can expire (a TTL or an expiry time), as stored. */
export async function expiring(db: Db): Promise<StreamMeta[]> {
  const rows = await all<{ path: string }>(
    db,
    q`SELECT path FROM ds_streams WHERE expires_at IS NOT NULL OR ttl_seconds IS NOT NULL`,
  );
  const metas: StreamMeta[] = [];
  for (const { path } of rows) {
    const meta = await readMeta(db, path);
    if (meta) metas.push(meta);
  }
  return metas;
}

/** A new stream's settings. */
export interface NewStream {
  contentType: string | undefined;
  ttlSeconds: number | undefined;
  expiresAt: string | undefined;
  closed: boolean;
  now: number;
  forkedFrom?: string | undefined;
  forkOffset?: string | undefined;
  forkSubOffset?: number | undefined;
  forkSourceGen?: string | undefined;
}

/**
 * One write to one stream, applied whole or not at all (a D1 batch), and only if the stream is
 * still as the writer read it (`expected`: the version read), or, making it, still isn't there.
 */
export class Commit {
  /** This write's own version: what the stream's version becomes. */
  private readonly token = crypto.randomUUID();
  private readonly statements: Query[] = [];
  /** True from the first statement on, if it applied. */
  private readonly mine: Query;
  /** Where a new fork's hold on its source is, among the statements: it has to apply too. */
  private hold: number | undefined;
  /** The made stream's generation (when this write makes one). */
  readonly generation: string | undefined;

  constructor(
    private readonly db: Db,
    private readonly path: string,
    expected: { version: string } | { create: NewStream },
  ) {
    this.mine = q`EXISTS (SELECT 1 FROM ds_streams WHERE path = ${path} AND version = ${this.token})`;
    if ("version" in expected) {
      this.generation = undefined;
      this.statements.push(
        q`UPDATE ds_streams SET version = ${this.token}
            WHERE path = ${path} AND version = ${expected.version}`,
      );
      return;
    }
    const s = expected.create;
    const forked = s.forkedFrom !== undefined && s.forkOffset !== undefined;
    this.generation = crypto.randomUUID();
    this.statements.push(
      q`INSERT INTO ds_streams (path, gen, version, content_type, ttl_seconds, expires_at,
            closed, closed_by, current_offset, last_seq, created_at, last_accessed_at,
            forked_from, fork_offset, fork_sub_offset, fork_source_gen, soft_deleted)
          VALUES (${path}, ${this.generation}, ${this.token}, ${s.contentType ?? null},
            ${s.ttlSeconds ?? null}, ${s.expiresAt ?? null}, ${s.closed ? 1 : 0}, NULL,
            ${forked ? (s.forkOffset ?? ZERO_OFFSET) : ZERO_OFFSET}, NULL, ${s.now}, ${s.now},
            ${s.forkedFrom ?? null}, ${s.forkOffset ?? null}, ${s.forkSubOffset ?? null},
            ${s.forkSourceGen ?? null}, 0)
          ON CONFLICT (path) DO NOTHING`,
    );
  }

  /** One message added at the end (the stream ending at `currentOffset`): the offset after it. */
  append(currentOffset: string, payload: Uint8Array, now: number): string {
    const offset = advanceOffset(currentOffset, payload.length);
    this.statements.push(
      q`INSERT INTO ds_messages (path, offset, data, ts)
          SELECT ${this.path}, ${offset}, ${payload}, ${now} WHERE ${this.mine}`,
      q`UPDATE ds_streams SET current_offset = ${offset} WHERE path = ${this.path} AND ${this.mine}`,
    );
    return offset;
  }

  setLastSeq(seq: string): void {
    this.statements.push(
      q`UPDATE ds_streams SET last_seq = ${seq} WHERE path = ${this.path} AND ${this.mine}`,
    );
  }

  setClosed(closedBy: ClosedBy | undefined): void {
    const by = closedBy === undefined ? null : JSON.stringify(closedBy);
    this.statements.push(
      q`UPDATE ds_streams SET closed = 1, closed_by = COALESCE(${by}, closed_by)
          WHERE path = ${this.path} AND ${this.mine}`,
    );
  }

  touch(now: number): void {
    this.statements.push(
      q`UPDATE ds_streams SET last_accessed_at = ${now} WHERE path = ${this.path} AND ${this.mine}`,
    );
  }

  setSoftDeleted(): void {
    this.statements.push(
      q`UPDATE ds_streams SET soft_deleted = 1 WHERE path = ${this.path} AND ${this.mine}`,
    );
  }

  /** A producer's new state, and every producer idle past the time it's kept dropped. */
  setProducer(producerId: string, state: ProducerState): void {
    this.statements.push(
      q`DELETE FROM ds_producers WHERE path = ${this.path}
          AND last_updated < ${state.lastUpdated - PRODUCER_STATE_TTL_MS} AND ${this.mine}`,
      q`INSERT INTO ds_producers (path, producer_id, epoch, last_seq, last_updated)
          SELECT ${this.path}, ${producerId}, ${state.epoch}, ${state.lastSeq}, ${state.lastUpdated}
          WHERE ${this.mine}
          ON CONFLICT (path, producer_id) DO UPDATE SET
            epoch = excluded.epoch, last_seq = excluded.last_seq,
            last_updated = excluded.last_updated`,
    );
  }

  /**
   * This stream (a new fork) holds its source, if the source is still that generation and not
   * deleted. `applied` then reports false when it isn't: nothing is made.
   */
  holdSource(source: { path: string; generation: string }, forkOffset: string): void {
    if (this.generation === undefined) throw new Error("only a new fork holds its source");
    const alive = q`EXISTS (SELECT 1 FROM ds_streams WHERE path = ${source.path}
      AND gen = ${source.generation} AND soft_deleted = 0)`;
    this.hold = this.statements.length;
    this.statements.push(
      q`INSERT INTO ds_fork_edges (source_path, edge_id, fork_offset)
          SELECT ${source.path}, ${this.generation}, ${forkOffset} WHERE ${this.mine} AND ${alive}`,
      // Without the hold, the fork isn't made either.
      q`DELETE FROM ds_streams WHERE path = ${this.path} AND ${this.mine} AND NOT EXISTS (
            SELECT 1 FROM ds_fork_edges WHERE source_path = ${source.path}
            AND edge_id = ${this.generation})`,
    );
  }

  /** This stream (a fork) lets go of its source. */
  releaseSource(sourcePath: string, generation: string): void {
    this.statements.push(
      q`DELETE FROM ds_fork_edges WHERE source_path = ${sourcePath} AND edge_id = ${generation}
          AND ${this.mine}`,
    );
  }

  /** Everything of the stream removed: it then reads as never made. Last, as it ends the batch. */
  purge(): void {
    const p = this.path;
    this.statements.push(
      q`DELETE FROM ds_messages WHERE path = ${p} AND ${this.mine}`,
      q`DELETE FROM ds_producers WHERE path = ${p} AND ${this.mine}`,
      q`DELETE FROM ds_fork_edges WHERE source_path = ${p} AND ${this.mine}`,
      q`DELETE FROM ds_streams WHERE path = ${p} AND version = ${this.token}`,
    );
  }

  /**
   * Run it. Whether it applied: false if the stream had changed since it was read (or, making it,
   * was there already; or, making a fork, its source had gone).
   */
  async apply(): Promise<boolean> {
    if (this.statements.length === 0) return false;
    const results = await sessionOf(this.db).batch(
      this.statements.map((query) => statement(this.db, query)),
    );
    const applied = (index: number) => results[index]?.meta?.changes === 1;
    // A new fork is made only with its hold on the source (holdSource took it out otherwise).
    return applied(0) && (this.hold === undefined || applied(this.hold));
  }
}
