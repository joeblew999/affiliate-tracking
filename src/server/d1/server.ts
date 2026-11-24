// Durable Streams on D1: the protocol (PUT, HEAD, GET caught up or live by long-poll and SSE, POST
// with idempotent producers and closing, DELETE, forks, expiry) over the tables in schema.ts. Any
// Worker of the app, anywhere, serves any stream: reads come from the nearest D1 read replica, and
// writes go to the primary (store.ts). Ported from @durable-streams/server-cloudflare 0.1.1's
// src/stream-object.ts (Apache-2.0, see NOTICE), which held each stream in a Durable Object of its
// own; the protocol's behaviour is the same, and the same conformance suite checks it
// (test/conformance.test.ts, against the hub).
//
// Consistency across requests is D1's bookmarks, as Void carries them (guide/database/d1.md,
// "API requests with concurrent clients"): a request may send the newest bookmark it has seen in
// X-DB-Bookmark, and is answered with the newest after its own queries, so a client never reads
// older than what it has already seen or written. A read for an offset its replica hasn't reached
// yet is read again from the primary. A live reader waits on the stream's notifier
// (notifier.ts), which hands it the bookmark of the write that woke it.
import { createDb, getBookmark } from "void/db";
import {
  CURSOR_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  PRODUCER_EPOCH_HEADER,
  PRODUCER_EXPECTED_SEQ_HEADER,
  PRODUCER_ID_HEADER,
  PRODUCER_RECEIVED_SEQ_HEADER,
  PRODUCER_SEQ_HEADER,
  SSE_CLOSED_FIELD,
  SSE_CURSOR_FIELD,
  SSE_OFFSET_FIELD,
  SSE_UP_TO_DATE_FIELD,
  STREAM_CLOSED_HEADER,
  STREAM_CURSOR_HEADER,
  STREAM_EXPIRES_AT_HEADER,
  STREAM_OFFSET_HEADER,
  STREAM_SEQ_HEADER,
  STREAM_SSE_DATA_ENCODING_HEADER,
  STREAM_TTL_HEADER,
  STREAM_UP_TO_DATE_HEADER,
  ZERO_OFFSET,
} from "./constants.ts";
import { generateResponseCursor } from "./cursor.ts";
import {
  concatBytes,
  formatJsonMessages,
  JsonAppendError,
  normalizeContentType,
  processJsonAppend,
} from "./json.ts";
import type { Moved } from "./notifier.ts";
import { validateProducer, type ProducerValidationResult } from "./producer.ts";
import {
  Commit,
  expiring,
  forkEdgeCount,
  isExpired,
  readMeta,
  readProducer,
  readRange,
  touch,
  type ClosedBy,
  type Db,
  type ReadBatch,
  type StoredMessage,
  type StreamMeta,
} from "./store.ts";

/** A request's newest D1 bookmark, sent and answered (Void's header for it). */
export const BOOKMARK_HEADER = "x-db-bookmark";
/** "first-primary": this request reads the primary, not a replica. */
export const SESSION_HEADER = "x-db-session";

/** How long a long-poll, or an SSE connection between keep-alives, waits for something new. */
const LONG_POLL_TIMEOUT_MS = 2000;
/** The largest request body taken: D1 holds a value of up to 2 MB. */
const MAX_BODY_BYTES = 1_900_000;
const VALID_OFFSET_PATTERN = /^(-1|now|\d+_\d+)$/;
const TTL_PATTERN = /^(0|[1-9]\d*)$/;
/** Stream-TTL's upper bound (100 years), past which times lose precision. */
const MAX_TTL_SECONDS = 3_153_600_000;
/** Per-response read budget: a longer stream is given in parts (Stream-Up-To-Date left off). */
const MAX_READ_BATCH_BYTES = 4 * 1024 * 1024;
/** An SSE connection is ended after about a minute (the protocol's SHOULD); the client reconnects. */
const MAX_SSE_LIFETIME_MS = 60_000;
const STRICT_INTEGER_REGEX = /^\d+$/;
const CONTENT_TYPE_SHAPE = /^[\w-]+\/[\w-]+/;
const VALID_FORK_OFFSET_PATTERN = /^\d+_\d+$/;
const SUB_OFFSET_PATTERN = /^(0|[1-9]\d*)$/;
/** Beyond any real offset. */
const MAX_OFFSET_CAP = "9999999999999999_9999999999999999";
const STREAM_FORKED_FROM_HEADER = "Stream-Forked-From";
const STREAM_FORK_OFFSET_HEADER = "Stream-Fork-Offset";
const STREAM_FORK_SUB_OFFSET_HEADER = "Stream-Fork-Sub-Offset";
/** How many times a write is tried while others write the same stream at the same moment. */
const WRITE_ATTEMPTS = 25;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, If-None-Match, Stream-Seq, Stream-TTL, Stream-Expires-At, Stream-Closed, Producer-Id, Producer-Epoch, Producer-Seq, Stream-Forked-From, Stream-Fork-Offset, Stream-Fork-Sub-Offset, X-DB-Bookmark",
  "access-control-expose-headers":
    "Stream-Next-Offset, Stream-Cursor, Stream-Up-To-Date, Stream-Closed, Producer-Epoch, Producer-Seq, Producer-Expected-Seq, Producer-Received-Seq, etag, content-type, content-encoding, vary, X-DB-Bookmark",
};

/** A stream's notifier (notifier.ts), by its RPC methods. */
export type Notifier = {
  wait(generation: string, after: string, timeoutMs: number): Promise<Moved | null>;
  moved(moved: Moved): Promise<void>;
};

export type D1StreamsOptions<Env> = {
  /** The app's D1 binding. */
  database: (env: Env) => D1Database;
  /** A stream's notifier, by its path (a Durable Object per stream). */
  notifier: (env: Env, path: string) => Notifier;
  /** The protocol's permissive CORS headers on every answer (default true). */
  cors?: boolean;
};

interface WaitResult {
  messages: StoredMessage[];
  timedOut: boolean;
  streamClosed: boolean;
  capped: boolean;
}

interface ProducerHeaders {
  producerId: string;
  epoch: number;
  seq: number;
}

interface RequestedCreateConfig {
  contentType: string | undefined;
  ttlSeconds: number | undefined;
  expiresAt: string | undefined;
  createClosed: boolean;
  forkedFrom: string | undefined;
  forkOffsetHeader: string | undefined;
  forkSubOffset: number | undefined;
}

/** A write found the stream changed since it read it: read again and try again. */
const RETRY = Symbol("retry");

