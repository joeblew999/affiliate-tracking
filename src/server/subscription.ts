// One subscription (PROTOCOL.md, sections 6 and 7): the streams it's linked to and how far each has
// been acknowledged, and the wake it has out, if any. A subscriber is woken when a linked stream has
// something past what's acknowledged, works through it, and acknowledges; until then the wake is
// held on a lease, and when the lease runs out the subscriber is woken again.
//
// The behaviour is the Durable Streams reference server's (durable-streams/durable-streams,
// packages/server/src/subscription-manager.ts, Apache-2.0). That one keeps everything in memory, on
// timers. This is Void's durable state: a saved value, methods run one at a time, and an alarm. So
// a method only changes the value and says when the alarm is due; the alarm does the sending (a
// wake to a webhook, a wake event onto a stream), and what's due survives a restart.
import type { DurableStateContext, DurableStateDefinition } from "void/durable";
import { globMatch, relative } from "./glob.ts";
import { newToken, newTokenSecret, randomHex, readToken, signWebhook } from "./keys.ts";
import type { SigningKey } from "./keys.ts";

export const DEFAULT_LEASE_MS = 30_000;
export const MIN_LEASE_MS = 1_000;
export const MAX_LEASE_MS = 10 * 60_000;
/** A stream with nothing in it ends here. */
export const ZERO_OFFSET = "0000000000000000_0000000000000000";
/** Before a stream's first event: everything in it is still to do. */
const BEFORE_FIRST = "-1";
const MAX_RETRY_MS = 60_000;
/** How long a subscriber gets to answer a wake before it counts as failed. */
const DELIVERY_MS = 10_000;

export type ErrorCode =
  | "INVALID_REQUEST"
  | "SUBSCRIPTION_NOT_FOUND"
  | "SUBSCRIPTION_ALREADY_EXISTS"
  | "WEBHOOK_URL_REJECTED"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED"
  | "FENCED"
  | "ALREADY_CLAIMED"
  | "NO_PENDING_WORK"
  | "INVALID_OFFSET";

/** What a subscription is asked to be (the body of its PUT, checked). */
export type SubscriptionInput = {
  type: "webhook" | "pull-wake";
  pattern?: string;
  streams: string[];
  webhook?: { url: string };
  wake_stream?: string;
  lease_ttl_ms: number;
  description?: string;
};

type LinkType = "glob" | "explicit";

/** A stream the subscription follows: how it came to (by name, by the pattern), and how far. */
type Link = { link_types: LinkType[]; acked_offset: string; tail_offset: string };

/** A stream to link, with where it ends now. */
export type NewLink = { path: string; type: LinkType; tail: string };

/** What a subscriber sends to acknowledge, extend or give back a wake. */
export type WakeRequest = {
  wake_id?: string;
  generation?: number;
  acks?: { stream?: string; path?: string; offset: string }[];
  done?: boolean;
};

/** An answer to send back: its status, and its JSON body if it has one. */
export type Answer = { status: number; body?: Record<string, unknown> };

export type SubscriptionState = {
  /** What it was asked to be. Null until it's made, and again once it's deleted. */
  record: null | {
    id: string;
    type: "webhook" | "pull-wake";
    pattern?: string;
    webhook?: { url: string };
    wake_stream?: string;
    lease_ttl_ms: number;
    description?: string;
    created_at: string;
    status: "active" | "failed";
    config_hash: string;
  };
  /** Where the streams are served: the address ("https://host/v1/stream") and its path part. */
  base: string;
  root: string;
  /** The server's key its wakes are signed with, and the secret its own tokens are signed with. */
  signing: SigningKey | null;
  token_secret: string;
  streams: Record<string, Link>;
  /** Counts the wakes; a request about an older wake is refused. */
  generation: number;
  wake_id: string | null;
  /** Where each stream ended when the wake was made: what a plain "done" acknowledges. */
  wake_snapshot: Record<string, string>;
  token: string | null;
  holder: string | null;
  /** When the current wake's lease runs out. */
  lease_until: number | null;
  retry_count: number;
  /** When the wake is next to be sent to the webhook: now, or after a failed try. */
  deliver_at: number | null;
  next_attempt_at: number | null;
  /** Wake events still to be written to the wake stream (pull-wake), and when to write them. */
  wake_events: { stream: string; generation: number; ts: number }[];
  wake_events_at: number | null;
};

/** What the subscription's object can reach: the streams' own Durable Objects. */
export type StreamsBindings = Record<string, unknown>;

type Context = DurableStateContext<SubscriptionState, StreamsBindings>;

