// The hub (apps/hub): the streams every worker of the program writes to and follows. The shop
// reaches it through its service binding, with the workers' token, as any worker does.
import { env as bindings } from "cloudflare:workers";
import { env } from "void/env";
import { hub as client } from "hub/client";

export const hub = client(bindings.HUB, env.HUB_TOKEN);