/** Each SSE data line its own `data:` field, so a payload can't make events of its own. */
function encodeSseData(payload: string): string {
  return (
    payload
      .split(/\r\n|\r|\n/)
      .map((line) => `data:${line}`)
      .join("\n") + "\n\n"
  );
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const base64FromString = (s: string) => base64FromBytes(new TextEncoder().encode(s));

/** A client going away mid-SSE (a tab closed), not a failure. */
const isClientDisconnect = (err: unknown) =>
  err instanceof Error &&
  /network connection lost|stream.*(closed|canceled|cancelled|aborted)/i.test(err.message);

/** The newer of two bookmarks (they sort as they were made). */
const newer = (a: string | null, b: string | null) =>
  a === null ? b : b === null || a >= b ? a : b;

/**
 * One request's D1 sessions. Reads start on the nearest replica, at least as new as the request's
 * bookmark; writes, and reads that must be the latest, go to the primary.
 */
class Sessions {
  private replica: Db | undefined;
  private primaryDb: Db | undefined;
  private readonly others: Db[] = [];
  private newest: string | null;

  constructor(
    private readonly binding: D1Database,
    bookmark: string | null,
    /** Read the primary from the start. */
    private onPrimary: boolean,
  ) {
    this.newest = bookmark;
  }

  /** For reads. */
  get read(): Db {
    if (this.onPrimary) return this.primary;
    return (this.replica ??= createDb(this.binding, {
      session: this.newest === null ? "first-unconstrained" : { bookmark: this.newest },
    }));
  }

  /** For writes, and reads that must see everything written. */
  get primary(): Db {
    return (this.primaryDb ??= createDb(this.binding, { session: "first-primary" }));
  }

  get isPrimary() {
    return this.onPrimary;
  }

  /** From now on, reads go to the primary. */
  toPrimary(): void {
    this.onPrimary = true;
  }

  /** From now on, reads see at least what this bookmark saw (a write's, handed on by a notice). */
  from(bookmark: string | null): void {
    if (bookmark === null || this.onPrimary) return;
    this.noteAll();
    if (this.newest !== null && bookmark <= this.newest) return;
    this.newest = bookmark;
    if (this.replica) this.others.push(this.replica);
    this.replica = undefined;
  }

  private noteAll() {
    for (const db of [this.replica, this.primaryDb, ...this.others])
      if (db) this.newest = newer(this.newest, getBookmark(db));
  }

  /** The newest bookmark of everything this request read or wrote. */
  bookmark(): string | null {
    this.noteAll();
    return this.newest;
  }
}

/** One request to one stream. */
class Context<Env> {
  constructor(
    readonly env: Env,
    readonly path: string,
    readonly db: Sessions,
    private readonly notifierOf: (env: Env, path: string) => Notifier,
  ) {}

  notifier(path = this.path): Notifier {
    return this.notifierOf(this.env, path);
  }

  /** Tell the stream's live readers where it has got to. Never fails the write it follows. */
  async moved(
    meta: Pick<StreamMeta, "generation" | "path">,
    moved: Omit<Moved, "generation" | "bookmark">,
  ) {
    try {
      await this.notifier(meta.path).moved({
        ...moved,
        generation: meta.generation,
        bookmark: getBookmark(this.db.primary),
      });
    } catch (error) {
      console.error("streams: couldn't tell the readers of", meta.path, error);
    }
  }
}

/** Standard headers on every answer (CORS when on, and the browser's safety ones). */
function respond(
  cors: boolean,
  status: number,
  headers: Record<string, string>,
  body?: BodyInit | null,
): Response {
  const h = new Headers(headers);
  if (cors) for (const [name, value] of Object.entries(CORS_HEADERS)) h.set(name, value);
  h.set("x-content-type-options", "nosniff");
  h.set("cross-origin-resource-policy", "cross-origin");
  return new Response(status === 204 || status === 304 ? null : (body ?? null), {
    status,
    headers: h,
  });
}

/** The protocol over D1: a request handler for every stream, at its URL's path. */
export function createD1Streams<Env>(options: D1StreamsOptions<Env>) {
  const corsOn = options.cors !== false;
  const reply = (status: number, headers: Record<string, string>, body?: BodyInit | null) =>
    respond(corsOn, status, headers, body);
  const text = (status: number, message: string, extra: Record<string, string> = {}) =>
    reply(status, { "content-type": "text/plain", ...extra }, message);

  // ==========================================================================
  // Reading state
  // ==========================================================================

  /**
   * A stream, expiry applied: an expired one is removed (or, while forks hold it, marked deleted)
   * and reads as absent.
   */
  async function getMeta(ctx: Context<Env>, db: Db, path: string, now: number) {
    const meta = await readMeta(db, path);
    if (!meta || !isExpired(meta, now)) return meta;
    const current = (await readMeta(ctx.db.primary, path)) ?? meta;
    if ((await forkEdgeCount(ctx.db.primary, path)) > 0) {
      if (!current.softDeleted) {
        const commit = new Commit(ctx.db.primary, path, { version: current.version });
        commit.setSoftDeleted();
        await commit.apply();
      }
      return { ...current, softDeleted: true };
    }
    await purge(ctx, current);
    return undefined;
  }

  /** Every message after `after` (and up to `cap`), through the forks it was made from. */
  async function readStitched(
    db: Db,
    meta: StreamMeta,
    afterOffset: string | undefined,
    capOffset: string | undefined,
    limit: number | undefined,
    byteBudget: number = MAX_READ_BATCH_BYTES,
  ): Promise<ReadBatch> {
    const after = afterOffset === undefined || afterOffset === "-1" ? undefined : afterOffset;
    const out: StoredMessage[] = [];
    // One budget for the whole answer, inherited parts included.
    let remainingBytes = byteBudget;
    if (
      meta.forkedFrom !== undefined &&
      meta.forkOffset !== undefined &&
      (after === undefined || after < meta.forkOffset)
    ) {
      const cap =
        capOffset === undefined || meta.forkOffset < capOffset ? meta.forkOffset : capOffset;
      // Raw: a fork reads through a source that's soft-deleted or expired.
      const source = await readMeta(db, meta.forkedFrom);
      const inherited =
        source && source.generation === meta.forkSourceGen
          ? await readStitched(db, source, after, cap, limit, remainingBytes)
          : { messages: [], capped: false };
      out.push(...inherited.messages);
      for (const message of inherited.messages) remainingBytes -= message.data.byteLength;
      if (inherited.capped) return { messages: out, capped: true };
      if (limit !== undefined && out.length >= limit)
        return { messages: out.slice(0, limit), capped: true };
      if (remainingBytes <= 0 && out.length > 0) return { messages: out, capped: true };
    }
    const own = await readRange(
      db,
      meta.path,
      after,
      capOffset,
      limit === undefined ? undefined : limit - out.length,
      remainingBytes,
      out.length === 0,
    );
    out.push(...own.messages);
    return { messages: out, capped: own.capped };
  }

  /** A read keeps a stream with a TTL alive (not too often: it's a write, on the primary). */
  async function touchAccess(ctx: Context<Env>, meta: StreamMeta, now: number) {
    if (meta.ttlSeconds === undefined) return;
    if (now - meta.lastAccessedAt < Math.min(meta.ttlSeconds * 250, 60_000)) return;
    await touch(ctx.db.primary, meta.path, meta.generation, now);
  }

  // ==========================================================================
  // Removing
  // ==========================================================================

  /**
   * Remove a stream and everything of it, letting go of its source if it's a fork; then remove
   * any source that was only kept for forks and has none left.
   */
  async function purge(ctx: Context<Env>, meta: StreamMeta): Promise<boolean> {
    const commit = new Commit(ctx.db.primary, meta.path, { version: meta.version });
    if (meta.forkedFrom !== undefined) commit.releaseSource(meta.forkedFrom, meta.generation);
    commit.purge();
    if (!(await commit.apply())) return false;
    await ctx.moved(meta, { offset: meta.currentOffset, closed: false, gone: true });
    let source = meta.forkedFrom;
    while (source !== undefined) {
      const held = await readMeta(ctx.db.primary, source);
      if (!held?.softDeleted || (await forkEdgeCount(ctx.db.primary, source)) > 0) return true;
      const gone = new Commit(ctx.db.primary, source, { version: held.version });
      if (held.forkedFrom !== undefined) gone.releaseSource(held.forkedFrom, held.generation);
      gone.purge();
      if (!(await gone.apply())) return true;
      await ctx.moved(held, { offset: held.currentOffset, closed: false, gone: true });
      source = held.forkedFrom;
    }
    return true;
  }

  /** Tried until it isn't overtaken by another write to the same stream. */
  async function writing(attempt: () => Promise<Response | typeof RETRY>): Promise<Response> {
    for (let i = 0; i < WRITE_ATTEMPTS; i++) {
      const done = await attempt();
      if (done !== RETRY) return done;
    }
    return text(503, "Stream busy: too many writes at once, try again");
  }

  // ==========================================================================
  // PUT: make a stream (idempotent)
  // ==========================================================================

  async function handlePut(ctx: Context<Env>, request: Request, url: URL): Promise<Response> {
    // The body first: answering while the client is still sending it breaks the connection.
    const body = await readBody(request);
    if (body === "too_large") return text(413, "Payload too large");

    let contentType = request.headers.get("content-type") ?? undefined;
    const forkedFrom = request.headers.get(STREAM_FORKED_FROM_HEADER) ?? undefined;
    const forkOffsetHeader = request.headers.get(STREAM_FORK_OFFSET_HEADER) ?? undefined;
    const forkSubOffsetHeader = request.headers.get(STREAM_FORK_SUB_OFFSET_HEADER) ?? undefined;

    // An empty or invalid content type is the default, except a fork's, which inherits.
    if (
      contentType === undefined ||
      contentType.trim() === "" ||
      !CONTENT_TYPE_SHAPE.test(contentType)
    )
      contentType = forkedFrom !== undefined ? undefined : "application/octet-stream";

    const ttlHeader = request.headers.get(STREAM_TTL_HEADER) ?? undefined;
    const expiresAtHeader = request.headers.get(STREAM_EXPIRES_AT_HEADER) ?? undefined;
    const createClosed = (request.headers.get(STREAM_CLOSED_HEADER) ?? "").toLowerCase() === "true";

    if (ttlHeader !== undefined && expiresAtHeader !== undefined)
      return text(400, "Cannot specify both Stream-TTL and Stream-Expires-At");
    let ttlSeconds: number | undefined;
    if (ttlHeader !== undefined) {
      if (!TTL_PATTERN.test(ttlHeader)) return text(400, "Invalid Stream-TTL value");
      ttlSeconds = parseInt(ttlHeader, 10);
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds > MAX_TTL_SECONDS)
        return text(400, "Invalid Stream-TTL value");
    }
    if (expiresAtHeader !== undefined && Number.isNaN(new Date(expiresAtHeader).getTime()))
      return text(400, "Invalid Stream-Expires-At timestamp");
    if (forkOffsetHeader !== undefined && !VALID_FORK_OFFSET_PATTERN.test(forkOffsetHeader))
      return text(400, "Invalid Stream-Fork-Offset format");
    let forkSubOffset: number | undefined;
    if (forkSubOffsetHeader !== undefined) {
      if (forkedFrom === undefined)
        return text(400, "Stream-Fork-Sub-Offset requires Stream-Forked-From");
      if (!SUB_OFFSET_PATTERN.test(forkSubOffsetHeader))
        return text(400, "Invalid Stream-Fork-Sub-Offset format");
      forkSubOffset = parseInt(forkSubOffsetHeader, 10);
    }

    const requested: RequestedCreateConfig = {
      contentType,
      ttlSeconds,
      expiresAt: expiresAtHeader,
      createClosed,
      forkedFrom,
      forkOffsetHeader,
      forkSubOffset,
    };

    // The initial data, checked before anything is made, so a bad body leaves no stream.
    const resolvedContentType = contentType ?? "application/octet-stream";
    let initialPayload: Uint8Array | undefined;
    if (forkedFrom === undefined && body.length > 0) {
      if (normalizeContentType(resolvedContentType) === "application/json") {
        try {
          initialPayload = processJsonAppend(body, true);
        } catch (err) {
          if (err instanceof JsonAppendError) return text(400, err.message);
          throw err;
        }
        if (initialPayload.length > MAX_BODY_BYTES) return text(413, "Payload too large");
      } else initialPayload = body;
    }

    return writing(async () => {
      const now = Date.now();
      const existing = await getMeta(ctx, ctx.db.primary, ctx.path, now);
      if (existing) return existingStreamResponse(existing, requested);
      if (forkedFrom !== undefined)
        return createFork(ctx, url, {
          forkedFrom,
          forkOffsetHeader,
          forkSubOffset,
          contentType,
          ttlSeconds,
          expiresAt: expiresAtHeader,
          createClosed,
          body,
          now,
        });
      const commit = new Commit(ctx.db.primary, ctx.path, {
        create: {
          contentType: resolvedContentType,
          ttlSeconds,
          expiresAt: expiresAtHeader,
          closed: createClosed,
          now,
        },
      });
      let currentOffset = ZERO_OFFSET;
      if (initialPayload !== undefined && initialPayload.length > 0)
        currentOffset = commit.append(currentOffset, initialPayload, now);
      // Made by someone else meanwhile: answered as theirs, next time round.
      if (!(await commit.apply())) return RETRY;
      await ctx.moved(
        { path: ctx.path, generation: commit.generation ?? "" },
        { offset: currentOffset, closed: createClosed, gone: false },
      );
      const headers: Record<string, string> = {
        "content-type": resolvedContentType,
        [STREAM_OFFSET_HEADER]: currentOffset,
        location: `${url.origin}${ctx.path}`,
      };
      if (createClosed) headers[STREAM_CLOSED_HEADER] = "true";
      return reply(201, headers);
    });
  }

  /** A PUT for a stream that's there: 200 if it asks for the same, 409 otherwise. */
  function existingStreamResponse(existing: StreamMeta, req: RequestedCreateConfig): Response {
    if (existing.softDeleted)
      return text(
        409,
        "stream was deleted but still has active forks — path cannot be reused until all forks are removed",
      );
    // A fork's PUT again without a content type means "inherit": it matches what it inherited.
    const contentTypeMatches =
      req.contentType === undefined &&
      req.forkedFrom !== undefined &&
      req.forkedFrom === existing.forkedFrom
        ? true
        : (normalizeContentType(req.contentType) || "application/octet-stream") ===
          (normalizeContentType(existing.contentType) || "application/octet-stream");
    const matches =
      contentTypeMatches &&
      req.ttlSeconds === existing.ttlSeconds &&
      req.expiresAt === existing.expiresAt &&
      req.createClosed === existing.closed &&
      req.forkedFrom === existing.forkedFrom &&
      // Compared only when given: one left out was worked out when the fork was made.
      (req.forkOffsetHeader === undefined || req.forkOffsetHeader === existing.forkOffset) &&
      (req.forkSubOffset ?? 0) === (existing.forkSubOffset ?? 0);
    if (!matches) return text(409, "Stream already exists with different configuration");
    const headers: Record<string, string> = {
      "content-type": existing.contentType ?? req.contentType ?? "application/octet-stream",
      [STREAM_OFFSET_HEADER]: existing.currentOffset,
    };
    if (existing.closed) headers[STREAM_CLOSED_HEADER] = "true";
    return reply(200, headers);
  }

  /** Make this stream a fork of another: one batch, with its hold on the source. */
  async function createFork(
    ctx: Context<Env>,
    url: URL,
    options: {
      forkedFrom: string;
      forkOffsetHeader: string | undefined;
      forkSubOffset: number | undefined;
      contentType: string | undefined;
      ttlSeconds: number | undefined;
      expiresAt: string | undefined;
      createClosed: boolean;
      body: Uint8Array;
      now: number;
    },
  ): Promise<Response | typeof RETRY> {
    const { forkedFrom, now } = options;
    // A stream can't fork itself (the reference server calls that source-not-found).
    if (forkedFrom === ctx.path) return text(404, "Source stream not found");
    const db = ctx.db.primary;
    const source = await getMeta(ctx, db, forkedFrom, now);
    if (!source) return text(404, "Source stream not found");
    if (source.softDeleted)
      return text(409, "source stream was deleted but still has active forks");
    if (
      options.contentType !== undefined &&
      options.contentType.trim() !== "" &&
      normalizeContentType(options.contentType) !== normalizeContentType(source.contentType)
    )
      return text(409, "Content type mismatch with source stream");
    const forkOffset = options.forkOffsetHeader ?? source.currentOffset;
    if (forkOffset < ZERO_OFFSET || source.currentOffset < forkOffset)
      return text(400, "Fork offset beyond source stream length");

    const resolvedContentType =
      options.contentType !== undefined && options.contentType.trim() !== ""
        ? options.contentType
        : source.contentType;
    const isJson = normalizeContentType(resolvedContentType) === "application/json";

    // An explicit TTL or expiry wins; otherwise the source's (its TTL first).
    let ttl = options.ttlSeconds;
    let expiresAt = options.expiresAt;
    if (ttl === undefined && expiresAt === undefined) {
      if (source.ttlSeconds !== undefined) ttl = source.ttlSeconds;
      else if (source.expiresAt !== undefined) expiresAt = source.expiresAt;
    }

    // A sub-offset: the fork's first message is the leading part of the source's message there.
    let prefix: Uint8Array | undefined;
    if (options.forkSubOffset !== undefined && options.forkSubOffset > 0) {
      const past = await readStitched(db, source, forkOffset, MAX_OFFSET_CAP, 1);
      const first = past.messages[0];
      if (!first) return text(400, "Invalid fork sub-offset");
      if (isJson) {
        const decoded = new TextDecoder().decode(first.data);
        const trimmed = decoded.endsWith(",") ? decoded.slice(0, -1) : decoded;
        let values: unknown[];
        try {
          const parsed: unknown = JSON.parse(`[${trimmed}]`);
          if (!Array.isArray(parsed)) throw new JsonAppendError("Invalid fork sub-offset");
          values = parsed;
        } catch {
          return text(400, "Invalid fork sub-offset");
        }
        if (options.forkSubOffset > values.length) return text(400, "Invalid fork sub-offset");
        const kept = values.slice(0, options.forkSubOffset).map((v) => JSON.stringify(v));
        prefix = new TextEncoder().encode(kept.join(",") + ",");
      } else {
        if (options.forkSubOffset > first.data.length) return text(400, "Invalid fork sub-offset");
        prefix = first.data.slice(0, options.forkSubOffset);
      }
    }

    let initialPayload: Uint8Array | undefined;
    if (options.body.length > 0) {
      if (isJson) {
        try {
          initialPayload = processJsonAppend(options.body, true);
        } catch (err) {
          if (err instanceof JsonAppendError) return text(400, err.message);
          throw err;
        }
        if (initialPayload.length > MAX_BODY_BYTES) return text(413, "Payload too large");
      } else initialPayload = options.body;
    }

    const commit = new Commit(db, ctx.path, {
      create: {
        contentType: resolvedContentType,
        ttlSeconds: ttl,
        expiresAt,
        closed: options.createClosed,
        now,
        forkedFrom,
        forkOffset,
        forkSubOffset:
          options.forkSubOffset !== undefined && options.forkSubOffset > 0
            ? options.forkSubOffset
            : undefined,
        forkSourceGen: source.generation,
      },
    });
    commit.holdSource({ path: forkedFrom, generation: source.generation }, forkOffset);
    let currentOffset = forkOffset;
    if (prefix !== undefined && prefix.length > 0)
      currentOffset = commit.append(currentOffset, prefix, now);
    if (initialPayload !== undefined && initialPayload.length > 0)
      currentOffset = commit.append(currentOffset, initialPayload, now);
    // Made by someone else meanwhile, or the source went: worked out again next time round.
    if (!(await commit.apply())) return RETRY;
    await ctx.moved(
      { path: ctx.path, generation: commit.generation ?? "" },
      { offset: currentOffset, closed: options.createClosed, gone: false },
    );
    const headers: Record<string, string> = {
      "content-type": resolvedContentType ?? "application/octet-stream",
      [STREAM_OFFSET_HEADER]: currentOffset,
      location: `${url.origin}${ctx.path}`,
    };
    if (options.createClosed) headers[STREAM_CLOSED_HEADER] = "true";
    return reply(201, headers);
  }

  // ==========================================================================
  // HEAD: what the stream is; doesn't keep a TTL alive
  // ==========================================================================

  async function handleHead(ctx: Context<Env>): Promise<Response> {
    const meta = await getMeta(ctx, ctx.db.read, ctx.path, Date.now());
    if (!meta) return reply(404, { "content-type": "text/plain" });
    if (meta.softDeleted) return reply(410, { "content-type": "text/plain" });
    const headers: Record<string, string> = {
      [STREAM_OFFSET_HEADER]: meta.currentOffset,
      "cache-control": "no-store",
    };
    if (meta.contentType !== undefined) headers["content-type"] = meta.contentType;
    if (meta.closed) headers[STREAM_CLOSED_HEADER] = "true";
    if (meta.ttlSeconds !== undefined) headers[STREAM_TTL_HEADER] = String(meta.ttlSeconds);
    if (meta.expiresAt !== undefined) headers[STREAM_EXPIRES_AT_HEADER] = meta.expiresAt;
    headers.etag = makeEtag(ctx.path, "-1", meta.currentOffset, meta.closed);
    return reply(200, headers);
  }

  // ==========================================================================
  // GET: catch-up, long-poll, SSE
  // ==========================================================================

  async function handleGet(ctx: Context<Env>, request: Request, url: URL): Promise<Response> {
    const now = Date.now();
    const meta = await getMeta(ctx, ctx.db.read, ctx.path, now);
    if (!meta) return text(404, "Stream not found");
    if (meta.softDeleted) return text(410, "Stream is gone");

    const offsetParam = url.searchParams.get(OFFSET_QUERY_PARAM) ?? undefined;
    const live = url.searchParams.get(LIVE_QUERY_PARAM);
    const cursor = url.searchParams.get(CURSOR_QUERY_PARAM) ?? undefined;
    if (offsetParam !== undefined) {
      if (offsetParam === "") return text(400, "Empty offset parameter");
      if (url.searchParams.getAll(OFFSET_QUERY_PARAM).length > 1)
        return text(400, "Multiple offset parameters not allowed");
      if (!VALID_OFFSET_PATTERN.test(offsetParam)) return text(400, "Invalid offset format");
    }
    if ((live === "long-poll" || live === "sse") && offsetParam === undefined)
      return text(400, `${live === "sse" ? "SSE" : "Long-poll"} requires offset parameter`);

    // An offset this replica hasn't got to yet was given by a newer one, or the primary: read
    // there instead.
    if (
      offsetParam !== undefined &&
      VALID_FORK_OFFSET_PATTERN.test(offsetParam) &&
      offsetParam > meta.currentOffset &&
      !ctx.db.isPrimary
    ) {
      ctx.db.toPrimary();
      return handleGet(ctx, request, url);
    }

    if (live === "sse") {
      const ct = normalizeContentType(meta.contentType);
      const useBase64 = !(ct.startsWith("text/") || ct === "application/json");
      const from = offsetParam === "now" ? meta.currentOffset : (offsetParam ?? "-1");
      return handleSse(ctx, meta, from, cursor, useBase64);
    }

    // Caught up at the end: nothing to give, and nothing to cache.
    if (offsetParam === "now" && live !== "long-poll") {
      await touchAccess(ctx, meta, now);
      const headers: Record<string, string> = {
        [STREAM_OFFSET_HEADER]: meta.currentOffset,
        [STREAM_UP_TO_DATE_HEADER]: "true",
        "cache-control": "no-store",
      };
      if (meta.contentType !== undefined) headers["content-type"] = meta.contentType;
      if (meta.closed) headers[STREAM_CLOSED_HEADER] = "true";
      const isJson = normalizeContentType(meta.contentType) === "application/json";
      return reply(200, headers, isJson ? "[]" : "");
    }

    const effectiveOffset = offsetParam === "now" ? meta.currentOffset : offsetParam;
    const initial = await readStitched(ctx.db.read, meta, effectiveOffset, undefined, undefined);
    let messages = initial.messages;
    // A partial answer leaves Stream-Up-To-Date off.
    let upToDate = !initial.capped;
    await touchAccess(ctx, meta, now);

    let freshMeta = meta;
    const caughtUp =
      (effectiveOffset !== undefined && effectiveOffset === meta.currentOffset) ||
      offsetParam === "now";
    if (live === "long-poll" && caughtUp && messages.length === 0) {
      if (meta.closed)
        return reply(204, {
          [STREAM_OFFSET_HEADER]: meta.currentOffset,
          [STREAM_UP_TO_DATE_HEADER]: "true",
          [STREAM_CLOSED_HEADER]: "true",
        });
      const waitOffset = effectiveOffset ?? meta.currentOffset;
      const result = await waitForMessages(ctx, meta, waitOffset, LONG_POLL_TIMEOUT_MS);
      freshMeta = (await readMeta(ctx.db.read, ctx.path)) ?? meta;
      await touchAccess(ctx, freshMeta, Date.now());
      if (result.streamClosed && result.messages.length === 0)
        return reply(204, {
          [STREAM_OFFSET_HEADER]: waitOffset,
          [STREAM_UP_TO_DATE_HEADER]: "true",
          [STREAM_CURSOR_HEADER]: generateResponseCursor(cursor),
          [STREAM_CLOSED_HEADER]: "true",
        });
      if (result.timedOut) {
        const headers: Record<string, string> = {
          [STREAM_OFFSET_HEADER]: waitOffset,
          [STREAM_UP_TO_DATE_HEADER]: "true",
          [STREAM_CURSOR_HEADER]: generateResponseCursor(cursor),
        };
        if (freshMeta.closed) headers[STREAM_CLOSED_HEADER] = "true";
        return reply(204, headers);
      }
      messages = result.messages;
      upToDate = !result.capped;
    }

    const headers: Record<string, string> = {};
    if (freshMeta.contentType !== undefined) headers["content-type"] = freshMeta.contentType;
    const responseOffset = messages[messages.length - 1]?.offset ?? freshMeta.currentOffset;
    headers[STREAM_OFFSET_HEADER] = responseOffset;
    if (live === "long-poll") headers[STREAM_CURSOR_HEADER] = generateResponseCursor(cursor);
    if (upToDate) headers[STREAM_UP_TO_DATE_HEADER] = "true";
    const closedSuffix = freshMeta.closed && responseOffset === freshMeta.currentOffset && upToDate;
    if (closedSuffix) headers[STREAM_CLOSED_HEADER] = "true";
    const etag = makeEtag(ctx.path, offsetParam ?? "-1", responseOffset, closedSuffix);
    headers.etag = etag;
    if (request.headers.get("if-none-match") === etag) return reply(304, { etag });
    // Catch-up reads may be cached by shared caches (§10.1); live ones aren't.
    if (live !== "long-poll")
      headers["cache-control"] = "public, max-age=60, stale-while-revalidate=300";
    const fragments = messages.map((m) => m.data);
    const body =
      normalizeContentType(freshMeta.contentType) === "application/json"
        ? formatJsonMessages(fragments)
        : concatBytes(fragments);
    return reply(200, headers, body);
  }

  /**
   * Wait for messages after `offset`: on the stream's notifier, then read from a replica at least
   * as new as the write that woke it.
   */
  async function waitForMessages(
    ctx: Context<Env>,
    meta: StreamMeta,
    offset: string,
    timeoutMs: number,
  ): Promise<WaitResult> {
    const db = ctx.db.read;
    // A fork's inherited part is there already: no waiting (a source's writes don't wake forks).
    if (
      meta.forkedFrom !== undefined &&
      meta.forkOffset !== undefined &&
      offset !== "-1" &&
      offset < meta.forkOffset
    ) {
      const stitched = await readStitched(db, meta, offset, undefined, undefined);
      return {
        messages: stitched.messages,
        timedOut: false,
        streamClosed: false,
        capped: stitched.capped,
      };
    }
    if (meta.forkedFrom !== undefined && offset === "-1") {
      const stitched = await readStitched(db, meta, undefined, undefined, undefined);
      if (stitched.messages.length > 0)
        return {
          messages: stitched.messages,
          timedOut: false,
          streamClosed: false,
          capped: stitched.capped,
        };
    }
    const after = offset === "-1" ? undefined : offset;
    const initial = await readRange(
      db,
      ctx.path,
      after,
      undefined,
      undefined,
      MAX_READ_BATCH_BYTES,
    );
    if (initial.messages.length > 0)
      return {
        messages: initial.messages,
        timedOut: false,
        streamClosed: false,
        capped: initial.capped,
      };
    if (meta.closed && offset === meta.currentOffset)
      return { messages: [], timedOut: false, streamClosed: true, capped: false };

    const moved = await ctx
      .notifier()
      .wait(meta.generation, offset === "-1" ? "" : offset, timeoutMs);
    if (moved === null) return { messages: [], timedOut: true, streamClosed: false, capped: false };
    if (moved.gone || moved.generation !== meta.generation)
      return { messages: [], timedOut: false, streamClosed: false, capped: false };
    ctx.db.from(moved.bookmark);
    let batch = await readRange(
      ctx.db.read,
      ctx.path,
      after,
      undefined,
      undefined,
      MAX_READ_BATCH_BYTES,
    );
    if (batch.messages.length === 0 && moved.offset > offset && !ctx.db.isPrimary) {
      ctx.db.toPrimary();
      batch = await readRange(
        ctx.db.read,
        ctx.path,
        after,
        undefined,
        undefined,
        MAX_READ_BATCH_BYTES,
      );
    }
    return {
      messages: batch.messages,
      timedOut: false,
      streamClosed: moved.closed && batch.messages.length === 0,
      capped: batch.capped,
    };
  }

  // ==========================================================================
  // SSE
  // ==========================================================================

  function handleSse(
    ctx: Context<Env>,
    meta: StreamMeta,
    initialOffset: string,
    cursor: string | undefined,
    useBase64: boolean,
  ): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const isJson = normalizeContentType(meta.contentType) === "application/json";
    void pumpSse(ctx, meta.generation, initialOffset, cursor, useBase64, isJson, writer)
      .catch((err: unknown) => {
        if (!isClientDisconnect(err)) console.warn("SSE pump ended with error", err);
      })
      .finally(() => writer.close().catch(() => undefined));
    const headers: Record<string, string> = {
      "content-type": "text/event-stream",
      // Never cached. With `private`, so Void keeps it as it is for a signed-in caller (it makes
      // such answers `no-store` otherwise: its guide/auth.md).
      "cache-control": "private, no-cache",
      connection: "keep-alive",
      // Compression would hold events back until a block fills.
      "content-encoding": "identity",
    };
    if (useBase64) headers[STREAM_SSE_DATA_ENCODING_HEADER] = "base64";
    return reply(200, headers, readable);
  }

  async function pumpSse(
    ctx: Context<Env>,
    generation: string,
    initialOffset: string,
    cursor: string | undefined,
    useBase64: boolean,
    isJson: boolean,
    writer: WritableStreamDefaultWriter<Uint8Array>,
  ): Promise<void> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const write = (s: string) => writer.write(encoder.encode(s));
    const control = (fields: Record<string, string | boolean>) =>
      write("event: control\n" + encodeSseData(JSON.stringify(fields)));
    const startedAt = Date.now();
    let currentOffset = initialOffset;

    for (;;) {
      const loopMeta = await readMeta(ctx.db.read, ctx.path);
      // Deleted (and maybe made again) mid-tail: this reader was the old one's.
      if (loopMeta?.generation !== generation) return;
      const batch = await readStitched(
        ctx.db.read,
        loopMeta,
        currentOffset === "-1" ? undefined : currentOffset,
        undefined,
        undefined,
      );
      // The whole batch is ONE data event, then ONE control event (§5.8).
      let frame = "";
      if (batch.messages.length > 0) {
        const fragments = batch.messages.map((m) => m.data);
        const data = useBase64
          ? base64FromBytes(concatBytes(fragments))
          : isJson
            ? decoder.decode(formatJsonMessages(fragments))
            : decoder.decode(concatBytes(fragments));
        frame += "event: data\n" + encodeSseData(data);
      }
      const freshMeta = await readMeta(ctx.db.read, ctx.path);
      if (freshMeta?.generation !== generation) return;
      await touchAccess(ctx, freshMeta, Date.now());
      const controlOffset =
        batch.messages[batch.messages.length - 1]?.offset ?? freshMeta.currentOffset;
      const atTail = !batch.capped && controlOffset >= freshMeta.currentOffset;
      const fields: Record<string, string | boolean> = { [SSE_OFFSET_FIELD]: controlOffset };
      if (freshMeta.closed && atTail) fields[SSE_CLOSED_FIELD] = true;
      else {
        fields[SSE_CURSOR_FIELD] = generateResponseCursor(cursor);
        if (!batch.capped) fields[SSE_UP_TO_DATE_FIELD] = true;
      }
      frame += "event: control\n" + encodeSseData(JSON.stringify(fields));
      await write(frame);
      if (freshMeta.closed && atTail) return;
      currentOffset = controlOffset;
      // More to catch up on: on without waiting.
      if (batch.capped) continue;

      // Wait for something new; on a quiet stream, a keep-alive each time the wait runs out,
      // without reading anything.
      for (;;) {
        // Ended now and then at a control event (§5.8); the client goes on from its offset.
        if (Date.now() - startedAt >= MAX_SSE_LIFETIME_MS) return;
        const moved = await ctx.notifier().wait(generation, currentOffset, LONG_POLL_TIMEOUT_MS);
        if (moved !== null) {
          if (moved.gone || moved.generation !== generation) return;
          if (moved.closed && moved.offset <= currentOffset) {
            await control({ [SSE_OFFSET_FIELD]: currentOffset, [SSE_CLOSED_FIELD]: true });
            return;
          }
          ctx.db.from(moved.bookmark);
          break;
        }
        // Nothing heard: a notice can be lost (its object restarted), so look once (one row).
        const quiet = await readMeta(ctx.db.read, ctx.path);
        if (quiet?.generation !== generation) return;
        if (quiet.currentOffset > currentOffset) break;
        if (quiet.closed) {
          await control({ [SSE_OFFSET_FIELD]: currentOffset, [SSE_CLOSED_FIELD]: true });
          return;
        }
        await control({
          [SSE_OFFSET_FIELD]: currentOffset,
          [SSE_CURSOR_FIELD]: generateResponseCursor(cursor),
          [SSE_UP_TO_DATE_FIELD]: true,
        });
      }
    }
  }

  // ==========================================================================
  // POST: append, close
  // ==========================================================================

  async function handlePost(ctx: Context<Env>, request: Request): Promise<Response> {
    const body = await readBody(request);
    if (body === "too_large") return text(413, "Payload too large");

    const contentType = request.headers.get("content-type") ?? undefined;
    const seq = request.headers.get(STREAM_SEQ_HEADER) ?? undefined;
    const closeStream = (request.headers.get(STREAM_CLOSED_HEADER) ?? "").toLowerCase() === "true";
    const producerId = request.headers.get(PRODUCER_ID_HEADER) ?? undefined;
    const producerEpochStr = request.headers.get(PRODUCER_EPOCH_HEADER) ?? undefined;
    const producerSeqStr = request.headers.get(PRODUCER_SEQ_HEADER) ?? undefined;
    const hasAny =
      producerId !== undefined || producerEpochStr !== undefined || producerSeqStr !== undefined;
    const hasAll =
      producerId !== undefined && producerEpochStr !== undefined && producerSeqStr !== undefined;
    if (hasAny && !hasAll)
      return text(
        400,
        "All producer headers (Producer-Id, Producer-Epoch, Producer-Seq) must be provided together",
      );
    if (hasAll && producerId === "") return text(400, "Invalid Producer-Id: must not be empty");
    let producer: ProducerHeaders | undefined;
    if (hasAll) {
      const epoch = Number(producerEpochStr);
      if (!STRICT_INTEGER_REGEX.test(producerEpochStr) || !Number.isSafeInteger(epoch))
        return text(400, "Invalid Producer-Epoch: must be a non-negative integer");
      const seqNum = Number(producerSeqStr);
      if (!STRICT_INTEGER_REGEX.test(producerSeqStr) || !Number.isSafeInteger(seqNum))
        return text(400, "Invalid Producer-Seq: must be a non-negative integer");
      producer = { producerId, epoch, seq: seqNum };
    }

    // Close only (no body, Stream-Closed: true): no content-type check (§5.2).
    if (body.length === 0 && closeStream) return handleCloseOnly(ctx, producer);
    if (body.length === 0) return text(400, "Empty body");
    if (contentType === undefined) return text(400, "Content-Type header is required");

    let jsonPayload: Uint8Array | undefined;
    return writing(async () => {
      const now = Date.now();
      const db = ctx.db.primary;
      const meta = await getMeta(ctx, db, ctx.path, now);
      if (!meta) return text(404, "Stream not found");
      if (meta.softDeleted) return text(410, "Stream is gone");
      // Closed first, so a client always sees Stream-Closed.
      if (meta.closed) {
        if (producer !== undefined && sameRequest(meta.closedBy, producer))
          return reply(204, {
            [STREAM_OFFSET_HEADER]: meta.currentOffset,
            [STREAM_CLOSED_HEADER]: "true",
            [PRODUCER_EPOCH_HEADER]: String(producer.epoch),
            [PRODUCER_SEQ_HEADER]: String(producer.seq),
          });
        return text(409, "Stream is closed", {
          [STREAM_CLOSED_HEADER]: "true",
          [STREAM_OFFSET_HEADER]: meta.currentOffset,
        });
      }
      if (
        meta.contentType !== undefined &&
        normalizeContentType(contentType) !== normalizeContentType(meta.contentType)
      )
        return text(409, "Content-type mismatch");
      // The producer before Stream-Seq, so a retry carrying both is a duplicate, not a conflict.
      let producerResult: ProducerValidationResult | undefined;
      if (producer !== undefined) {
        const state = await readProducer(db, ctx.path, producer.producerId, now);
        producerResult = validateProducer(
          state,
          producer.producerId,
          producer.epoch,
          producer.seq,
          now,
        );
        if (producerResult.status !== "accepted")
          return producerFailureResponse(meta, producerResult, producer, false);
      }
      // Stream-Seq: strictly increasing, compared as strings.
      if (seq !== undefined && meta.lastSeq !== undefined && seq <= meta.lastSeq)
        return text(409, "Sequence conflict");
      let payload = body;
      if (normalizeContentType(meta.contentType) === "application/json") {
        if (jsonPayload === undefined) {
          try {
            jsonPayload = processJsonAppend(body, false);
          } catch (err) {
            if (err instanceof JsonAppendError) return text(400, err.message);
            throw err;
          }
        }
        payload = jsonPayload;
        if (payload.length > MAX_BODY_BYTES) return text(413, "Payload too large");
      }

      const commit = new Commit(db, ctx.path, { version: meta.version });
      const newOffset = commit.append(meta.currentOffset, payload, now);
      if (producerResult?.status === "accepted")
        commit.setProducer(producerResult.producerId, producerResult.proposedState);
      if (seq !== undefined) commit.setLastSeq(seq);
      let closedBy: ClosedBy | undefined;
      if (closeStream) {
        if (producer !== undefined)
          closedBy = { producerId: producer.producerId, epoch: producer.epoch, seq: producer.seq };
        commit.setClosed(closedBy);
      }
      commit.touch(now);
      if (!(await commit.apply())) return RETRY;
      await ctx.moved(meta, { offset: newOffset, closed: closeStream, gone: false });

      const headers: Record<string, string> = { [STREAM_OFFSET_HEADER]: newOffset };
      if (producer !== undefined) {
        headers[PRODUCER_EPOCH_HEADER] = String(producer.epoch);
        headers[PRODUCER_SEQ_HEADER] = String(producer.seq);
      }
      if (closeStream) headers[STREAM_CLOSED_HEADER] = "true";
      // 200 for a producer's append (with its headers), 204 for a plain one.
      return reply(producer !== undefined ? 200 : 204, headers);
    });
  }

  const sameRequest = (closedBy: ClosedBy | undefined, producer: ProducerHeaders) =>
    closedBy?.producerId === producer.producerId &&
    closedBy.epoch === producer.epoch &&
    closedBy.seq === producer.seq;

  function handleCloseOnly(ctx: Context<Env>, producer: ProducerHeaders | undefined) {
    return writing(async () => {
      const now = Date.now();
      const db = ctx.db.primary;
      const meta = await getMeta(ctx, db, ctx.path, now);
      if (!meta) return text(404, "Stream not found");
      if (meta.softDeleted) return text(410, "Stream is gone");
      if (producer === undefined) {
        // A close is a write: it keeps a TTL alive.
        const commit = new Commit(db, ctx.path, { version: meta.version });
        commit.setClosed(undefined);
        commit.touch(now);
        if (!(await commit.apply())) return RETRY;
        await ctx.moved(meta, { offset: meta.currentOffset, closed: true, gone: false });
        return reply(204, {
          [STREAM_OFFSET_HEADER]: meta.currentOffset,
          [STREAM_CLOSED_HEADER]: "true",
        });
      }
      if (meta.closed) {
        if (sameRequest(meta.closedBy, producer))
          return reply(204, {
            [STREAM_OFFSET_HEADER]: meta.currentOffset,
            [STREAM_CLOSED_HEADER]: "true",
            [PRODUCER_EPOCH_HEADER]: String(producer.epoch),
            [PRODUCER_SEQ_HEADER]: String(producer.seq),
          });
        return text(409, "Stream is closed", {
          [STREAM_CLOSED_HEADER]: "true",
          [STREAM_OFFSET_HEADER]: meta.currentOffset,
        });
      }
      const state = await readProducer(db, ctx.path, producer.producerId, now);
      const result = validateProducer(
        state,
        producer.producerId,
        producer.epoch,
        producer.seq,
        now,
      );
      if (result.status !== "accepted")
        return producerFailureResponse(meta, result, producer, true);
      const commit = new Commit(db, ctx.path, { version: meta.version });
      commit.setProducer(result.producerId, result.proposedState);
      commit.setClosed({
        producerId: producer.producerId,
        epoch: producer.epoch,
        seq: producer.seq,
      });
      commit.touch(now);
      if (!(await commit.apply())) return RETRY;
      await ctx.moved(meta, { offset: meta.currentOffset, closed: true, gone: false });
      return reply(204, {
        [STREAM_OFFSET_HEADER]: meta.currentOffset,
        [STREAM_CLOSED_HEADER]: "true",
        [PRODUCER_EPOCH_HEADER]: String(producer.epoch),
        [PRODUCER_SEQ_HEADER]: String(producer.seq),
      });
    });
  }

  /** A producer's request that wasn't taken, as the protocol answers it. */
  function producerFailureResponse(
    meta: StreamMeta,
    result: Exclude<ProducerValidationResult, { status: "accepted" }>,
    producer: ProducerHeaders,
    isCloseOnly: boolean,
  ): Response {
    switch (result.status) {
      case "duplicate": {
        const headers: Record<string, string> = {
          [PRODUCER_EPOCH_HEADER]: String(producer.epoch),
          [PRODUCER_SEQ_HEADER]: String(result.lastSeq),
        };
        if (isCloseOnly) {
          headers[STREAM_OFFSET_HEADER] = meta.currentOffset;
          if (meta.closed) headers[STREAM_CLOSED_HEADER] = "true";
        }
        return reply(204, headers);
      }
      case "stale_epoch":
        return text(403, "Stale producer epoch", {
          [PRODUCER_EPOCH_HEADER]: String(result.currentEpoch),
        });
      case "invalid_epoch_seq":
        return text(400, "New epoch must start with sequence 0");
      case "sequence_gap":
        return text(409, "Producer sequence gap", {
          [PRODUCER_EXPECTED_SEQ_HEADER]: String(result.expectedSeq),
          [PRODUCER_RECEIVED_SEQ_HEADER]: String(result.receivedSeq),
        });
      case "stream_closed":
        return text(409, "Stream is closed", {
          [STREAM_CLOSED_HEADER]: "true",
          [STREAM_OFFSET_HEADER]: meta.currentOffset,
        });
    }
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  function handleDelete(ctx: Context<Env>): Promise<Response> {
    return writing(async () => {
      const db = ctx.db.primary;
      const meta = await getMeta(ctx, db, ctx.path, Date.now());
      if (!meta) return text(404, "Stream not found");
      if (meta.softDeleted) return text(410, "Stream is gone");
      if ((await forkEdgeCount(db, ctx.path)) > 0) {
        // Forks still read through it: only marked deleted.
        const commit = new Commit(db, ctx.path, { version: meta.version });
        commit.setSoftDeleted();
        if (!(await commit.apply())) return RETRY;
        await ctx.moved(meta, { offset: meta.currentOffset, closed: false, gone: true });
        return reply(204, {});
      }
      if (!(await purge(ctx, meta))) return RETRY;
      return reply(204, {});
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  async function readBody(request: Request): Promise<Uint8Array | "too_large"> {
    const length = Number(request.headers.get("content-length"));
    if (
      request.headers.has("content-length") &&
      Number.isFinite(length) &&
      length > MAX_BODY_BYTES
    ) {
      await drain(request.body);
      return "too_large";
    }
    if (request.body === null) return new Uint8Array(0);
    const reader = (request.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        // The rest read and dropped, so the 413 reaches a client still sending.
        for (;;) if ((await reader.read()).done) break;
        return "too_large";
      }
      chunks.push(value);
    }
    return concatBytes(chunks);
  }

  async function drain(body: ReadableStream<Uint8Array> | null) {
    if (body === null) return;
    const reader = body.getReader();
    for (;;) if ((await reader.read()).done) return;
  }

  const makeEtag = (path: string, start: string, end: string, closed: boolean) =>
    `"${base64FromString(path)}:${start}:${end}${closed ? ":c" : ""}"`;

  /** A request to one stream, at its URL's path. */
  return async function handle(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsOn ? CORS_HEADERS : {} });
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith("/__ds") || path.includes("/__ds/"))
      return text(404, "Durable Streams control route not found");
    if (path === "/" || path === "")
      return reply(
        200,
        { "content-type": "text/plain" },
        "Durable Streams server. Streams live at /<path>.",
      );
    const bookmark = request.headers.get(BOOKMARK_HEADER);
    const sessions = new Sessions(
      options.database(env),
      bookmark && bookmark.length < 512 ? bookmark : null,
      request.headers.get(SESSION_HEADER) === "first-primary",
    );
    const ctx = new Context(env, path, sessions, options.notifier);
    let response: Response;
    switch (request.method) {
      case "PUT":
        response = await handlePut(ctx, request, url);
        break;
      case "HEAD":
        response = await handleHead(ctx);
        break;
      case "GET":
        response = await handleGet(ctx, request, url);
        break;
      case "POST":
        response = await handlePost(ctx, request);
        break;
      case "DELETE":
        response = await handleDelete(ctx);
        break;
      default:
        await drain(request.body as ReadableStream<Uint8Array> | null);
        return text(405, "Method not allowed");
    }
    const newest = sessions.bookmark();
    if (newest !== null) response.headers.set(BOOKMARK_HEADER, newest);
    return response;
  };
}

/**
 * Remove every stream past its expiry (a read finds one anyway and removes it then): for a
 * scheduled job, so expired streams don't keep their storage.
 */
export async function sweepExpired<Env>(
  options: D1StreamsOptions<Env>,
  env: Env,
  origin: string,
): Promise<number> {
  const db = createDb(options.database(env), { session: "first-primary" });
  const handle = createD1Streams(options);
  const now = Date.now();
  let removed = 0;
  for (const meta of await expiring(db))
    if (isExpired(meta, now)) {
      // A HEAD applies expiry, as any read does.
      await handle(new Request(`${origin}${meta.path}`, { method: "HEAD" }), env);
      removed += 1;
    }
  return removed;
}
