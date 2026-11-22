import Stripe from "stripe";
import { expect, inject } from "vite-plus/test";
import { AFFILIATES, SHOP } from "./setup";

export interface Account {
  cookie: string;
  email: string;
  id: string;
}

async function auth(
  path: "sign-up" | "sign-in",
  body: Record<string, string>,
  cookie = "",
): Promise<Response> {
  return fetch(`${SHOP}/api/auth/${path}/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SHOP, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function account(res: Response): Promise<Account> {
  if (!res.ok) throw new Error(`shop auth: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string; email: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, email: body.user.email, id: body.user.id };
}

/** A fresh shop user, signed in. `cookie` is sent with the sign-up (a referral cookie, say). */
export async function signUp(name = "Test User", cookie = ""): Promise<Account> {
  const email = `${crypto.randomUUID()}@example.test`;
  return account(await auth("sign-up", { email, password: "example-password-123", name }, cookie));
}

/** The shop's admin (ADMIN_EMAILS in apps/shop/.env), signed in. */
export async function signInAdmin(): Promise<Account> {
  const email = "admin@example.test";
  const password = "example-password-123";
  const signedIn = await auth("sign-in", { email, password });
  if (signedIn.ok) return account(signedIn);
  return account(await auth("sign-up", { email, password, name: "Admin" }));
}

/** JSON from the affiliate service, as the given user. */
export async function service<T>(
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${AFFILIATES}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

/** A host-only call, with the shop's token. */
export async function host<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AFFILIATES}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-affiliates-host-token": inject("hostToken") },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

export interface PartnerMe {
  partner: {
    id: string;
    code: string;
    status: string;
    link: string;
    clicks: number;
    sales: number;
    commissionCents: number;
  } | null;
}

/** A shop user who applied and an admin approved: an active partner. */
export async function activePartner(
  name = "Nick",
): Promise<Account & { partnerId: string; code: string }> {
  const user = await signUp(name);
  const applied = await service<{ id: string; code: string }>("/api/partner/apply", user.cookie, {
    name,
    acceptTerms: true,
  });
  expect(applied.status).toBe(200);
  const admin = await signInAdmin();
  expect(
    (
      await service("/api/admin/partners/status", admin.cookie, {
        id: applied.body.id,
        status: "active",
      })
    ).status,
  ).toBe(200);
  return { ...user, partnerId: applied.body.id, code: applied.body.code };
}

export async function partnerMe(cookie: string): Promise<NonNullable<PartnerMe["partner"]>> {
  const me = await service<PartnerMe>("/api/partner/me", cookie);
  if (!me.body.partner) throw new Error("not a partner");
  return me.body.partner;
}

/** A Stripe event, signed with the service's local webhook secret, sent to its webhook endpoint. */
export async function stripeEvent(
  type: string,
  object: Record<string, unknown>,
): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
    livemode: false,
    api_version: "2026-10-28",
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: inject("webhookSecret"),
  });
  return fetch(`${AFFILIATES}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

/** A paid Checkout Session as Stripe sends it, carrying the given metadata. */
export function paidSession(
  metadata: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = `cs_test_${crypto.randomUUID().replaceAll("-", "")}`;
  return {
    id,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: 5000,
    currency: "usd",
    payment_intent: `pi_${crypto.randomUUID().replaceAll("-", "")}`,
    customer: null,
    subscription: null,
    invoice: null,
    customer_details: { email: `${crypto.randomUUID()}@buyer.test`, address: { country: "TH" } },
    discounts: [],
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    metadata,
    ...overrides,
  };
}

/** Wait until check() passes (for work done through a queue). */
export async function eventually(check: () => Promise<void>, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
