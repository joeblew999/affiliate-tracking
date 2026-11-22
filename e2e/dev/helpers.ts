import { readFileSync } from "node:fs";
import { FetchError, fetch as voidFetch } from "void/client";
import { HOST_TOKEN_HEADER } from "../../apps/affiliates/client";
import Stripe from "stripe";
import { inject } from "vite-plus/test";
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

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "");

/** Signed in on the shop: the service asks the shop about this cookie (localhost shares it). */
async function account(res: Response): Promise<Account> {
  if (!res.ok) throw new Error(`shop auth: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string; email: string } };
  return {
    cookie: cookiesOf(res).join("; "),
    email: body.user.email,
    id: body.user.id,
  };
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

/**
 * Void's typed fetch (void/client) to the affiliate service, as the user this cookie signs in: the
 * path, params, body and answer are the service's own routes' types (e2e/tsconfig.json).
 */
export function asUser(cookie: string): typeof voidFetch {
  return withHeaders({ cookie });
}

/** The shop's own calls to the service (/api/host/*), with its token. */
export function asShop(): typeof voidFetch {
  return withHeaders({ [HOST_TOKEN_HEADER]: inject("hostToken") });
}

function withHeaders(headers: Record<string, string>): typeof voidFetch {
  const call = (path: string, options: { headers?: Record<string, string> } = {}) =>
    voidFetch(
      path as never,
      {
        ...options,
        baseURL: AFFILIATES,
        headers: { ...headers, ...options.headers },
      } as never,
    );
  return call as typeof voidFetch;
}

/** A call's HTTP status: 200 when it answered, else the status it failed with. */
export async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (err) {
    if (err instanceof FetchError && err.status) return err.status;
    throw err;
  }
}

/** A shop user who applied and an admin approved: an active partner. */
export async function activePartner(
  name = "Nick",
): Promise<Account & { partnerId: string; code: string }> {
  const user = await signUp(name);
  const applied = await asUser(user.cookie)("/api/partners", {
    method: "POST",
    body: { name, acceptTerms: true },
  });
  const admin = await signInAdmin();
  await asUser(admin.cookie)("/api/partners/[id]", {
    method: "PATCH",
    params: { id: applied.id },
    body: { status: "active" },
  });
  return { ...user, partnerId: applied.id, code: applied.code };
}

/** The signed-in user's partner record (GET /api/partners/me). */
export async function partnerMe(cookie: string) {
  const { partner } = await asUser(cookie)("/api/partners/me");
  if (!partner) throw new Error("not a partner");
  return partner;
}

/**
 * A Stripe event, signed with the shop's local webhook secret, sent to its Better Auth Stripe webhook
 * (which passes it on to the service); fails unless it's accepted.
 */
export async function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  { daysAgo = 0 } = {},
): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    created: Math.floor((Date.now() - daysAgo * 24 * 60 * 60 * 1000) / 1000),
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
  const res = await fetch(`${SHOP}/api/auth/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
  if (!res.ok) throw new Error(`${type}: ${res.status} ${await res.text()}`);
  return res;
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

/** Wait until check() passes (for work done through a queue). The test's own timeout ends it. */
export async function eventually(check: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** Run one of the service's crons now, through Void's dev endpoint (guide/jobs.md). */
export async function runCron(cron: string): Promise<void> {
  const token = readFileSync("apps/affiliates/.void/dev-trigger-token", "utf8").trim();
  const res = await fetch(`${AFFILIATES}/__void/scheduled`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-void-dev-trigger": token },
    body: JSON.stringify({ cron, scheduledTime: Date.now() }),
  });
  if (!res.ok) throw new Error(`cron ${cron}: ${res.status} ${await res.text()}`);
}

/** The partner's sales, as an admin sees them, newest first. */
export async function salesOf(partnerId: string) {
  const admin = await signInAdmin();
  const { sales } = await asUser(admin.cookie)("/api/sales", { query: { partnerId } });
  return sales;
}
