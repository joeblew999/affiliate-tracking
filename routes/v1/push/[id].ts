// Delivery by one route (src/push.ts): a Worker asks the hub to send it the events of some
// streams. PUT { streams, url } starts (or changes) it, and answers with its secret; DELETE ends it.
import { defineHandler } from "void";
import { env } from "cloudflare:workers";
import { z } from "zod";
import type { Bindings } from "../../../src/d1.ts";
import { pushUrl, removeTarget, saveTarget, subscriptionOf } from "../../../src/push.ts";
import { serve } from "../../../src/streams.ts";

const bindings = env as unknown as Bindings;

const Delivery = z.object({
  /** The streams to be sent, by name. */
  streams: z.array(z.string().min(1)).min(1),
  /** The Worker's own address for them. */
  url: z.url(),
});

/** A delivery's subscription, among its organization's (a `__ds` route of the protocol). */
const subscriptionPath = (id: string) =>
  `__ds/subscriptions/${encodeURIComponent(subscriptionOf(id))}`;

export const PUT = defineHandler.withValidator({ body: Delivery })(async (c, { body }) => {
  const organization = c.get("organization");
  const id = c.req.param("id") ?? "";
  const { secret } = await saveTarget(bindings, organization, id, body.url);
  const init: RequestInit = {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "webhook",
      streams: body.streams,
      webhook: { url: pushUrl(organization, id) },
      lease_ttl_ms: 60_000,
      description: `Delivery to ${body.url}`,
    }),
  };
  const made = await serve(
    new Request(new URL("/", c.req.url), init),
    organization,
    subscriptionPath(id),
  );
  if (!made.ok) return c.json({ error: await made.text() }, made.status as 400);
  return c.json({ id, secret });
});

export const DELETE = defineHandler(async (c) => {
  const organization = c.get("organization");
  const id = c.req.param("id") ?? "";
  await serve(
    new Request(new URL("/", c.req.url), { method: "DELETE" }),
    organization,
    subscriptionPath(id),
  );
  await removeTarget(bindings, organization, id);
  return c.body(null, 204);
});
