// One stream of an organization, in the console: what's in it (its latest part), read on live by
// the page (routes/console/tail). ?org=<slug>&name=<the stream's name>.
import { defineHandler, defineHead, type InferProps } from "void";
import { requireAdmin } from "../src/console.ts";
import { organizations, serve } from "../src/streams.ts";

/** At most this much of a stream is shown when the page opens (the protocol gives it in parts). */
const PARTS = 5;

export const loader = defineHandler(async (c) => {
  requireAdmin(c);
  const organization = (await organizations()).find((one) => one.slug === c.req.query("org"));
  const name = c.req.query("name") ?? "";
  if (!organization || !name) return c.notFound();
  const events: unknown[] = [];
  let offset = "-1";
  let json = true;
  for (let part = 0; part < PARTS; part++) {
    const read = await serve(
      new Request(new URL(`/?offset=${offset}`, c.req.url)),
      organization.id,
      name,
    );
    if (read.status === 404) return c.notFound();
    json = (read.headers.get("content-type") ?? "").includes("json");
    if (json) events.push(...((await read.json()) as unknown[]));
    offset = read.headers.get("stream-next-offset") ?? offset;
    if (read.headers.get("stream-up-to-date") === "true") break;
  }
  return { organization, name, json, events, offset };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Stream" }));
