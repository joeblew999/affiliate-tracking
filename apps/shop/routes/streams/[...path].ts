// Reading the control plane's streams (durable-objects/streams.ts), from a browser: your own
// stream, or any if you're an admin. A stream's address is this route's own path. Only the shop's
// code writes to them (src/streams.ts), so there is nothing here but reading.
import { createStreamsHandler } from "@durable-streams/server-cloudflare";
import { env } from "cloudflare:workers";
import { defineHandler } from "void";
import { getUser } from "void/auth";

// Who may read is decided below, with the shop's sign-in. Saying so here also stops anything
// caching what's read.
const streams = createStreamsHandler({ cors: false, auth: () => undefined });

export const GET = defineHandler((c) => {
  const user = getUser();
  const viewer = c.req.param("path");
  if (!user || (viewer !== user.id && user.role !== "admin"))
    return c.text("Not yours to watch", 403);
  return streams(c.req.raw, env as never);
});
