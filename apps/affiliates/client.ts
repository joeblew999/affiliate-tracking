// The affiliate service's client for its host app. Calls go through a Cloudflare service binding and
// carry AFFILIATES_HOST_TOKEN. Their input and output types come from src/host-contract.ts, which the
// service's routes also validate against, so nothing is written twice and the host's type check never
// pulls in the service's code.
import { parse } from "hono/utils/cookie";
import type Stripe from "stripe";
import type { z } from "zod";
import { activityHeaders } from "activity/trace";
import {
  CheckoutInput,
  CheckoutOutput,
  EventsInput,
  EventsOutput,
  OnSaleInput,
  OnSaleOutput,
  REF_COOKIE,
  SignupInput,
  SignupOutput,
  StripeEventInput,
  StripeEventOutput,
} from "./src/host-contract.ts";

export { REF_COOKIE, OnSaleInput, OnSaleOutput };
export type { Event } from "./src/host-contract.ts";

/** What the host sends when a user signs up (its queue message too). */
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
    /** A user signed up on the host, with the referral cookie's value (referralFrom) or null. */
    signup: (body: z.input<typeof SignupInput>) =>
      call("/api/host/signup", SignupInput, SignupOutput, body),
    /** Before creating a Stripe Checkout Session: the metadata to add, and the partner's buyer discount. */
    checkout: (body: z.input<typeof CheckoutInput>) =>
      call("/api/host/checkout", CheckoutInput, CheckoutOutput, body),
    /** The events on sale, soonest first. */
    events: () => call("/api/host/events", EventsInput, EventsOutput, {}),
    /** Every Stripe event the host's Better Auth Stripe plugin receives (its onEvent). */
    stripeEvent: (event: Stripe.Event) =>
      call("/api/host/stripe-event", StripeEventInput, StripeEventOutput, event),
  };
}
