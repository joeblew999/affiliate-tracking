// What an organization has on the hub, for its console: its streams, its subscriptions with how
// far each has acknowledged, its deliveries. The protocol has no listing: this is the hub's own,
// read straight from where each is kept.
import { env } from "cloudflare:workers";
import { createDb, sql } from "void/db";
import { Directory } from "../durable-objects/stream-directory.ts";
import { Subscriptions } from "../durable-objects/stream-subscriptions.ts";
import type { Bindings } from "./d1.ts";
import { targets } from "./push.ts";
import { rootOf } from "./roots.ts";

const bindings = env as unknown as Bindings;

export type StreamRow = {
  /** As a Worker names it. */
  name: string;
  offset: string;
  closed: boolean;
  contentType: string | null;
  createdAt: number;
  messages: number;
};

/** An organization's streams, newest first. */
export async function listStreams(organization: string): Promise<StreamRow[]> {
  const prefix = `${rootOf(organization)}/`;
  const rows = await createDb(bindings.DB).all<{
    path: string;
    current_offset: string;
    closed: number;
    content_type: string | null;
    created_at: number;
    messages: number;
  }>(
    sql`SELECT s.path, s.current_offset, s.closed, s.content_type, s.created_at,
          (SELECT COUNT(*) FROM ds_messages m WHERE m.path = s.path) AS messages
        FROM ds_streams s
        WHERE substr(s.path, 1, ${prefix.length}) = ${prefix} AND s.soft_deleted = 0
        ORDER BY s.created_at DESC LIMIT 500`,
  );
  return rows.map((row) => ({
    name: row.path.slice(prefix.length),
    offset: row.current_offset,
    closed: row.closed !== 0,
    contentType: row.content_type,
    createdAt: row.created_at,
    messages: row.messages,
  }));
}

export type SubscriptionRow = {
  id: string;
  type: string;
  description: string | null;
  /** Where its wakes go: a Worker's address, a wake stream, or a delivery by one route. */
  to: string;
  /** Each stream it follows, how far it has acknowledged, and whether the stream has gone on. */
  streams: { path: string; acked: string; behind: boolean }[];
  /** Its deliveries have failed too often: it's no longer woken. */
  failed: boolean;
};

/** An organization's subscriptions, each as the protocol describes it. */
export async function listSubscriptions(organization: string): Promise<SubscriptionRow[]> {
  const ids = await Directory.get(`${organization}/~`).enrolled();
  const ends = new Map((await listStreams(organization)).map((s) => [s.name, s.offset]));
  const pushes = new Map(
    (await targets(bindings, organization)).map((t) => [`push:${t.id}`, t.url]),
  );
  const all = await Promise.all(
    ids.map(async (id) => {
      const record = (await Subscriptions.get(`${organization}/${id}`).read()) as {
        type?: string;
        description?: string;
        webhook?: { url?: string };
        wake_stream?: string;
        status?: string;
        streams?: { path: string; acked_offset?: string }[];
      } | null;
      if (!record) return null;
      const streams = (record.streams ?? []).map((stream) => ({
        path: stream.path,
        acked: stream.acked_offset ?? "",
        behind: (ends.get(stream.path) ?? "") > (stream.acked_offset ?? ""),
      }));
      return {
        id,
        type: pushes.has(id) ? "delivery" : (record.type ?? "webhook"),
        description: record.description ?? null,
        to: pushes.get(id) ?? record.webhook?.url ?? record.wake_stream ?? "",
        streams,
        failed: record.status === "failed",
      } satisfies SubscriptionRow;
    }),
  );
  return all.filter((one) => one !== null).sort((a, b) => a.id.localeCompare(b.id));
}
