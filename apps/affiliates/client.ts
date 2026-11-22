// The affiliate service's client for its host app. Calls go through a Cloudflare service binding and
// carry AFFILIATES_HOST_TOKEN. Their input and output types come from src/host-contract.ts, which the
// service's routes also validate against, so nothing is written twice and the host's type check never
// pulls in the service's code.
import type Stripe from "stripe";
import type { z } from "zod";
import {
  CheckoutInput,
  CheckoutOutput,
  HOST_TOKEN_HEADER,
  OAUTH_CLIENT_ID,
  REF_COOKIE,
  SignupInput,
  SignupOutput,
  StripeEventInput,
  StripeEventOutput,
} from "./src/host-contract";

export { HOST_TOKEN_HEADER, OAUTH_CLIENT_ID, REF_COOKIE };

/** The referral cookie's value from a Cookie header, or null. Pass only this, never the whole header. */
export function referralFrom(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0 || part.slice(0, eq).trim() !== REF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null; // not valid percent-encoding: no referral
    }
  }
  return null;
}

export function affiliates(binding: Fetcher, token: string) {
  async function call<I extends z.ZodType, O extends z.ZodType>(
    path: string,
    input: I,
    output: O,
    body: z.input<I>,
  ): Promise<z.output<O>> {
    const res = await binding.fetch(new URL(path, "https://affiliates.internal"), {
      method: "POST",
      headers: { "content-type": "application/json", [HOST_TOKEN_HEADER]: token },
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
    /** Every Stripe event the host's Better Auth Stripe plugin receives (its onEvent). */
    stripeEvent: (event: Stripe.Event) =>
      call("/api/host/stripe-event", StripeEventInput, StripeEventOutput, event),
  };
}
