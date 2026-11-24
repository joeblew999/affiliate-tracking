// Which subscriptions follow which streams, and which streams there are: what a write looks up to
// know whom to tell, and what a new subscription with a pattern looks up to find the streams
// already there. Their Cloudflare server has neither: each stream is a Durable Object of its own,
// and nothing knows them all.
//
// Split by the first part of a stream's path ("events" for events/abc), one object each, so no
// one object is asked about every write. A pattern whose first part is itself a wildcard ("*/x",
// "**") can't be placed that way: it goes in the object named "~", which every write also asks.
//
// Void's durable state, for its typed methods; the lists themselves are rows in the object's own
// SQLite (a path each), not the saved value, so a thousand streams aren't rewritten to add one.
import type { DurableStateContext, DurableStateDefinition } from "void/durable";
import { globMatch, relative } from "./glob.ts";

type Context = DurableStateContext<Record<string, never>, Record<string, unknown>>;

/** The directory object for patterns that could cover any stream. */
export const ANY = "~";

/** The directory object a stream, or a pattern, belongs to. */
export function shardOf(pathOrPattern: string): string {
  const first = relative(pathOrPattern).split("/")[0] ?? "";
  return first === "" || first.includes("*") ? ANY : first;
}

function tables(context: Context) {
  const sql = context.storage.sql;
  sql.exec(
    "CREATE TABLE IF NOT EXISTS followed (id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (id, path))",
  );
  sql.exec("CREATE TABLE IF NOT EXISTS patterns (id TEXT PRIMARY KEY, pattern TEXT NOT NULL)");
  sql.exec("CREATE TABLE IF NOT EXISTS streams (path TEXT PRIMARY KEY)");
  sql.exec("CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY)");
  return sql;
}

const methods = {
  /** A subscription follows this pattern, or this stream by name. */
  follow(context: Context, id: string, what: { pattern?: string; stream?: string }): void {
    const sql = tables(context);
    if (what.pattern !== undefined)
      sql.exec("INSERT OR REPLACE INTO patterns (id, pattern) VALUES (?, ?)", id, what.pattern);
    if (what.stream !== undefined)
      sql.exec(
        "INSERT OR IGNORE INTO followed (id, path) VALUES (?, ?)",
        id,
        relative(what.stream),
      );
  },

  /** A subscription no longer follows this stream by name. */
  unfollow(context: Context, id: string, stream: string): void {
    tables(context).exec("DELETE FROM followed WHERE id = ? AND path = ?", id, relative(stream));
  },

  /** A subscription is gone. */
  forget(context: Context, id: string): void {
    const sql = tables(context);
    sql.exec("DELETE FROM followed WHERE id = ?", id);
    sql.exec("DELETE FROM patterns WHERE id = ?", id);
  },

  /**
   * A stream was written to (`created`: it's new, `deleted`: it's gone): the subscriptions that
   * follow it, by name or by a pattern here.
   */
  written(context: Context, path: string, change?: "created" | "deleted"): string[] {
    const sql = tables(context);
    const name = relative(path);
    if (change === "created") sql.exec("INSERT OR IGNORE INTO streams (path) VALUES (?)", name);
    if (change === "deleted") sql.exec("DELETE FROM streams WHERE path = ?", name);
    const ids = new Set<string>();
    for (const row of sql.exec<{ id: string }>("SELECT id FROM followed WHERE path = ?", name))
      ids.add(row.id);
    for (const row of sql.exec<{ id: string; pattern: string }>("SELECT id, pattern FROM patterns"))
      if (globMatch(row.pattern, name)) ids.add(row.id);
    return [...ids];
  },

  /** There is a subscription with this id. Kept in the "~" object only: the list of them all. */
  enrol(context: Context, id: string): void {
    tables(context).exec("INSERT OR IGNORE INTO subscriptions (id) VALUES (?)", id);
  },

  /** That subscription is gone (the "~" object). */
  strike(context: Context, id: string): void {
    tables(context).exec("DELETE FROM subscriptions WHERE id = ?", id);
  },

  /** Every subscription there is (the "~" object). */
  enrolled(context: Context): string[] {
    return [...tables(context).exec<{ id: string }>("SELECT id FROM subscriptions")].map(
      (row) => row.id,
    );
  },

  /** The streams here that a pattern covers. */
  covered(context: Context, pattern: string): string[] {
    const paths: string[] = [];
    for (const row of tables(context).exec<{ path: string }>("SELECT path FROM streams"))
      if (globMatch(pattern, row.path)) paths.push(row.path);
    return paths;
  },
};

export type DirectoryMethods = typeof methods;

/** The directory, for Void's `defineDurableState` in an app's `durable-objects/`. */
export const directoryState: DurableStateDefinition<
  Record<string, never>,
  Record<string, unknown>,
  DirectoryMethods
> = { initialState: {}, methods };
