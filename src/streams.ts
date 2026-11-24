// The hub's streams: Durable Streams, with the protocol's subscriptions (src/server), at
// /v1/stream. All of it is the protocol: a worker makes a stream (PUT), writes to it (POST), reads it
// (GET, caught up or live) and follows it (a subscription under /v1/stream/__ds). A write's answer
// also names the subscriptions told of it (src/server's SUBSCRIPTIONS_HEADER).
//
// The streams themselves are in the hub's D1 (src/server/d1), read from the nearest read replica.
//
// Every stream, subscription and wake belongs to an organization (Better Auth's, auth.ts): the one
// the caller's key is of. A Worker asks for /v1/stream/orders/paid; inside, that is
// /v1/o/<organization>/stream/orders/paid, so two organizations' streams of one name are two
// streams, and nothing of one is reachable from the other: each has its own root here, its own
// subscriptions and its own directory of who follows what. A subscriber answers a wake with the
// wake's own token, which holds only in the organization whose subscription made it (answerWake).
import { env } from "cloudflare:workers";
import { createDb, sql } from "void/db";
import { createStreams } from "./server/index.ts";
import { sweepExpired } from "./server/d1/index.ts";
import { Directory } from "../durable-objects/stream-directory.ts";
import { Signing } from "../durable-objects/stream-signing.ts";
import { Subscriptions } from "../durable-objects/stream-subscriptions.ts";
import { d1, d1Streams, type Bindings } from "./d1.ts";
import { ROOT, rootOf } from "./roots.ts";

export { ROOT, rootOf };

/**
 * The address the hub gives its streams when nobody asked (its daily job). Not one anybody can
 * open: only the path counts.
 */
export const ORIGIN = "https://hub";

const bindings = env as unknown as Bindings;

const FORKED_FROM = "stream-forked-from";

/** A durable state's objects, each named within an organization. */
const within = <Api extends { get(name: string): unknown }>(api: Api, organization: string): Api =>
  ({ ...api, get: (name: string) => api.get(`${organization}/${name}`) }) as Api;

const made = new Map<string, ReturnType<typeof createStreams<Bindings>>>();

/** An organization's streams: the protocol, with its subscriptions, under its own root. */
export function streamsOf(organization: string) {
  let streams = made.get(organization);
  if (!streams) {
    streams = createStreams<Bindings>({
      root: rootOf(organization),
      // What a subscriber is told (where to answer a wake, where the keys are): as a Worker
      // knows the hub. answerWake() finds whose the answer is.
      shownRoot: ROOT,
      streams: d1Streams,
      subscriptions: within(Subscriptions, organization),
      directory: within(Directory, organization),
      signing: Signing,
    });
    made.set(organization, streams);
  }
  return streams;
}

/**
 * A request to an organization's streams, already allowed. `path`: the stream's, or a `__ds`
 * route's, with the request's query kept. A stream's address in the answer (`Location`) is given
 * as a Worker knows it.
 */
export async function serve(request: Request, organization: string, path: string) {
  const outside = new URL(request.url);
  const inside = new URL(`${rootOf(organization)}/${path}${outside.search}`, outside.origin);
  const headers = new Headers(request.headers);
  // A fork names its source as a Worker knows it: inside, it's under the organization's root too.
  const source = headers.get(FORKED_FROM);
  if (source?.startsWith(`${ROOT}/`))
    headers.set(FORKED_FROM, `${rootOf(organization)}${source.slice(ROOT.length)}`);
  const response = await streamsOf(organization).handle(
    new Request(inside, new Request(request, { headers })),
    bindings,
  );
  // A new stream's address in the answer, as a Worker knows it.
  const location = response.headers.get("location");
  if (!location) return response;
  const answered = new Response(response.body, response);
  answered.headers.set("location", location.replace(rootOf(organization), ROOT));
  return answered;
}

/**
 * A subscriber's answer to a wake, at the address the wake gave it, with only the wake's token:
 * tried in each organization, since the token holds only in the one whose subscription made it.
 */
export async function answerWake(request: Request, path: string): Promise<Response> {
  const body = await request.text();
  let refused: Response | undefined;
  for (const { id } of await organizations()) {
    const answer = await serve(new Request(request, { method: "POST", body }), id, path);
    if (answer.status !== 401 && answer.status !== 404) return answer;
    refused = answer;
  }
  return refused ?? new Response("Subscription not found", { status: 404 });
}

/** Every organization there is. */
export async function organizations(): Promise<{ id: string; name: string; slug: string }[]> {
  const db = createDb(bindings.DB, { session: "first-primary" });
  return db.all(sql`SELECT id, name, slug FROM organization ORDER BY name`);
}

/** Wake every subscriber, of every organization, whose stream has gone past what it acknowledged. */
export async function recheckAll() {
  for (const { id } of await organizations()) await streamsOf(id).recheckAll(bindings, ORIGIN);
}

/** Remove every stream past its expiry (a read would, on finding it). */
export const sweep = () => sweepExpired(d1, bindings, ORIGIN);
