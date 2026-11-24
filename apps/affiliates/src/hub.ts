// The hub (apps/hub): the streams every worker of the program writes to and follows (Durable
// Streams). This service reaches it through its service binding, with the workers' token. What it
// publishes there is here; what it follows is src/followed.ts.
import { env as bindings } from "cloudflare:workers";
import { carried } from "activity/server";
import { publisher } from "hub/bus";
import { hub as client } from "hub/client";
import { env } from "void/env";
import { DEMO_RESET_STREAM, ON_SALE_STREAM, type DemoReset, type OnSale } from "./host-contract.ts";

// Cloudflare's own `env`, typed by the bindings Void generates (.void/bindings.d.ts).
declare global {
  namespace Cloudflare {
    interface Env extends VoidGeneratedEnvBindings {}
  }
}

export const hub = client(bindings.HUB, env.HUB_TOKEN);

/** An event written to its stream now, as a step of the action it's part of. */
const publishNow = publisher(hub, carried);

/** An event went on sale: for the host, which tells its users. */
export const publishOnSale = (data: OnSale) => publishNow(ON_SALE_STREAM, "on-sale", data);

/** The demo was put back here: for the host, which puts its own back. */
export const publishDemoReset = (data: DemoReset) =>
  publishNow(DEMO_RESET_STREAM, "demo-reset", data);
