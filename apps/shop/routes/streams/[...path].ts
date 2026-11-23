// Reading the control plane's streams (src/streams.ts), from a browser: your own stream, or any if
// you're an admin (the one with everyone's actions, and a person's own while viewing the program
// as them). A stream's address is this route's own path. The Activity pane reads here
// (packages/activity), the affiliate service's pages through that app's route of the same name.
// Only the shop's code writes to streams, so there is nothing here but reading.
import { createStreamsHandler } from "@durable-streams/server-cloudflare";
import { env } from "cloudflare:workers";
import { defineHandler } from "void";
import { getUser } from "void/auth";
import { streamOf } from "../../src/streams.ts";

// Who may read is decided below, with the shop's sign-in. Saying so here also stops anything
// caching what's read.
const streams = createStreamsHandler({ cors: false, auth: () => undefined });
const read = (request: Request) => streams(request, env as never);

export const GET = defineHandler(async (c) => {
  const user = getUser();
  const viewer = c.req.param("path");
  if (!user || !viewer || (viewer !== user.id && user.role !== "admin"))
    return c.text("Not yours to watch", 403);
  const found = await read(c.req.raw);
  if (found.status !== 404) return found;
  // Nothing has happened for them yet: an empty stream, so the page can wait on it.
  await streamOf(viewer).create();
  return read(c.req.raw);
});
