// The tests' way in without a browser: over the streams, as any worker of the program is. A
// watcher signs in through the shop's Better Auth, as a person does, and from then on does three
// things: makes a request (a page's action, or whatever a test sends), waits on its stream in the
// hub for the action that request started to finish (the control plane, examples/activity), and
// reads what that action did from its state stream (Durable State: examples/affiliates/src/outcomes.ts).
// The streams are read at the service's own /streams, with the sign-in's cookie, as a page reads
// them. Nothing waits and looks again: an action finishing is an event, and what it did is already
// written when it reads done.
import { FetchError, stream } from "@durable-streams/client";
import { isChangeEvent, MaterializedState, type StateEvent } from "@durable-streams/state";
import { createAuthClient } from "better-auth/client";
import { DEMO_PASSWORD, demoPeople } from "../../affiliates/demo.ts";
import type { outcomes } from "../../affiliates/src/outcomes.ts";
import { ActivityEvent, apply, stateStreamOf, type Action } from "../../activity/src/model.ts";
import {
  AFFILIATES,
  checkoutVia,
  now,
  paidSession,
  sendStripeEvent,
  SHOP,
  type Partner,
} from "./helpers.ts";

/** A thing as the service writes it to the stream: its table's row (examples/affiliates/src/outcomes.ts). */
type Written<K extends keyof typeof outcomes> = NonNullable<
  Parameters<(typeof outcomes)[K]["upsert"]>[0]["value"]
>;
export type Sale = Written<"sales">;
export type Payout = Written<"payouts">;
export type PartnerRow = Written<"partners">;
export type Link = Written<"links">;
export type Referral = Written<"referrals">;
export type Event = Written<"events">;

const cookieOf = (setCookies: string[]) =>
  setCookies.map((cookie) => cookie.split(";")[0]).join("; ");

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
    cookie: cookieOf(cookies),
    // Whose stream they read: an admin, everyone's; anyone else, their own.
    viewer: person.role === "admin" ? "admins" : data.user.id,
  };
}

/**
 * A new shop account, made through the shop's Better Auth as its form makes one. `cookie`: what
 * the browser would send with it (the referral cookie of a link they followed). Their user id.
 * Made isn't dealt with: the shop publishes the sign-up; wait on its action (Watcher.during).
 */
export async function createAccount(name: string, cookie: string | null): Promise<string> {
  const { data, error } = await createAuthClient({ baseURL: SHOP }).signUp.email({
    name,
    email: `${crypto.randomUUID()}@example.test`,
    password: "example-password-123",
    fetchOptions: { headers: { origin: SHOP, ...(cookie ? { cookie } : {}) } },
  });
  if (error) throw new Error(`can't sign up: ${error.message}`);
  return data.user.id;
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

    /**
     * One of a page's actions ("/admin" and "runPayouts"), as its button sends it: done once the
     * action it starts is. Refused, it's the error, with the app's reason.
     */
    act(page: string, action: string, body: Record<string, unknown> = {}) {
      // What the control plane calls it: "runPayouts" is "Run payouts".
      const spaced = action.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const title = spaced.charAt(0).toUpperCase() + spaced.slice(1);
      return this.during(title, async () => {
        const res = await fetch(`${AFFILIATES}${page}?${action}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${action} refused (${res.status}): ${await res.text()}`);
      });
    },

    /** A page asked for as this person, without following where it sends them: its status. */
    async get(page: string) {
      const res = await fetch(`${AFFILIATES}${page}`, { headers, redirect: "manual" });
      return { status: res.status, location: res.headers.get("location") };
    },

    /** What the actions since watch() left behind, as written to the state stream up to now. */
    async state() {
      const read = await readState(stateOffset);
      stateOffset = read.offset;
      for (const event of read.events) if (isChangeEvent(event)) state.apply(event);
      const all = <T>(type: string) => [...state.getType(type).values()] as T[];
      // Each kind written, as it now stands.
      return {
        sales: () => all<Sale>("sale"),
        payouts: () => all<Payout>("payout"),
        partners: () => all<PartnerRow>("partner"),
        links: () => all<Link>("link"),
        referrals: () => all<Referral>("referral"),
        events: () => all<Event>("event"),
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
 * Put the demo back as it was (examples/affiliates/src/demo-reset.ts): the admin's "Reset demo", done
 * once that action is. Before each test file (each-file.ts).
 */
export async function resetDemo(): Promise<void> {
  await (await adminBus()).act("/admin", "resetDemo");
}

/** What the admin has seen written since the file began. */
export const written = async () => (await adminBus()).state();

/** A Stripe event sent (helpers.ts) and dealt with: done once that webhook's action is. */
export async function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  options: { daysAgo?: number } = {},
): Promise<void> {
  await (
    await adminBus()
  ).during("Stripe webhook", () => sendStripeEvent(type, object, options), {
    step: `Stripe ${type}`,
  });
}

/** A sale through this partner's link (or nobody's), as Stripe reports it; the customer's email. */
export async function sell(
  partner: Pick<Partner, "code"> | null,
  overrides: Record<string, unknown> = {},
  checkout: { eventId?: string | null } = {},
) {
  const session = paidSession((await checkoutVia(partner, checkout)).metadata, overrides);
  await stripeEvent("checkout.session.completed", session);
  return { session, customer: (session.customer_details as { email: string }).email };
}

/**
 * Run one of the service's crons, through Void's dev endpoint (guide/jobs.md): as of now, or as of
 * `daysLater` days on, so the seeded sales have aged that much for it. Done once its action is.
 */
export async function runCron(cron: string, { daysLater = 0 } = {}): Promise<void> {
  await (
    await adminBus()
  ).during("Daily job", async () => {
    const res = await fetch(`${AFFILIATES}/__void/scheduled`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-void-dev-trigger": globalThis.apps.cronToken,
      },
      body: JSON.stringify({ cron, scheduledTime: now() + daysLater * 24 * 60 * 60 * 1000 }),
    });
    if (!res.ok) throw new Error(`cron ${cron}: ${res.status} ${await res.text()}`);
  });
}
