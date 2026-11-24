// The hub (the hub, at the repo's root): the streams every worker of the program writes to and follows (Durable
// Streams). The shop reaches it through its service binding, with the workers' token, as any
// worker does. What it publishes there is src/published.ts; what it follows is src/followed.ts.
import { env as bindings } from "cloudflare:workers";
import { carried } from "activity/server";
import { publisher } from "cloudflare-durable-streams/bus";
import { hub as client } from "cloudflare-durable-streams/client";
import { env } from "void/env";

export const hub = client(bindings.HUB, env.HUB_KEY);

/** An event written to its stream now, as a step of the action it's part of. */
export const publishNow = publisher(hub, carried);
