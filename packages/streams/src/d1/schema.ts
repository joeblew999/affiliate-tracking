// The tables Durable Streams keeps in D1 (store.ts): every stream an app has, in its one database,
// so any of the app's Workers, anywhere, reads any stream from its nearest read replica. An app
// exports these from its db/schema.ts; `void db generate` writes their migration. Column names are
// given here, so they don't depend on the app's database.casing.
import { blob, index, integer, primaryKey, sqliteTable, text } from "void/schema-d1";

/** A stream, by its path: how it was made, where it ends, and whether it's closed or gone. */
export const dsStreams = sqliteTable(
  "ds_streams",
  {
    path: text("path").primaryKey(),
    /** Minted at creation: a stream deleted and made again at the same path is another one. */
    gen: text("gen").notNull(),
    /**
     * Changed by every write, to a value of the writer's own: a write applies only if the stream
     * is still as the writer read it (store.ts, Commit).
     */
    version: text("version").notNull(),
    contentType: text("content_type"),
    ttlSeconds: integer("ttl_seconds"),
    expiresAt: text("expires_at"),
    closed: integer("closed").notNull().default(0),
    /** The producer request that closed it, as JSON: its retry is answered as a success. */
    closedBy: text("closed_by"),
    currentOffset: text("current_offset").notNull(),
    lastSeq: text("last_seq"),
    createdAt: integer("created_at").notNull(),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    forkedFrom: text("forked_from"),
    forkOffset: text("fork_offset"),
    forkSubOffset: integer("fork_sub_offset"),
    /** The source's generation this fork was made from. */
    forkSourceGen: text("fork_source_gen"),
    /** Deleted, but still read by its forks (410 Gone to everyone else). */
    softDeleted: integer("soft_deleted").notNull().default(0),
  },
  (t) => [index("ds_streams_expiry").on(t.expiresAt, t.ttlSeconds)],
);

/** A stream's messages, each by the offset after it. */
export const dsMessages = sqliteTable(
  "ds_messages",
  {
    path: text("path").notNull(),
    offset: text("offset").notNull(),
    data: blob("data").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => [primaryKey({ columns: [t.path, t.offset] })],
);

/** Each idempotent producer of a stream: its epoch and the last sequence number taken. */
export const dsProducers = sqliteTable(
  "ds_producers",
  {
    path: text("path").notNull(),
    producerId: text("producer_id").notNull(),
    epoch: integer("epoch").notNull(),
    lastSeq: integer("last_seq").notNull(),
    lastUpdated: integer("last_updated").notNull(),
  },
  (t) => [primaryKey({ columns: [t.path, t.producerId] })],
);

/**
 * A fork's hold on its source: while any is there, deleting the source only marks it deleted. One
 * per fork, named by the fork's generation.
 */
export const dsForkEdges = sqliteTable(
  "ds_fork_edges",
  {
    sourcePath: text("source_path").notNull(),
    edgeId: text("edge_id").notNull(),
    forkOffset: text("fork_offset").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourcePath, t.edgeId] })],
);
