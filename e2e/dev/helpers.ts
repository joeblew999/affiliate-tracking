import { readFileSync } from "node:fs";
import { PAGES_PROTOCOL_VERSION } from "@void/edge";
import { unflatten } from "devalue";
import { createAuthClient } from "better-auth/client";
import { affiliates } from "../../apps/affiliates/client.ts";
import type { ActionUrl, ResolveActionBody } from "void/routes";
import type { Props as AdminPage } from "../../apps/affiliates/pages/admin/index.server.ts";
import type { Props as PartnerPage } from "../../apps/affiliates/pages/index.server.ts";
import Stripe from "stripe";
import { inject } from "vite-plus/test";
import { AFFILIATES, SHOP } from "./setup.ts";

/** The shop's Better Auth, as a browser uses it: typed from Better Auth, the cookies it sets kept. */
const shopAuth = createAuthClient({ baseURL: SHOP, fetchOptions: { headers: { origin: SHOP } } });

const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "");

/** A shop sign-in or sign-up's user and session cookie; it throws if refused. */
async function account(
  call: (options: { onResponse: (ctx: { response: Response }) => void }) => Promise<{
    data: { user: { id: string; email: string } } | null;
    error: { message?: string } | null;
  }>,
) {
  let cookie = "";
  const { data, error } = await call({
    onResponse: ({ response }) => {
      cookie = cookiesOf(response).join("; ");
    },
  });
  if (!data) throw new Error(`shop auth: ${error?.message}`);
  return { cookie, email: data.user.email, id: data.user.id };
}
export type Account = Awaited<ReturnType<typeof account>>;

/** A fresh shop user, signed in. `cookie` is sent with the sign-up (a referral cookie, say). */
export async function signUp(name = "Test User", cookie = ""): Promise<Account> {
  const email = `${crypto.randomUUID()}@example.test`;
  return account((options) =>
    shopAuth.signUp.email(
      { email, password: "example-password-123", name },
      { ...options, headers: cookie ? { cookie } : {} },
    ),
  );
}

/** The shop's admin (ADMIN_EMAILS in apps/shop/.env), signed in. */
export async function signInAdmin(): Promise<Account> {
  const email = "admin@example.test";
  const password = "example-password-123";
  return account((options) => shopAuth.signIn.email({ email, password }, options)).catch(() =>
    account((options) => shopAuth.signUp.email({ email, password, name: "Admin" }, options)),
  );
}

/** The shop's own client for the service (affiliates/client), reaching it by URL with its token. */
export const shop = () =>
  affiliates(
    {
      fetch: (input, init) =>
        fetch(new URL(new URL(new Request(input).url).pathname, AFFILIATES), init),
    },
    inject("hostToken"),
  );

/** The service's pages, each with its loader's props type. */
interface Pages {
  "/": PartnerPage;
  "/admin": AdminPage;
}

/**
 * A request to one of the service's pages as Void's own client makes it: the X-VoidPages headers, at
 * the protocol version Void exports (@void/edge), so the answer is the page's data (devalue, as
 * Void sends it) rather than HTML. Void documents no other way to read a page's data or call its
 * actions from outside a browser.
 */
async function pageRequest(cookie: string, url: string, body?: unknown) {
  const res = await fetch(new URL(url, AFFILIATES), {
    method: body === undefined ? "GET" : "POST",
    // Signed out, a page sends you to the shop's sign-in: that redirect is the answer.
    redirect: "manual",
    headers: {
      cookie,
      "x-voidpages": "true",
      "X-VoidPages-Version": PAGES_PROTOCOL_VERSION,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null;
  const page = json?.__void === "devalue" ? unflatten(json.data) : json;
  return { status: res.status, props: page?.props as unknown, text };
}

/** A page's data, as the user with this cookie sees it: its loader's props. */
export async function load<P extends keyof Pages>(
  cookie: string,
  path: P,
  query: Record<string, string> = {},
): Promise<Pages[P]> {
  const url = new URL(path, AFFILIATES);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const res = await pageRequest(cookie, url.pathname + url.search);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${res.text.slice(0, 200)}`);
  return res.props as Pages[P];
}

/** One of a page's actions, as the user with this cookie: its HTTP status (200 when done). */
export async function actStatus<U extends ActionUrl>(
  cookie: string,
  url: U,
  data: ResolveActionBody<U>,
): Promise<number> {
  return (await pageRequest(cookie, url, data)).status;
}

/** One of a page's actions, which must succeed. */
export async function act<U extends ActionUrl>(
  cookie: string,
  url: U,
  data: ResolveActionBody<U>,
): Promise<void> {
  const res = await pageRequest(cookie, url, data);
  if (res.status !== 200) throw new Error(`${url}: ${res.status} ${res.text.slice(0, 200)}`);
}

/** A shop user who applied and an admin approved: an active partner. */
export async function activePartner(
  name = "Nick",
): Promise<Account & { partnerId: string; code: string }> {
  const user = await signUp(name);
  await act(user.cookie, "/?apply", { name, acceptTerms: true });
  const admin = await signInAdmin();
  const partner = (await load(admin.cookie, "/admin")).partners?.find((p) => p.userId === user.id);
  if (!partner) throw new Error("applied, but not on the admin page");
  await act(admin.cookie, "/admin?changePartner", { id: partner.id, status: "active" });
  return { ...user, partnerId: partner.id, code: partner.code };
}

/** The signed-in partner's own page: their record, and their last 30 days' numbers. */
export async function partnerMe(cookie: string) {
  const page = await load(cookie, "/");
  if (!page.partner) throw new Error("not a partner");
  const funnel = page.stats?.funnel[0];
  // Their commission: on hold, ready to pay and paid, in every currency (the page's earnings).
  const commissionCents = page.earnings.reduce(
    (sum, e) => sum + e.onHoldCents + e.readyCents + e.paidCents,
    0,
  );
  return {
    ...page.partner,
    clicks: funnel?.clicks ?? 0,
    sales: funnel?.sales ?? 0,
    commissionCents,
  };
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
  return (await load(admin.cookie, "/admin", { partner: partnerId })).sales ?? [];
}

/** The partner's payouts, as an admin sees them, newest first. */
export async function payoutsOf(partnerId: string) {
  const admin = await signInAdmin();
  return (await load(admin.cookie, "/admin", { partner: partnerId })).payouts ?? [];
}
