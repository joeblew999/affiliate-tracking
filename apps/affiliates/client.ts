// The affiliate service's client for its host app. Calls go through a Cloudflare service binding and
// carry AFFILIATES_HOST_TOKEN. Their input and output types come from src/host-contract.ts, which the
// service's routes also validate against, so nothing is written twice and the host's type check never
// pulls in the service's code.
import { parse } from "hono/utils/cookie";
import type { z } from "zod";
import { activityHeaders } from "activity/trace";
import {
  CheckoutInput,
  CheckoutOutput,
  DEMO_RESET_STREAM,
  DemoReset,
  EventsInput,
  EventsOutput,
  ON_SALE_STREAM,
  OnSale,
  REF_COOKIE,
  SIGNUPS_STREAM,
  SignupInput,
  STRIPE_STREAM,
} from "./src/host-contract.ts";

// What the host and the service tell each other over the hub: the streams, and what's on them.
export {
  DEMO_RESET_STREAM,
  DemoReset,
  ON_SALE_STREAM,
  OnSale,
  REF_COOKIE,
  SIGNUPS_STREAM,
  STRIPE_STREAM,
};
export type { Event } from "./src/host-contract.ts";

/** What the host says of a user who signed up (the data of its "signed-up" event). */
export type Signup = z.input<typeof SignupInput>;
/** What the service answers at checkout: the metadata and discount to add. */
export type Checkout = z.output<typeof CheckoutOutput>;

/** The referral cookie's value from a Cookie header, or null. Pass only this, never the whole header. */
export function referralFrom(cookieHeader: string | null | undefined): string | null {
  return parse(cookieHeader ?? "", REF_COOKIE)[REF_COOKIE] || null;
}

/** `binding`: the service binding, or anything with its fetch (the tests reach the service by URL). */
export function affiliates(binding: Pick<Fetcher, "fetch">, token: string) {
  async function call<I extends z.ZodType, O extends z.ZodType>(
    path: string,
    input: I,
    output: O,
    body: z.input<I>,
  ): Promise<z.output<O>> {
    const res = await binding.fetch(new URL(path, "https://affiliates.internal"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        // The action this call is part of, for the control plane (packages/activity).
        ...activityHeaders(),
      },
      body: JSON.stringify(input.parse(body)),
    });
    if (!res.ok) throw new Error(`affiliates ${path}: ${res.status} ${await res.text()}`);
    return output.parse(await res.json());
  }
  return {
    /** Before creating a Stripe Checkout Session: the metadata to add, and the partner's buyer discount. */
    checkout: (body: z.input<typeof CheckoutInput>) =>
      call("/api/host/checkout", CheckoutInput, CheckoutOutput, body),
    /** The events on sale, soonest first. */
    events: () => call("/api/host/events", EventsInput, EventsOutput, {}),
  };
}
