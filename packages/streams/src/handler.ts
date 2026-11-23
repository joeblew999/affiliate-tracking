// Durable Streams with subscriptions, for a Void app: the protocol's own server
// (@durable-streams/server-cloudflare, which has no subscriptions) with the reserved subscription
// routes in front of it (PROTOCOL.md, section 6), and every write told to the subscriptions that
// follow the stream.
//
// Mounted at a root, such as /v1/stream: streams are at <root>/<path>, and the subscription
// routes at <root>/__ds/. Who may call any of it is for the app's route to decide before this.
import type { DurableStateApi } from "void/durable";
import { ANY, shardOf, type DirectoryMethods } from "./directory.ts";
import { relative } from "./glob.ts";
import { sha256Hex } from "./keys.ts";
import type { SigningMethods } from "./signing.ts";
import {
  DEFAULT_LEASE_MS,
  MAX_LEASE_MS,
  MIN_LEASE_MS,
  ZERO_OFFSET,
  type Answer,
  type ErrorCode,
  type NewLink,
  type SubscriptionInput,
  type SubscriptionMethods,
  type WakeRequest,
} from "./subscription.ts";

export type StreamsOptions<Env> = {
  /** Where it's mounted: the path before a stream's own, such as "/v1/stream". */
  root: string;
  /** The protocol server: `createStreamsHandler()` from @durable-streams/server-cloudflare. */
  streams: (request: Request, env: Env) => Promise<Response>;
  /** The app's three durable states (its `durable-objects/`), made from this package's. */
  subscriptions: DurableStateApi<SubscriptionMethods>;
  directory: DurableStateApi<DirectoryMethods>;
  signing: DurableStateApi<SigningMethods>;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const refuse = (status: number, code: ErrorCode, message: string) =>
  json(status, { error: { code, message } });
const answer = ({ status, body }: Answer) =>
  body === undefined ? new Response(null, { status }) : json(status, body);
const notAllowed = () => new Response("Method not allowed", { status: 405 });

const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  SUBSCRIPTION_NOT_FOUND: 404,
  SUBSCRIPTION_ALREADY_EXISTS: 409,
  WEBHOOK_URL_REJECTED: 400,
  TOKEN_INVALID: 401,
  TOKEN_EXPIRED: 401,
  FENCED: 409,
  ALREADY_CLAIMED: 409,
  NO_PENDING_WORK: 409,
  INVALID_OFFSET: 409,
};

/** A subscription's PUT body, checked. */
function readInput(value: unknown): SubscriptionInput | string {
  if (!value || typeof value !== "object") return "Request body must be a JSON object";
  const body = value as Record<string, unknown>;
  const type = body.type;
  if (type !== "webhook" && type !== "pull-wake") return 'type must be "webhook" or "pull-wake"';
  const pattern =
    typeof body.pattern === "string" && body.pattern.length > 0
      ? relative(body.pattern)
      : undefined;
  const named = Array.isArray(body.streams) ? (body.streams as unknown[]) : [];
  if (named.some((stream) => typeof stream !== "string"))
    return "streams must contain only strings";
  const streams = (named as string[]).map(relative);
  if (!pattern && streams.length === 0) return "At least one of pattern or streams is required";
  const lease = body.lease_ttl_ms === undefined ? DEFAULT_LEASE_MS : body.lease_ttl_ms;
  if (
    typeof lease !== "number" ||
    !Number.isInteger(lease) ||
    lease < MIN_LEASE_MS ||
    lease > MAX_LEASE_MS
  )
    return "lease_ttl_ms must be an integer from 1000 to 600000";
  let webhook: { url: string } | undefined;
  if (type === "webhook") {
    const url = (body.webhook as { url?: unknown } | undefined)?.url;
    if (typeof url !== "string" || url.length === 0)
      return "webhook subscriptions require webhook.url";
    webhook = { url };
  }
  const wakeStream =
    typeof body.wake_stream === "string" && body.wake_stream.length > 0
      ? relative(body.wake_stream)
      : undefined;
  if (type === "pull-wake" && !wakeStream) return "pull-wake subscriptions require wake_stream";
  return {
    type,
    pattern,
    streams,
    webhook,
    wake_stream: wakeStream,
    lease_ttl_ms: lease,
    description: typeof body.description === "string" ? body.description : undefined,
  };
}

/** The same request gives the same hash, whatever order its streams came in. */
const configHash = (input: SubscriptionInput) =>
  sha256Hex(
    JSON.stringify({
      type: input.type,
      pattern: input.pattern,
      streams: [...new Set(input.streams)].sort(),
      webhook: input.webhook && { url: input.webhook.url },
      wake_stream: input.wake_stream,
      lease_ttl_ms: input.lease_ttl_ms,
      description: input.description,
    }),
  );

const bearer = (request: Request) => {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
};

