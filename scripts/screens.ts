// `vp run screens`: screenshots of every page of both apps, on a desktop and a phone, in .screens/.
// For looking at the design. Needs `vp run dev` running. It makes its demo data the way people
// would: a shop user applies and the admin approves them; visitors click their links; sales,
// a refund and a payout come in through the service's real Stripe webhook and queue.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import Stripe from "stripe";

const SHOP = "http://localhost:5173";
const AFFILIATES = "http://localhost:5174";
const OUT = ".screens";
const DAY = 24 * 60 * 60 * 1000;
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function serviceEnv(key: string): string {
  const found = readFileSync("apps/affiliates/.env", "utf8").match(
    new RegExp(`^${key}=(.+)$`, "m"),
  )?.[1];
  if (!found) throw new Error(`apps/affiliates/.env has no ${key}: run \`vp run setup\``);
  return found;
}

async function shopAuth(path: "sign-up" | "sign-in", body: Record<string, string>) {
  const res = await fetch(`${SHOP}/api/auth/${path}/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SHOP },
    body: JSON.stringify(body),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { ok: res.ok, cookie };
}

async function admin(): Promise<string> {
  const login = { email: "admin@example.test", password: "example-password-123" };
  const signedIn = await shopAuth("sign-in", login);
  if (signedIn.ok) return signedIn.cookie;
  return (await shopAuth("sign-up", { ...login, name: "Admin" })).cookie;
}

async function call<T>(path: string, cookie: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AFFILIATES}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function stripeEvent(type: string, object: Record<string, unknown>, daysAgo = 0) {
  const payload = JSON.stringify({
    id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "event",
    type,
    created: Math.floor((Date.now() - daysAgo * DAY) / 1000),
    data: { object },
    livemode: false,
    api_version: "2026-10-28",
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: serviceEnv("STRIPE_WEBHOOK_SECRET"),
  });
  const res = await fetch(`${AFFILIATES}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
  if (!res.ok) throw new Error(`${type}: ${res.status} ${await res.text()}`);
}

async function sale(partnerId: string, cents: number, email: string, daysAgo: number) {
  const id = `cs_demo_${crypto.randomUUID().replaceAll("-", "")}`;
  const paymentIntent = `pi_demo_${crypto.randomUUID().replaceAll("-", "")}`;
  await stripeEvent(
    "checkout.session.completed",
    {
      id,
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      amount_total: cents,
      currency: "usd",
      payment_intent: paymentIntent,
      customer_details: { email, address: { country: "TH" } },
      discounts: [],
      total_details: { amount_discount: 0 },
      metadata: { affiliate_partner_id: partnerId },
    },
    daysAgo,
  );
  return paymentIntent;
}

async function demoData(): Promise<{ partner: string; adminCookie: string }> {
  const adminCookie = await admin();
  const email = `maya-${Date.now()}@example.test`;
  const maya = await shopAuth("sign-up", {
    email,
    password: "example-password-123",
    name: "Maya Chen",
  });
  const applied = await call<{ id: string; code: string }>("/api/partner/apply", maya.cookie, {
    name: "Maya Chen",
    application: "I write a weekly newsletter on tools for small studios (about 4,000 readers).",
    acceptTerms: true,
  });
  await call("/api/admin/partners/status", adminCookie, { id: applied.id, status: "active" });
  for (const link of [
    { destination: "/", campaign: "Newsletter", slug: `${applied.code}-news` },
    { destination: "/pricing", campaign: "YouTube review", slug: `${applied.code}-yt` },
  ])
    await call("/api/partner/links", maya.cookie, link);

  // Visitors from a few places.
  const referers = ["https://www.youtube.com/", "https://news.ycombinator.com/", ""];
  for (let i = 0; i < 24; i++) {
    const slug =
      i % 3 === 0 ? `${applied.code}-yt` : i % 3 === 1 ? `${applied.code}-news` : applied.code;
    await fetch(`${AFFILIATES}/r/${slug}`, {
      redirect: "manual",
      headers: { "user-agent": CHROME, referer: referers[i % 3] ?? "" },
    });
  }
  // Sales: two past the hold period (approved, then paid out), one refunded in part, two recent.
  await sale(applied.id, 4900, "lee@studio.test", 41);
  await sale(applied.id, 9900, "ana@studio.test", 35);
  await runCron();
  await call("/api/admin/payouts/run", adminCookie, { partnerId: applied.id });
  const refunded = await sale(applied.id, 9900, "kim@studio.test", 12);
  await stripeEvent("charge.refunded", {
    id: `ch_demo_${Date.now()}`,
    object: "charge",
    amount: 9900,
    amount_refunded: 3000,
    payment_intent: refunded,
  });
  await sale(applied.id, 4900, "sol@studio.test", 3);
  await sale(applied.id, 19900, "jo@studio.test", 1);
  // A partner waiting for approval, for the admin's list.
  const sam = await shopAuth("sign-up", {
    email: `sam-${Date.now()}@example.test`,
    password: "example-password-123",
    name: "Sam Okafor",
  });
  await call("/api/partner/apply", sam.cookie, {
    name: "Sam Okafor",
    application: "I review productivity tools on YouTube.",
    acceptTerms: true,
  });
  return { partner: maya.cookie, adminCookie };
}

async function runCron() {
  const token = readFileSync("apps/affiliates/.void/dev-trigger-token", "utf8").trim();
  await fetch(`${AFFILIATES}/__void/scheduled`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-void-dev-trigger": token },
    body: JSON.stringify({ cron: "17 3 * * *", scheduledTime: Date.now() }),
  });
}

async function signedIn(context: BrowserContext, cookie: string) {
  await context.clearCookies();
  for (const pair of cookie.split("; ").filter(Boolean)) {
    const at = pair.indexOf("=");
    await context.addCookies([
      { name: pair.slice(0, at), value: pair.slice(at + 1), domain: "localhost", path: "/" },
    ]);
  }
}

async function main() {
  rmSync(OUT, { recursive: true, force: true }); // only this run's screenshots
  mkdirSync(OUT, { recursive: true });
  const { partner, adminCookie } = await demoData();
  const browser = await chromium.launch();
  for (const [device, viewport] of [
    ["desktop", { width: 1280, height: 860 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    const context = await browser.newContext({ viewport, userAgent: CHROME });
    const page = await context.newPage();
    const shot = async (name: string, url?: string) => {
      if (url) await page.goto(url, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${OUT}/${name}-${device}.png`, fullPage: true });
      console.log(`${OUT}/${name}-${device}.png`);
    };
    await shot("shop-signed-out", SHOP);
    await shot("service-signed-out", AFFILIATES);
    await signedIn(context, partner);
    await shot("shop-signed-in", SHOP);
    await shot("partner", AFFILIATES);
    await signedIn(context, adminCookie);
    await page.goto(`${AFFILIATES}/admin`, { waitUntil: "networkidle" });
    for (const tab of await page.getByRole("tab").all()) {
      // The tab's name without its count ("Sales 5 pending": sales).
      const name = (await tab.textContent())?.trim().split(/\d/)[0]?.trim() ?? "tab";
      await tab.click();
      await page.waitForTimeout(300);
      await shot(`admin-${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`);
    }
    await context.close();
  }
  await browser.close();
}

await main();
