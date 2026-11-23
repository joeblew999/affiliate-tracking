// The control plane's server side, the same for any Void app: wrappers on the ways work runs
// (requests, queues, scheduled jobs, emails) that report each step as it runs, so the events come
// from the work itself and the app's own code never reports anything.
//
// Which action a step belongs to travels with the work: in AsyncLocalStorage (from node:async_hooks,
// which Void's nodejs_als flag provides) within a request or a queue message; on each queued
// message (`activity`, beside its body); and on calls to the other app (the x-activity header).
import { defineMiddleware, defineQueue as voidQueue, defineScheduled as voidScheduled } from "void";
import { sendEmail as voidSendEmail } from "void/email";
import { queues as voidQueues } from "void/queues";
import type { ActivityEvent, Step, StepStatus } from "./model.ts";
import { current, HEADER, type Trace, type Viewers } from "./trace.ts";

export { activityHeaders, type Trace, type Viewers } from "./trace.ts";

/** A queued message: the app's body, and the action it belongs to. */
export type Traced<Body> = { body: Body; activity: Trace & { stepId: string } };

/** Where events go: the control plane (the viewers' streams), directly or over a binding. */
export type Sink = (event: ActivityEvent, viewers: Viewers) => Promise<void>;

let app = "app";
let sink: Sink = async () => {};

/** Set once, at the start of each app's code: its name, and where its events go. */
export function setupActivity(options: { app: string; sink: Sink }) {
  app = options.app;
  sink = options.sink;
}

