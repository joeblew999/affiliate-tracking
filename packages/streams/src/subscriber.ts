// A subscriber's side (PROTOCOL.md, section 7.1): checking a wake really is from the server,
// reading a stream on from where it was acknowledged, and acknowledging. For a Void app that is
// woken at a route: the route checks the wake and queues it, and the queue's consumer does the
// reading, the work and the acknowledging. `fetch` here is however the app reaches the server:
// the runtime's, or a service binding's.
import { fromBase64url, type PublicJwk } from "./keys.ts";

export type { PublicJwk };

/** A wake, as the server sends it. */
export type Wake = {
  subscription_id: string;
  wake_id: string;
  generation: number;
  streams: {
    path: string;
    link_type: "glob" | "explicit";
    acked_offset: string;
    tail_offset: string;
    has_pending: boolean;
  }[];
  callback_url: string;
  callback_token: string;
};

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const text = new TextEncoder();

/** How old a wake's signature may be (the protocol's suggested five minutes). */
const TOLERANCE_SECONDS = 300;

/**
 * Whether a wake's body was signed by the server: its Webhook-Signature header against the
 * server's published keys (`<root>/__ds/jwks.json`).
 */
export async function wakeIsSigned(
  body: string,
  signature: string | null,
  keys: PublicJwk[],
): Promise<boolean> {
  const match = signature?.match(/^t=(\d+),kid=([^,]+),ed25519=([A-Za-z0-9_-]+)$/);
  if (!match) return false;
  const [, timestamp = "", kid, signed = ""] = match;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      fromBase64url(signed),
      text.encode(`${timestamp}.${body}`),
    );
  } catch {
    return false;
  }
}

/** The server's published keys. */
export async function serverKeys(fetch: Fetch, root: string): Promise<PublicJwk[]> {
  const response = await fetch(`${root}/__ds/jwks.json`);
  if (!response.ok) throw new Error(`streams keys: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { keys: PublicJwk[] }).keys;
}

/**
 * A JSON stream's events after `offset`, up to where it ends now, and that end (the offset to
 * acknowledge once they're dealt with). `url` is the stream's address.
 */
export async function readOn<Event>(
  fetch: Fetch,
  url: string,
  offset: string,
): Promise<{ events: Event[]; offset: string }> {
  const events: Event[] = [];
  let at = offset;
  for (;;) {
    const response = await fetch(`${url}?offset=${encodeURIComponent(at)}`);
    if (!response.ok) throw new Error(`stream ${url}: ${response.status} ${await response.text()}`);
    events.push(...((await response.json()) as Event[]));
    at = response.headers.get("stream-next-offset") ?? at;
    // The server gives a long stream in parts; it says when this was the last of them.
    if (response.headers.get("stream-up-to-date") === "true") return { events, offset: at };
  }
}

/**
 * Acknowledge a wake: each stream read, up to the offset dealt with, and the wake finished.
 * - "done": acknowledged;
 * - "stale": the wake is no longer the current one (its lease ran out and another was sent), so
 *   that one's subscriber acknowledges instead;
 * - "ahead": an offset is past where the subscription knows the stream to end, and nothing was
 *   acknowledged.
 */
export async function acknowledge(
  fetch: Fetch,
  callbackUrl: string,
  wake: Wake,
  acks: { stream: string; offset: string }[],
): Promise<"done" | "stale" | "ahead"> {
  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${wake.callback_token}`,
    },
    body: JSON.stringify({ wake_id: wake.wake_id, generation: wake.generation, acks, done: true }),
  });
  if (response.ok) return "done";
  const said = await response.text();
  if (response.status === 409 && said.includes("FENCED")) return "stale";
  if (response.status === 409 && said.includes("beyond stream tail")) return "ahead";
  // A subscription that's gone has nothing to acknowledge.
  if (response.status === 404) return "stale";
  throw new Error(`acknowledge ${wake.subscription_id}: ${response.status} ${said}`);
}
