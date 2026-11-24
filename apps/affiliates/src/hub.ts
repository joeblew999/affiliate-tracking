// The hub (apps/hub): the streams every worker of the program writes to and follows. This service
// reaches it through its service binding, with the workers' token. It follows the shop's new
// users: the hub wakes it at routes/api/hub/wake.ts, and queues/wakes.ts reads on and
// acknowledges.
import { env as bindings } from "cloudflare:workers";
import { env } from "void/env";
import { hub as client, STREAMS } from "hub/client";
import { serverKeys, type PublicJwk } from "streams/subscriber";
import { SIGNUPS_STREAM, SIGNUPS_SUBSCRIPTION } from "./host-contract.ts";

export { STREAMS };

export const hub = client(bindings.HUB, env.HUB_TOKEN);

let keys: Promise<PublicJwk[]> | undefined;

/** The keys the hub signs its wakes with. `fresh`: ask again (a wake signed with one not seen). */
export function hubKeys(fresh = false): Promise<PublicJwk[]> {
  if (fresh) keys = undefined;
  return (keys ??= serverKeys(hub.streams, STREAMS).catch((error: unknown) => {
    keys = undefined;
    throw error;
  }));
}

let followed: Promise<void> | undefined;

/**
 * What this service follows, said to the hub once in each run of the Worker (the subscription
 * itself stays in the hub; saying it again changes nothing). The hub wakes the service at its own
 * address.
 */
export function following(): Promise<void> {
  return (followed ??= hub
    .subscribe(SIGNUPS_SUBSCRIPTION, {
      streams: [SIGNUPS_STREAM],
      wake: new URL("/api/hub/wake", env.AFFILIATES_SITE_URL).href,
      description: "The affiliate service, told of each new user",
    })
    .catch((error: unknown) => {
      followed = undefined;
      throw error;
    }));
}
