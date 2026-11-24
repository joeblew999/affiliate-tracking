// The tests' way in without a browser: over the streams, as any worker of the program is. A
// watcher signs in through the shop's Better Auth, as a person does, and from then on does three
// things: makes a request (a page's action, or whatever a test sends), waits on its stream in the
// hub for the action that request started to finish (the control plane, packages/activity), and
// reads what that action did from its state stream (Durable State: apps/affiliates/src/outcomes.ts).
// The streams are read at the service's own /streams, with the sign-in's cookie, as a page reads
// them. Nothing waits and looks again: an action finishing is an event, and what it did is already
// written when it reads done.
import { FetchError, stream } from "@durable-streams/client";
import { isChangeEvent, MaterializedState, type StateEvent } from "@durable-streams/state";
import { createAuthClient } from "better-auth/client";
import { DEMO_PASSWORD, demoPeople } from "../../apps/affiliates/demo.ts";
import type { outcomes } from "../../apps/affiliates/src/outcomes.ts";
import {
  ActivityEvent,
  apply,
  stateStreamOf,
  type Action,
} from "../../packages/activity/src/model.ts";
import { AFFILIATES, SHOP } from "./helpers.ts";

/** A sale as the service writes it to the stream: its table's row. */
export type Sale = NonNullable<Parameters<(typeof outcomes)["sales"]["upsert"]>[0]["value"]>;

/** One of the demo's people signed in on the shop: the cookie their requests carry, and who they are. */
async function signIn(email: string) {
  const person = demoPeople.find((p) => p.email === email);
  if (!person) throw new Error(`${email} isn't one of the demo's people`);
  let cookies: string[] = [];
  const { data, error } = await createAuthClient({ baseURL: SHOP }).signIn.email({
    email,
    password: DEMO_PASSWORD,
    fetchOptions: {
      // As the shop's page sends it: Better Auth refuses a sign-in from no origin.
      headers: { origin: SHOP },
      onResponse: ({ response }) => void (cookies = response.headers.getSetCookie()),
    },
  });
  if (error) throw new Error(`${email} can't sign in: ${error.message}`);
  return {
    cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "),
    // Whose stream they read: an admin, everyone's; anyone else, their own.
    viewer: person.role === "admin" ? "admins" : data.user.id,
  };
}

const text = (action: Action) =>
  `${action.title}: ${action.steps.map((s) => `${s.name} ${s.status}${s.error ? ` (${s.error})` : ""}`).join("; ")}`;

/** Sign in as one of the demo's people and watch their streams from now on. */
export async function watch(email: string) {
  const { cookie, viewer } = await signIn(email);
  const headers = { cookie };
  const stop = new AbortController();
  const actions = new Map<string, Action>();
  let woken: (() => void)[] = [];

  // Their actions, live from where the stream ends now.
  const reading = await stream<unknown>({
    url: `${AFFILIATES}/streams/${viewer}`,
    offset: "now",
    live: "sse",
    headers,
    signal: stop.signal,
  });
  reading.subscribeJson((batch) => {
    for (const item of batch.items) apply(actions, ActivityEvent.parse(item));
    for (const wake of woken.splice(0)) wake();
  });

  // Their state stream, read on from where it ends now each time state() is asked. A stream
  // nothing has been written to isn't there yet: its start.
  const stateUrl = `${AFFILIATES}/streams/${stateStreamOf(viewer)}`;
  const readState = async (offset: string) => {
    try {
      const read = await stream<StateEvent>({ url: stateUrl, offset, live: false, headers });
      return { events: await read.json<StateEvent>(), offset: read.offset };
    } catch (error) {
      if (error instanceof FetchError && error.status === 404) return { events: [], offset: "-1" };
      throw error;
    }
  };
  let stateOffset = (await readState("now")).offset;
  const state = new MaterializedState();

  return {
    cookie,

    /**
     * Do something, and wait for the action it starts to finish: the next action with this title
     * (and this step, if one is named). Failed, it's the error, with the steps that failed.
     */
    async during<T>(title: string, send: () => Promise<T>, { step }: { step?: string } = {}) {
      const before = new Set(actions.keys());
      const sent = await send();
      for (;;) {
        const action = [...actions.values()].find(
          (a) =>
            !before.has(a.id) &&
            a.title === title &&
            (!step || a.steps.some((s) => s.name === step)) &&
            a.state !== "running",
        );
        if (action?.state === "failed") throw new Error(`failed: ${text(action)}`);
        if (action) return sent;
        // Until the stream's next event (the test's own timeout ends the wait).
        await new Promise<void>((resolve) => woken.push(resolve));
      }
    },

    /** One of a page's actions, as its button sends it: done once the action it starts is. */
    act(page: string, action: string, title: string, body: Record<string, unknown> = {}) {
      return this.during(title, async () => {
        const res = await fetch(`${AFFILIATES}${page}?${action}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${action} refused (${res.status}): ${await res.text()}`);
      });
    },

    /** What the actions since watch() left behind, as written to the state stream up to now. */
    async state() {
      const read = await readState(stateOffset);
      stateOffset = read.offset;
      for (const event of read.events) if (isChangeEvent(event)) state.apply(event);
      return {
        /** The sales written, each as it now stands. */
        sales: () => [...state.getType("sale").values()] as Sale[],
      };
    },

    close: () => stop.abort(),
  };
}

export type Watcher = Awaited<ReturnType<typeof watch>>;

let theAdmin: Promise<Watcher> | undefined;

/** The demo's admin, watching: one for the whole test file. */
export function adminBus(): Promise<Watcher> {
  const email = demoPeople.find((p) => p.role === "admin")?.email ?? "";
  return (theAdmin ??= watch(email));
}

/** Stop watching: after each test file (each-file.ts). */
export async function closeBus(): Promise<void> {
  if (theAdmin) (await theAdmin).close();
  theAdmin = undefined;
}

/**
 * Put the demo back as it was (apps/affiliates/src/demo-reset.ts): the admin's "Reset demo", done
 * once that action is. Before each test file (each-file.ts).
 */
export async function resetDemo(): Promise<void> {
  await (await adminBus()).act("/admin", "resetDemo", "Reset demo");
}
