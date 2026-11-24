// The hub (apps/hub): the streams every worker of the program writes to and follows (Durable
// Streams). The shop reaches it through its service binding, with the workers' token, as any
// worker does. What it publishes there is src/published.ts; what it follows is src/followed.ts.
import { env as bindings } from "cloudflare:workers";
import { carried } from "activity/server";
import { publisher } from "hub/bus";
import { hub as client } from "hub/client";
import { env } from "void/env";

export const hub = client(bindings.HUB, env.HUB_TOKEN);

/** An event written to its stream now, as a step of the action it's part of. */
export const publishNow = publisher(hub, carried);
