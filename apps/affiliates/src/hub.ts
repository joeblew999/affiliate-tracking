// The shop's streams, from this service (Durable Streams with subscriptions: packages/streams,
// mounted in the shop at /streams). This service follows the shop's new users: it's woken at
// routes/api/host/wake.ts, and queues/wakes.ts reads on and acknowledges. Everything goes to the
// shop over its binding, with the shared token, as this service's other calls to it do.
import { env as bindings } from "cloudflare:workers";
import { env } from "void/env";
import { serverKeys, type PublicJwk } from "streams/subscriber";

/** Where the shop's streams are. */
export const STREAMS = new URL("/streams", env.HOST_SITE_URL).href;

/**
 * A request to the shop's streams. Whatever address it's given (a wake says where to acknowledge
 * as the shop names itself), only the path is used: the shop is reached over the binding.
 */
export function shopStreams(url: string, init: RequestInit = {}): Promise<Response> {
  const { pathname, search } = new URL(url);
  const headers = new Headers(init.headers);
  // An acknowledgement carries the wake's own token; anything else, the shared one.
  if (!headers.has("authorization"))
    headers.set("authorization", `Bearer ${env.AFFILIATES_HOST_TOKEN}`);
  return bindings.HOST.fetch(
    new Request(new URL(pathname + search, env.HOST_SITE_URL), { ...init, headers }),
  );
}

let keys: Promise<PublicJwk[]> | undefined;

/** The keys the shop signs its wakes with. `fresh`: ask again (a wake signed with one not seen). */
export function shopKeys(fresh = false): Promise<PublicJwk[]> {
  if (fresh) keys = undefined;
  return (keys ??= serverKeys(shopStreams, STREAMS).catch((error: unknown) => {
    keys = undefined;
    throw error;
  }));
}
