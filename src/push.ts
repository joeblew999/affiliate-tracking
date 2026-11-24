// Delivery by one route: the simplest way for a Worker to follow streams. It asks once
// (PUT /v1/push/<id>, with the streams and its own address), and from then on the hub sends that
// address each batch of new events, as JSON: { delivery, stream, events, offset }, with the
// delivery's secret in `x-hub-secret`, so the Worker knows it's the hub's. A 2xx answer
// acknowledges the batch; anything else, and it's sent again later (with the subscription's own
// backoff). No signature to check, no reading, no acknowledging: one ordinary route.
//
// The hub's own, on top of the protocol: underneath it's an ordinary webhook subscription
// (`push:<id>`) whose webhook is the hub itself. The subscription's wake comes here in process
// (durable-objects/stream-subscriptions.ts), where the events are read and sent on.
import { createDb, sql } from "void/db";
import { d1Streams, type Bindings } from "./d1.ts";
import type { Wake } from "./server/subscriber.ts";
import { rootOf } from "./roots.ts";

/** The address a delivery's subscription is woken at: never fetched, taken in process. */
const PUSH = "https://push.hub.internal/";
export const pushUrl = (organization: string, id: string) =>
  `${PUSH}${organization}/${encodeURIComponent(id)}`;
export const subscriptionOf = (id: string) => `push:${id}`;

type Target = { url: string; secret: string };

export async function saveTarget(env: Bindings, organization: string, id: string, url: string) {
  const db = createDb(env.DB, { session: "first-primary" });
  const [existing] = await db.all<Target>(
    sql`SELECT url, secret FROM hub_pushes WHERE organization = ${organization} AND id = ${id}`,
  );
  const secret = existing?.secret ?? crypto.randomUUID().replaceAll("-", "");
  await db.run(
    sql`INSERT INTO hub_pushes (organization, id, url, secret, created_at)
        VALUES (${organization}, ${id}, ${url}, ${secret}, ${Date.now()})
        ON CONFLICT (organization, id) DO UPDATE SET url = excluded.url`,
  );
  return { secret, created: !existing };
}

export async function removeTarget(env: Bindings, organization: string, id: string) {
  await createDb(env.DB, { session: "first-primary" }).run(
    sql`DELETE FROM hub_pushes WHERE organization = ${organization} AND id = ${id}`,
  );
}

/** An organization's deliveries. */
export async function targets(env: Bindings, organization: string) {
  return createDb(env.DB).all<{ id: string; url: string; created_at: number }>(
    sql`SELECT id, url, created_at FROM hub_pushes WHERE organization = ${organization} ORDER BY id`,
  );
}

/**
 * Whether a wake's address is a delivery's; if so the wake is dealt with here: each stream's new
 * events read and sent to the Worker, and the answer says how the wake went ({ done: true }
 * acknowledges all it showed; a failure has it sent again).
 */
export async function deliver(
  env: Bindings,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  if (!url.startsWith(PUSH)) return null;
  const [organization = "", id = ""] = url.slice(PUSH.length).split("/").map(decodeURIComponent);
  const [target] = await createDb(env.DB).all<Target>(
    sql`SELECT url, secret FROM hub_pushes WHERE organization = ${organization} AND id = ${id}`,
  );
  // The delivery was removed: nothing to send, and nothing to send again.
  if (!target) return Response.json({ done: true });
  // The subscription sends its wake as JSON text.
  if (typeof init.body !== "string") return new Response("A wake is JSON text", { status: 400 });
  const wake = JSON.parse(init.body) as Wake;
  for (const stream of wake.streams) {
    if (!stream.has_pending) continue;
    const events: unknown[] = [];
    let offset = stream.acked_offset;
    for (;;) {
      const read = await d1Streams(
        new Request(`https://hub${rootOf(organization)}/${stream.path}?offset=${offset}`, {
          headers: { "x-db-session": "first-primary" },
        }),
        env,
      );
      if (!read.ok) return new Response(`reading ${stream.path}: ${read.status}`, { status: 502 });
      events.push(...((await read.json()) as unknown[]));
      offset = read.headers.get("stream-next-offset") ?? offset;
      if (read.headers.get("stream-up-to-date") === "true") break;
    }
    if (events.length === 0) continue;
    const sent = await fetch(target.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-secret": target.secret },
      body: JSON.stringify({ delivery: id, stream: stream.path, events, offset }),
    });
    if (!sent.ok) return new Response(`${target.url} answered ${sent.status}`, { status: 502 });
  }
  return Response.json({ done: true });
}