const initialState = (): SubscriptionState => ({
  record: null,
  base: "",
  root: "",
  signing: null,
  token_secret: "",
  streams: {},
  generation: 0,
  wake_id: null,
  wake_snapshot: {},
  token: null,
  holder: null,
  lease_until: null,
  retry_count: 0,
  deliver_at: null,
  next_attempt_at: null,
  wake_events: [],
  wake_events_at: null,
});

const failure = (status: number, code: ErrorCode, message: string): Answer => ({
  status,
  body: { error: { code, message } },
});
const NOT_FOUND = failure(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");

const isIpv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
const isLocalDev = (host: string) => host === "localhost" || /^127(\.\d{1,3}){3}$/.test(host);

function isPrivateIpv4(host: string): boolean {
  const [a = 0, b = 0] = host.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Whether a webhook address may be called (section 6.2): https, and not into a private network;
 * plain http only to this machine, for development.
 */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "webhook.url must be a valid URL";
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:")
    return isLocalDev(host)
      ? null
      : "http webhook URLs are only allowed for localhost or 127.0.0.x";
  if (url.protocol !== "https:") return "webhook.url must use https";
  if (host === "localhost") return "localhost webhook URLs must use http for dev";
  if (isIpv4(host) && isPrivateIpv4(host))
    return "webhook.url must not target private or link-local hosts";
  if (host.startsWith("[")) return "IPv6 webhook hosts are not accepted";
  return null;
}

const subjectOf = (state: SubscriptionState) => `subscription:${state.record?.id ?? ""}`;

function link(state: SubscriptionState, path: string, type: LinkType, acked: string, tail: string) {
  const name = relative(path);
  const existing = state.streams[name];
  if (existing) {
    if (!existing.link_types.includes(type)) existing.link_types.push(type);
    if (tail > existing.tail_offset) existing.tail_offset = tail;
    return;
  }
  state.streams[name] = { link_types: [type], acked_offset: acked, tail_offset: tail };
}

/** Each linked stream as subscribers are told of it. */
function streamInfos(state: SubscriptionState) {
  return Object.entries(state.streams).map(([path, linked]) => ({
    path,
    link_type: linked.link_types.includes("explicit") ? ("explicit" as const) : ("glob" as const),
    acked_offset: linked.acked_offset,
    tail_offset: linked.tail_offset,
    has_pending: linked.tail_offset > linked.acked_offset,
  }));
}

const firstPending = (state: SubscriptionState) =>
  streamInfos(state).find((stream) => stream.has_pending)?.path;

/** The subscription as its GET shows it. */
function serialize(state: SubscriptionState): Record<string, unknown> | null {
  const record = state.record;
  if (!record) return null;
  return {
    id: record.id,
    subscription_id: record.id,
    type: record.type,
    pattern: record.pattern,
    streams: streamInfos(state).map(({ path, link_type, acked_offset }) => ({
      path,
      link_type,
      acked_offset,
    })),
    webhook: record.webhook && {
      url: record.webhook.url,
      signing: {
        alg: "ed25519",
        kid: state.signing?.public.kid,
        jwks_url: `${state.base}/__ds/jwks.json`,
      },
    },
    wake_stream: record.wake_stream,
    lease_ttl_ms: record.lease_ttl_ms,
    created_at: record.created_at,
    status: record.status,
    description: record.description,
  };
}

/** The wake over: nothing held, no lease. */
function endWake(state: SubscriptionState) {
  state.lease_until = null;
  state.token = null;
  state.holder = null;
  state.wake_id = null;
  state.wake_snapshot = {};
}

/** A new wake: the next generation, what each stream holds now, and it's due to be sent. */
async function createWake(state: SubscriptionState, triggeredBy: string) {
  const record = state.record;
  if (!record) return;
  const now = Date.now();
  state.generation++;
  state.wake_id = `w_${randomHex(12)}`;
  state.wake_snapshot = Object.fromEntries(
    Object.entries(state.streams).map(([path, linked]) => [path, linked.tail_offset]),
  );
  if (record.type === "webhook") {
    state.token = await newToken(state.token_secret, subjectOf(state), state.generation);
    state.lease_until = now + record.lease_ttl_ms;
    state.deliver_at = now;
    return;
  }
  state.wake_events.push({ stream: triggeredBy, generation: state.generation, ts: now });
  state.wake_events_at ??= now;
}

async function wakeIfPending(state: SubscriptionState): Promise<boolean> {
  const pending = firstPending(state);
  if (pending === undefined) return false;
  await createWake(state, pending);
  return true;
}

/** The alarm set for whatever is due first, or cleared when nothing is. */
async function arm(context: Context) {
  const state = context.state;
  const due = [state.lease_until, state.deliver_at, state.wake_events_at].filter(
    (at): at is number => at !== null,
  );
  if (due.length === 0) await context.deleteAlarm();
  else await context.setAlarm(Math.min(...due));
}

/** Refuse a request that isn't about the current wake, or whose token isn't this subscription's. */
async function fenced(
  state: SubscriptionState,
  token: string,
  request: WakeRequest,
): Promise<Answer | null> {
  const read = await readToken(state.token_secret, subjectOf(state), token);
  if ("code" in read)
    return failure(
      401,
      read.code,
      read.code === "TOKEN_EXPIRED" ? "Token expired" : "Token invalid",
    );
  if (
    read.generation !== state.generation ||
    request.generation !== state.generation ||
    request.wake_id !== state.wake_id
  )
    return failure(409, "FENCED", "Wake generation is stale");
  return null;
}

/** Move each acknowledged stream's place on, all or none: never back, never past its end. */
function applyAcks(state: SubscriptionState, request: WakeRequest): Answer | null {
  if (!request.acks) return null;
  const moves: [Link, string][] = [];
  for (const ack of request.acks) {
    const linked = state.streams[relative(ack.stream ?? ack.path ?? "")];
    if (!linked)
      return failure(409, "INVALID_OFFSET", "Ack references an unknown subscription stream");
    if (ack.offset === BEFORE_FIRST)
      return failure(409, "INVALID_OFFSET", "Ack offset must not be -1");
    if (ack.offset < linked.acked_offset)
      return failure(409, "INVALID_OFFSET", "Ack offset regresses the committed cursor");
    if (ack.offset > linked.tail_offset)
      return failure(409, "INVALID_OFFSET", "Ack offset is beyond stream tail");
    moves.push([linked, ack.offset]);
  }
  for (const [linked, offset] of moves) linked.acked_offset = offset;
  return null;
}

/** An acknowledgement, from a webhook's callback or a pull-wake worker: the same either way. */
async function acknowledge(context: Context, token: string, request: WakeRequest): Promise<Answer> {
  const state = context.state;
  const stale = await fenced(state, token, request);
  if (stale) return stale;
  const bad = applyAcks(state, request);
  if (bad) return bad;
  // Any valid acknowledgement keeps the lease going; "done" ends the wake.
  state.lease_until = Date.now() + (state.record?.lease_ttl_ms ?? DEFAULT_LEASE_MS);
  let next = false;
  if (request.done === true) {
    endWake(state);
    state.deliver_at = null;
    next = await wakeIfPending(state);
  }
  await arm(context);
  return { status: 200, body: { ok: true, next_wake: next } };
}

export type SubscriptionOptions = {
  /**
   * The streams server (src/server/d1's createD1Streams), which a pull-wake's wake events are written
   * to its wake stream through.
   */
  write: (env: StreamsBindings, request: Request) => Promise<Response>;
  /**
   * How a wake reaches a webhook: the runtime's fetch unless the app has a better way to the
   * subscriber, such as a service binding.
   */
  deliver?: (env: StreamsBindings, url: string, init: RequestInit) => Promise<Response>;
};

/** Send the current wake to the webhook; a failure tries again later, a little longer each time. */
async function deliver(context: Context, options: SubscriptionOptions) {
  const state = context.state;
  const record = state.record;
  state.deliver_at = null;
  if (!record?.webhook || !state.wake_id || !state.token || !state.signing) return;
  const body = JSON.stringify({
    subscription_id: record.id,
    wake_id: state.wake_id,
    generation: state.generation,
    streams: streamInfos(state),
    callback_url: `${state.base}/__ds/subscriptions/${encodeURIComponent(record.id)}/callback`,
    callback_token: state.token,
  });
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-signature": await signWebhook(state.signing, body),
    },
    body,
    signal: AbortSignal.timeout(DELIVERY_MS),
  };
  const retry = () => {
    state.retry_count++;
    const delay = Math.min(1000 * 2 ** Math.max(0, state.retry_count - 1), MAX_RETRY_MS);
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    record.status = "failed";
    state.next_attempt_at = state.deliver_at = Date.now() + Math.max(0, Math.round(delay + jitter));
  };
  try {
    const send = options.deliver ?? ((_env, url, request) => fetch(url, request));
    const response = await send(context.env, record.webhook.url, init);
    if (!response.ok) return retry();
    record.status = "active";
    state.retry_count = 0;
    state.next_attempt_at = null;
    const answered = (await response.json().catch(() => null)) as { done?: boolean } | null;
    // The subscriber finished there and then: everything the wake showed is acknowledged.
    if (answered?.done === true) {
      for (const [path, tail] of Object.entries(state.wake_snapshot)) {
        const linked = state.streams[path];
        if (linked) linked.acked_offset = tail;
      }
      endWake(state);
      await wakeIfPending(state);
    }
  } catch (error) {
    console.warn("streams: webhook delivery failed", record.id, error);
    retry();
  }
}