/** A request's JSON body; nothing sent is an empty object. */
async function bodyOf(request: Request): Promise<unknown> {
  const raw = await request.text();
  return raw.length > 0 ? JSON.parse(raw) : {};
}

/**
 * The streams: `handle` for a route that catches everything under the root, and the same things
 * for the app's own code to do without a request (append, subscribe, recheck).
 */
export function createStreams<Env>(options: StreamsOptions<Env>) {
  const root = `/${relative(options.root)}`;
  const control = `${root}/__ds`;
  const { subscriptions, directory, signing } = options;

  /** Where a stream ends now; a stream that isn't there ends at the start. */
  async function tailOf(base: string, path: string, env: Env): Promise<string> {
    const head = await options.streams(new Request(`${base}/${path}`, { method: "HEAD" }), env);
    return (head.ok && head.headers.get("stream-next-offset")) || ZERO_OFFSET;
  }

  async function subscription(request: Request, env: Env, id: string, base: string) {
    if (request.method === "PUT") {
      const input = readInput(await bodyOf(request));
      if (typeof input === "string") return refuse(400, "INVALID_REQUEST", input);
      // The streams to follow from the start: those named, and those there that the pattern covers.
      const paths = new Map<string, NewLink["type"]>();
      if (input.pattern && shardOf(input.pattern) !== ANY)
        for (const path of await directory.get(shardOf(input.pattern)).covered(input.pattern))
          paths.set(path, "glob");
      for (const path of input.streams) paths.set(path, "explicit");
      const links = await Promise.all(
        [...paths].map(async ([path, type]) => ({
          path,
          type,
          tail: await tailOf(base, path, env),
        })),
      );
      const result = await subscriptions.get(id).create(id, input, await configHash(input), links, {
        base,
        root,
        signing: await signing.get("signing").key(),
      });
      if ("error" in result)
        return refuse(ERROR_STATUS[result.error.code], result.error.code, result.error.message);
      if (input.pattern)
        await directory.get(shardOf(input.pattern)).follow(id, { pattern: input.pattern });
      await Promise.all(
        input.streams.map((stream) => directory.get(shardOf(stream)).follow(id, { stream })),
      );
      return json(result.created ? 201 : 200, result.subscription);
    }
    if (request.method === "GET") {
      const found = await subscriptions.get(id).read();
      return found
        ? json(200, found)
        : refuse(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
    }
    if (request.method === "DELETE") {
      const was = await subscriptions.get(id).remove();
      const shards = new Set(was.streams.map(shardOf));
      if (was.pattern) shards.add(shardOf(was.pattern));
      await Promise.all([...shards].map((shard) => directory.get(shard).forget(id)));
      return new Response(null, { status: 204 });
    }
    return notAllowed();
  }

  async function controlRoute(request: Request, env: Env, url: URL): Promise<Response> {
    const base = `${url.origin}${root}`;
    const rest = url.pathname.slice(control.length + 1);
    if (rest === "jwks.json") {
      if (request.method !== "GET") return notAllowed();
      const key = await signing.get("signing").key();
      return json(
        200,
        { keys: [key.public] },
        { "content-type": "application/jwk-set+json", "cache-control": "public, max-age=300" },
      );
    }
    const [area, rawId, action, ...more] = rest.split("/");
    const id = rawId ? decodeURIComponent(rawId) : "";
    if (area !== "subscriptions" || !id)
      return refuse(404, "SUBSCRIPTION_NOT_FOUND", "Durable Streams control route not found");
    const one = subscriptions.get(id);
    try {
      if (action === undefined) return await subscription(request, env, id, base);
      if (action === "streams" && more.length === 0) {
        if (request.method !== "POST") return notAllowed();
        const named = ((await bodyOf(request)) as { streams?: unknown }).streams;
        if (
          !Array.isArray(named) ||
          named.some((stream) => typeof stream !== "string" || stream.length === 0)
        )
          return refuse(400, "INVALID_REQUEST", "streams must be a non-empty string array");
        const paths = (named as string[]).map(relative);
        const links = await Promise.all(
          paths.map(async (path) => ({ path, tail: await tailOf(base, path, env) })),
        );
        if (!(await one.addStreams(links)))
          return refuse(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
        await Promise.all(
          paths.map((stream) => directory.get(shardOf(stream)).follow(id, { stream })),
        );
        return new Response(null, { status: 204 });
      }
      if (action === "streams") {
        if (request.method !== "DELETE") return notAllowed();
        const stream = relative(decodeURIComponent(more.join("/")));
        if (!(await one.removeStream(stream)))
          return refuse(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
        await directory.get(shardOf(stream)).unfollow(id, stream);
        return new Response(null, { status: 204 });
      }
      if (more.length === 0 && request.method === "POST") {
        if (action === "claim") {
          const worker = ((await bodyOf(request)) as { worker?: unknown }).worker;
          if (typeof worker !== "string" || worker.length === 0)
            return refuse(400, "INVALID_REQUEST", "worker must be a non-empty string");
          return answer(await one.claim(worker));
        }
        if (action === "callback" || action === "ack" || action === "release") {
          const token = bearer(request);
          if (!token)
            return refuse(401, "TOKEN_INVALID", "Missing or malformed Authorization header");
          return answer(await one[action](token, (await bodyOf(request)) as WakeRequest));
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) return refuse(400, "INVALID_REQUEST", "Invalid JSON body");
      throw error;
    }
    return refuse(404, "SUBSCRIPTION_NOT_FOUND", "Durable Streams control route not found");
  }

  /**
   * After a write the server accepted: tell the subscriptions that follow the stream. Answers
   * with the ones told of something new.
   */
  async function told(request: Request, response: Response, path: string): Promise<string[]> {
    const created = request.method === "PUT" && response.status === 201;
    const appended =
      request.method === "POST" && (response.status === 200 || response.status === 204);
    const deleted = request.method === "DELETE" && response.status === 204;
    if (!created && !appended && !deleted) return [];
    const change = created ? "created" : deleted ? "deleted" : undefined;
    const shards = new Set([shardOf(path), ANY]);
    const ids = [
      ...new Set(
        (
          await Promise.all([...shards].map((shard) => directory.get(shard).written(path, change)))
        ).flat(),
      ),
    ];
    const tail = response.headers.get("stream-next-offset");
    // A new stream with nothing in it yet has nothing to wake anyone for.
    const news = !deleted && tail !== null && tail > ZERO_OFFSET;
    await Promise.all(
      ids.map(async (id) => {
        if (deleted) await subscriptions.get(id).deleted(path);
        else if (news) await subscriptions.get(id).appended(path, tail);
      }),
    );
    return news ? ids : [];
  }

  /** A request to a stream: the server's answer, and the subscriptions told of what it wrote. */
  async function stream(request: Request, env: Env) {
    const url = new URL(request.url);
    const response = await options.streams(request, env);
    let subscribers: string[] = [];
    if (url.pathname.startsWith(`${root}/`)) {
      try {
        subscribers = await told(request, response, url.pathname.slice(root.length + 1));
      } catch (error) {
        // The write itself stands. The subscribers hear of it with the stream's next write, or
        // at the next check (recheck).
        console.error("streams: couldn't tell subscribers of a write to", url.pathname, error);
      }
    }
    return { response, subscribers };
  }

  const JSON_TYPE = { "content-type": "application/json" };

  return {
    /** Any request under the root, from a route that catches them all. */
    async handle(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === control || url.pathname.startsWith(`${control}/`))
        return controlRoute(request, env, url);
      return (await stream(request, env)).response;
    },

    /**
     * From the app's own code: add events to a JSON stream, making the stream if it isn't there.
     * `origin` is the address the app is served at. Answers with where the stream now ends, and
     * the subscriptions that were told.
     */
    async append(env: Env, origin: string, path: string, events: unknown) {
      const url = `${origin}${root}/${relative(path)}`;
      const add = () =>
        stream(
          new Request(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify(events) }),
          env,
        );
      let added = await add();
      if (added.response.status === 404) {
        await stream(new Request(url, { method: "PUT", headers: JSON_TYPE }), env);
        added = await add();
      }
      if (!added.response.ok)
        throw new Error(`stream ${path}: ${added.response.status} ${await added.response.text()}`);
      return {
        offset: added.response.headers.get("stream-next-offset") ?? ZERO_OFFSET,
        subscribers: added.subscribers,
      };
    },

    /**
     * From the app's own code: make sure a subscription is there (the same request as its PUT).
     * Answers whether it was made now.
     */
    async subscribe(env: Env, origin: string, id: string, input: Record<string, unknown>) {
      const response = await controlRoute(
        new Request(`${origin}${control}/subscriptions/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: JSON_TYPE,
          body: JSON.stringify(input),
        }),
        env,
        new URL(`${origin}${control}/subscriptions/${encodeURIComponent(id)}`),
      );
      if (!response.ok)
        throw new Error(`subscription ${id}: ${response.status} ${await response.text()}`);
      return response.status === 201;
    },

    /**
     * Look at where each stream a subscription follows by name ends now, and wake the subscriber
     * if that's past what it has acknowledged. For a wake lost between a write and telling the
     * subscribers: run now and then (a daily job).
     */
    async recheck(env: Env, origin: string, id: string): Promise<void> {
      const found = (await subscriptions.get(id).read()) as {
        streams: { path: string }[];
      } | null;
      if (!found) return;
      const base = `${origin}${root}`;
      await Promise.all(
        found.streams.map(async ({ path }) => {
          const tail = await tailOf(base, path, env);
          if (tail > ZERO_OFFSET) await subscriptions.get(id).appended(path, tail);
        }),
      );
    },
  };
}