/** Report an event. A failure to report is logged, never thrown: it mustn't undo the work. */
async function report(event: ActivityEvent, viewers: Viewers) {
  try {
    await sink(event, viewers);
  } catch (error) {
    console.error("activity: couldn't record", event.type, error);
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A step's event. */
function step(
  trace: Trace,
  id: string,
  name: string,
  status: StepStatus,
  error: string | null,
  setCookies = false,
) {
  const s: Step = { id, name, app, status, error, at: Date.now(), setCookies };
  return report({ type: "step", actionId: trace.actionId, step: s }, trace.viewers);
}

/** Start an action: what started it, who, and who sees it. */
async function start(title: string, by: { id: string; name: string } | null): Promise<Trace> {
  const trace: Trace = {
    actionId: crypto.randomUUID(),
    viewers: by ? [by.id, "admins"] : ["admins"],
  };
  await report(
    { type: "started", actionId: trace.actionId, title, by: by?.name ?? null, at: Date.now() },
    trace.viewers,
  );
  return trace;
}

/** Run `work` as one step: running, then done, or failed with its error (and rethrown). */
async function asStep<T>(trace: Trace, id: string, name: string, work: () => Promise<T>) {
  await step(trace, id, name, "running", null);
  try {
    const result = await current.run(trace, work);
    await step(trace, id, name, "done", null);
    return result;
  } catch (error) {
    await step(trace, id, name, "failed", errorText(error));
    throw error;
  }
}

/** "bookEvent" → "Book event"; "sign-up/email" → "Sign up". */
function words(text: string) {
  const spaced = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_/]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** What a request is, for people: a page action's name, or the route. */
function titleOf(url: URL) {
  const actionName = [...url.searchParams.keys()][0];
  if (actionName && !url.searchParams.get(actionName)) return words(actionName);
  const path = url.pathname.replace(/^\/api\/(auth|host|affiliates)\//, "").replace(/\/email$/, "");
  return words(path) || "Request";
}

/** Why a response refused or failed, as the app said it. */
async function reasonOf(response: Response) {
  const text = await response
    .clone()
    .text()
    .catch(() => "");
  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    if (json.message || json.error) return `${response.status}: ${json.message ?? json.error}`;
  } catch {
    // not JSON
  }
  const message = /"message":\d+\},\d+,"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  return `${response.status}: ${
    message ??
    (text
      .replace(/<[^>]+>/g, " ")
      .trim()
      .slice(0, 300) ||
      "failed")
  }`;
}

/** Paths that aren't work: the control plane itself, and Void's and Cloudflare's own. */
const NOT_WORK = ["/activity/", "/__void/", "/cdn-cgi/", "/live"];

/**
 * Every request that does something (not a GET) is a step: of the action the other app sent it
 * for (the x-activity header), or the start of a new one, by whoever is signed in.
 */
export function activityMiddleware(
  who: (
    c: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  ) => { id: string; name: string } | null | Promise<{ id: string; name: string } | null>,
  /** More paths that aren't work, such as where the other app's events are recorded. */
  skip: string[] = [],
) {
  return defineMiddleware(async (c, next) => {
    const url = new URL(c.req.url);
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    if ([...NOT_WORK, ...skip].some((prefix) => url.pathname.startsWith(prefix))) return next();
    const title = titleOf(url);
    const sent = c.req.header(HEADER);
    const trace: Trace = sent ? (JSON.parse(sent) as Trace) : await start(title, await who(c));
    const id = crypto.randomUUID();
    await step(trace, id, title, "running", null);
    try {
      await current.run(trace, () => next());
    } catch (error) {
      await step(trace, id, title, "failed", errorText(error));
      throw error;
    }
    // Recorded once the response has gone, so "done" can't reach a page before the answer it's
    // about (Cloudflare's waitUntil: work that finishes after the response).
    const failed = c.res.status >= 400;
    const reason = failed ? await reasonOf(c.res) : null;
    const setCookies = c.res.headers.getSetCookie().length > 0;
    c.executionCtx.waitUntil(
      step(trace, id, title, failed ? "failed" : "done", reason, setCookies),
    );
  });
}

type QueueMap = typeof voidQueues;
type BodyOf<Q extends keyof QueueMap> =
  Parameters<QueueMap[Q]["send"]>[0] extends Traced<infer B> ? B : never;

/**
 * The app's queues, as Void's, each send a step of the current action: queued now, running and
 * done (or failed) when its consumer runs it. Sent outside any action, it starts one.
 */
export const queues = new Proxy(
  {} as { [Q in keyof QueueMap]: { send(body: BodyOf<Q>): Promise<void> } },
  {
    get(_target, name: string) {
      return {
        async send(body: unknown) {
          const trace = current.getStore() ?? (await start(words(name), null));
          const stepId = crypto.randomUUID();
          await step(trace, stepId, name, "queued", null);
          const queue = voidQueues[name as keyof QueueMap] as unknown as {
            send(message: Traced<unknown>): Promise<void>;
          };
          await queue.send({ body, activity: { ...trace, stepId } });
        },
      };
    },
  },
);

type Batch<Body> = {
  queue: string;
  messages: { body: Body; ack(): void; retry(options?: { delaySeconds?: number }): void }[];
};

/**
 * Void's defineQueue, each message a step of its action: running, then done, or failed with its
 * error (and retried by the queue, as Void does when a handler throws).
 */
export function defineQueue<Body>(
  handler: (
    batch: Batch<Body>,
    env: Parameters<Parameters<typeof voidQueue>[0]>[1],
  ) => Promise<void>,
  /** What each message's step is called, for people: the queue's name otherwise. */
  options: { step?: (body: Body) => string } = {},
) {
  return voidQueue<Traced<Body>>(async (batch, env) => {
    for (const msg of batch.messages) {
      const { body, activity } = msg.body;
      let decided = false;
      const one: Batch<Body> = {
        queue: batch.queue,
        messages: [
          {
            body,
            ack: () => {
              decided = true;
              msg.ack();
            },
            retry: (options) => {
              decided = true;
              msg.retry(options);
            },
          },
        ],
      };
      try {
        const name = options.step?.(body) ?? batch.queue;
        await asStep(activity, activity.stepId, name, () => handler(one, env));
        if (!decided) msg.ack();
      } catch {
        if (!decided) msg.retry();
      }
    }
  });
}

/** Void's defineScheduled, each run an action of its own, seen by admins. */
export function defineScheduled(
  title: string,
  handler: Parameters<typeof voidScheduled>[0],
): ReturnType<typeof voidScheduled> {
  return voidScheduled(async (controller, env, ctx) => {
    const trace = await start(title, null);
    await asStep(trace, crypto.randomUUID(), title, () =>
      Promise.resolve(handler(controller, env, ctx)),
    );
  });
}

/**
 * Void's sendEmail. An email sent adds nothing: the step sending it (an email batch, say) covers
 * it, so a run to many people stays one step each batch. One refused is a failed step of its own,
 * with why.
 */
export async function sendEmail(
  options: Parameters<typeof voidSendEmail>[0],
): ReturnType<typeof voidSendEmail> {
  const result = await voidSendEmail(options);
  const trace = current.getStore();
  if (trace && !result.ok) {
    const reason =
      "error" in result ? `${result.error.code}: ${result.error.message}` : "not delivered";
    await step(trace, crypto.randomUUID(), `email: ${options.subject}`, "failed", reason);
  }
  return result;
}