/** Write the waiting wake events to the wake stream (pull-wake), which the app has to have made. */
async function writeWakeEvents(context: Context, options: SubscriptionOptions) {
  const state = context.state;
  const events = state.wake_events;
  state.wake_events = [];
  state.wake_events_at = null;
  const wakeStream = state.record?.wake_stream;
  if (!wakeStream || events.length === 0) return;
  const url = new URL(`${state.base}/${wakeStream}`);
  // To the streams server as a request for the stream's own path (it serves streams at their path).
  const response = await options.write(
    context.env,
    new Request(new URL(url.pathname, url.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        events.map((event) => ({ type: "wake", subscription_id: state.record?.id, ...event })),
      ),
    }),
  );
  if (response.status === 404) console.warn("streams: wake stream does not exist", wakeStream);
  else if (!response.ok) {
    // Kept, and tried again in a second.
    state.wake_events = events;
    state.wake_events_at = Date.now() + 1000;
    console.warn("streams: wake stream refused", wakeStream, response.status);
  }
}

const methods = {
  /** Make the subscription, or confirm it's already this (the same request made again). */
  async create(
    context: Context,
    id: string,
    input: SubscriptionInput,
    configHash: string,
    links: NewLink[],
    where: { base: string; root: string; signing: SigningKey },
  ): Promise<
    | { created: boolean; subscription: Record<string, unknown> }
    | { error: { code: ErrorCode; message: string } }
  > {
    const existing = context.state.record;
    if (existing) {
      if (existing.config_hash !== configHash)
        return {
          error: {
            code: "SUBSCRIPTION_ALREADY_EXISTS",
            message: "Subscription already exists with different configuration",
          },
        };
      return { created: false, subscription: serialize(context.state) ?? {} };
    }
    if (input.type === "webhook") {
      if (!input.webhook)
        return {
          error: { code: "INVALID_REQUEST", message: "webhook subscriptions require webhook.url" },
        };
      const problem = webhookUrlProblem(input.webhook.url);
      if (problem) return { error: { code: "WEBHOOK_URL_REJECTED", message: problem } };
    }
    if (input.type === "pull-wake" && !input.wake_stream)
      return {
        error: { code: "INVALID_REQUEST", message: "pull-wake subscriptions require wake_stream" },
      };
    // Everything new, tokens' secret included: nothing from a deleted one of the same id applies.
    const state = initialState();
    state.record = {
      id,
      type: input.type,
      pattern: input.pattern,
      webhook: input.webhook && { url: input.webhook.url },
      wake_stream: input.wake_stream,
      lease_ttl_ms: input.lease_ttl_ms,
      description: input.description,
      created_at: new Date().toISOString(),
      status: "active",
      config_hash: configHash,
    };
    state.base = where.base;
    state.root = where.root;
    state.signing = where.signing;
    state.token_secret = newTokenSecret();
    // Streams already there are followed from where they end now: their past isn't replayed.
    for (const each of links) link(state, each.path, each.type, each.tail, each.tail);
    context.state = state;
    await context.deleteAlarm();
    return { created: true, subscription: serialize(state) ?? {} };
  },

  read(context: Context) {
    return serialize(context.state);
  },

  /** Delete it. Says what it followed, for the directory to forget. */
  async remove(context: Context) {
    const record = context.state.record;
    const explicit = Object.entries(context.state.streams)
      .filter(([, linked]) => linked.link_types.includes("explicit"))
      .map(([path]) => path);
    context.state = initialState();
    await context.deleteAlarm();
    return { existed: record !== null, pattern: record?.pattern, streams: explicit };
  },

  /** Follow more streams by name, from where each ends now. */
  addStreams(context: Context, links: { path: string; tail: string }[]): boolean {
    if (!context.state.record) return false;
    for (const each of links) link(context.state, each.path, "explicit", each.tail, each.tail);
    return true;
  },

  /** Stop following a stream by name; it stays followed if the pattern covers it. */
  removeStream(context: Context, path: string): boolean {
    const state = context.state;
    if (!state.record) return false;
    const name = relative(path);
    const linked = state.streams[name];
    if (!linked) return true;
    linked.link_types = linked.link_types.filter((type) => type !== "explicit");
    if (linked.link_types.length === 0) delete state.streams[name];
    return true;
  },

  /** A stream was written to and now ends at `tail`: wake the subscriber if it isn't already. */
  async appended(context: Context, path: string, tail: string): Promise<void> {
    const state = context.state;
    const record = state.record;
    if (!record) return;
    const name = relative(path);
    // A stream the pattern covers, first heard of now: all of it is still to do.
    if (record.pattern && globMatch(record.pattern, name))
      link(state, name, "glob", state.streams[name]?.acked_offset ?? BEFORE_FIRST, tail);
    const linked = state.streams[name];
    if (!linked) return;
    if (tail > linked.tail_offset) linked.tail_offset = tail;
    if (!state.wake_id && !state.holder) await wakeIfPending(state);
    await arm(context);
  },

  /** A stream was deleted: no longer followed. */
  deleted(context: Context, path: string): void {
    delete context.state.streams[relative(path)];
  },

  /** A webhook subscriber's callback: acknowledge, and with `done`, finish the wake. */
  async callback(context: Context, token: string, request: WakeRequest): Promise<Answer> {
    if (!context.state.record) return NOT_FOUND;
    return acknowledge(context, token, request);
  },

  /** A pull-wake worker takes the wake: one holder at a time, on a lease. */
  async claim(context: Context, worker: string): Promise<Answer> {
    const state = context.state;
    const record = state.record;
    if (!record) return NOT_FOUND;
    if (record.type !== "pull-wake")
      return failure(400, "INVALID_REQUEST", "Subscription is not pull-wake");
    if (state.holder)
      return {
        status: 409,
        body: {
          error: {
            code: "ALREADY_CLAIMED",
            current_holder: state.holder,
            generation: state.generation,
          },
        },
      };
    const pending = firstPending(state);
    if (pending === undefined)
      return failure(409, "NO_PENDING_WORK", "Subscription has no pending work");
    if (!state.wake_id) await createWake(state, pending);
    state.holder = worker;
    state.token = await newToken(state.token_secret, subjectOf(state), state.generation);
    state.lease_until = Date.now() + record.lease_ttl_ms;
    await arm(context);
    return {
      status: 200,
      body: {
        wake_id: state.wake_id,
        generation: state.generation,
        token: state.token,
        streams: streamInfos(state),
        lease_ttl_ms: record.lease_ttl_ms,
      },
    };
  },

  /** A pull-wake worker's acknowledgement; without `done` it only keeps the lease. */
  async ack(context: Context, token: string, request: WakeRequest): Promise<Answer> {
    const record = context.state.record;
    if (!record) return NOT_FOUND;
    if (record.type !== "pull-wake")
      return failure(400, "INVALID_REQUEST", "Subscription is not pull-wake");
    return acknowledge(context, token, request);
  },

  /** A pull-wake worker gives the wake back, acknowledging nothing. */
  async release(context: Context, token: string, request: WakeRequest): Promise<Answer> {
    const state = context.state;
    const record = state.record;
    if (!record) return NOT_FOUND;
    if (record.type !== "pull-wake")
      return failure(400, "INVALID_REQUEST", "Subscription is not pull-wake");
    const stale = await fenced(state, token, request);
    if (stale) return stale;
    endWake(state);
    await wakeIfPending(state);
    await arm(context);
    return { status: 204 };
  },
};

export type SubscriptionMethods = typeof methods;

/**
 * The subscription, for Void's `defineDurableState` in an app's `durable-objects/`. One object per
 * subscription, by its id.
 */
export function subscriptionState(
  options: SubscriptionOptions,
): DurableStateDefinition<SubscriptionState, StreamsBindings, SubscriptionMethods> {
  return {
    initialState,
    methods,
    /** Whatever is due: wake events to write, a lease run out, a wake to send. */
    async alarm(context) {
      const state = context.state;
      if (!state.record) return;
      if (state.wake_events_at !== null && state.wake_events_at <= Date.now())
        await writeWakeEvents(context, options);
      // Nobody acknowledged in time: the wake is over, and if there's still work, a new one starts.
      if (state.lease_until !== null && state.lease_until <= Date.now()) {
        endWake(state);
        await wakeIfPending(state);
      }
      if (state.deliver_at !== null && state.deliver_at <= Date.now())
        await deliver(context, options);
      await arm(context);
    },
  };
}
