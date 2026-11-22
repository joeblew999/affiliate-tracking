// The tests' people and what they do, as Void's own tests drive apps: in a real browser, on the
// real pages (voidzero-dev/void, packages/*/test/integration). Each person is a browser of their own,
// signed in on the shop. What they see is read off the pages. The shop's own calls to the service
// and Stripe's webhook aren't pages: those go through the shop's client and Stripe's signing.
import { createAuthClient } from "better-auth/client";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import Stripe from "stripe";
import { expect, inject } from "vite-plus/test";
import { affiliates } from "../../apps/affiliates/client.ts";
import { DEMO_PASSWORD, demoPeople } from "../../apps/affiliates/demo.ts";

/** The two apps this run started (setup.ts, ../apps.ts). */
export const SHOP = inject("shop");
export const AFFILIATES = inject("affiliates");

const PASSWORD = "example-password-123";

// Headless Chrome says "HeadlessChrome", which the service treats as a link preview (src/visitor.ts).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let launched: Promise<Browser> | undefined;
const browser = () => (launched ??= chromium.launch());

/** A browser of their own, collecting the errors its pages show in the console. */
export async function newBrowser(options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await (
    await browser()
  ).newContext({ userAgent: USER_AGENT, locale: "en-US", ...options });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return { context, page, errors };
}

/** Open a page and wait until its scripts have loaded: a click before React takes over does nothing. */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
}

export interface Person {
  name: string;
  email: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

/** Create a shop account on the shop's page, in this browser; it's then signed in. */
async function createAccount(page: Page, name: string, email: string): Promise<void> {
  await open(page, SHOP);
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.locator("#up-name").fill(name);
  await page.locator("#up-email").fill(email);
  await page.locator("#up-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText(email).waitFor();
}

/** A fresh shop account, signed in, in a browser of its own. `via`: a referral link they followed first. */
export async function signUp(name = "Test User", { via }: { via?: string } = {}): Promise<Person> {
  const { context, page, errors } = await newBrowser();
  if (via) await open(page, `${AFFILIATES}${via}`);
  const email = `${crypto.randomUUID()}@example.test`;
  await createAccount(page, name, email);
  return { name, email, context, page, errors };
}

/** The shop's Better Auth, typed from Better Auth itself. */
const shopAuth = createAuthClient({ baseURL: SHOP });

/** A person's shop user id, from the shop's Better Auth, as the shop passes it at checkout. */
export async function userIdOf(person: Person): Promise<string> {
  const cookie = (await person.context.cookies(SHOP)).map((c) => `${c.name}=${c.value}`).join("; ");
  const { data } = await shopAuth.getSession({ fetchOptions: { headers: { cookie } } });
  if (!data) throw new Error(`${person.name} isn't signed in`);
  return data.user.id;
}

/** One of the demo's people (apps/affiliates/demo.ts, seeded in every run), signed in on the shop. */
export async function signInAs(email: string): Promise<Person> {
  const person = demoPeople.find((p) => p.email === email);
  if (!person) throw new Error(`${email} isn't one of the demo's people`);
  const { context, page, errors } = await newBrowser();
  await open(page, SHOP);
  await page.locator("#in-email").fill(email);
  await page.locator("#in-password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText(email).waitFor();
  return { name: person.name, email, context, page, errors };
}

let theAdmin: Promise<Person> | undefined;
/** The demo's admin, signed in: one browser for the whole test file. */
export function admin(): Promise<Person> {
  const email = demoPeople.find((p) => p.role === "admin")?.email ?? "";
  return (theAdmin ??= signInAs(email));
}

/** Apply on the partner page. */
export async function apply(person: Person): Promise<void> {
  await open(person.page, `${AFFILIATES}/`);
  await person.page.getByLabel("Name").fill(person.name);
  await person.page.getByRole("checkbox").click();
  await person.page.getByRole("button", { name: "Apply" }).click();
  await person.page.getByText("Application received").waitFor();
}

/** The admin page's row for this partner, on its Partners tab. */
async function partnerRow(name: string) {
  const { page } = await admin();
  await open(page, `${AFFILIATES}/admin`);
  return page.getByRole("row").filter({ hasText: name });
}

/** Press one of the admin's buttons on a partner's row (Approve, Suspend, Reactivate). */
export async function partnerButton(name: string, button: string): Promise<void> {
  const row = await partnerRow(name);
  await row.getByRole("button", { name: button }).click();
  await expect.poll(() => row.getByRole("button", { name: button }).count()).toBe(0);
}

/** Set a partner's renewals months, as an admin. */
export async function setRenewalMonths(name: string, months: number): Promise<void> {
  const label = `Months of renewals for ${name}`;
  const input = (await partnerRow(name)).getByLabel(label);
  await input.fill(String(months));
  await input.blur();
  await expect
    .poll(async () => (await partnerRow(name)).getByLabel(label).inputValue())
    .toBe(String(months));
}

/** Have every sale of this partner reviewed by an admin. */
export async function reviewEverySale(name: string): Promise<void> {
  const row = await partnerRow(name);
  await row.getByRole("button", { name: /^More for / }).click();
  await (await admin()).page.getByRole("menuitem", { name: "Review every sale" }).click();
  await expect
    .poll(async () => (await partnerRow(name)).getByText("every sale reviewed").count())
    .toBe(1);
}

export interface Partner extends Person {
  /** Their code: their referral link is /r/<code>. */
  code: string;
}

/** A shop user who applied and an admin approved: an active partner, with a name of their own. */
export async function activePartner(name = "Nick"): Promise<Partner> {
  const person = await signUp(`${name} ${crypto.randomUUID().slice(0, 6)}`);
  await apply(person);
  await partnerButton(person.name, "Approve");
  const me = await partnerMe(person);
  return { ...person, code: me.link.split("/r/")[1] ?? "" };
}

/** An amount as a page shows it ("$12.50", "-$5.00"), in minor units. */
export function cents(text: string): number {
  return Math.round(Number(text.replace(/[^0-9.-]/g, "")) * 100);
}

/** What a person sees on their partner page. */
export async function partnerPage(person: Person) {
  const { page } = person;
  await open(page, `${AFFILIATES}/`);
  const shows = async (title: string) => (await page.getByText(title, { exact: true }).count()) > 0;
  if (await shows("Application received")) return { status: "pending" as const };
  if (await shows("Suspended")) return { status: "suspended" as const };
  if (await shows("Become a partner")) return { status: "none" as const };
  const stat = async (title: string) =>
    cents(
      await page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText(title, { exact: true }) })
        .locator('[data-slot="card-title"]')
        .innerText(),
    );
  const funnel = (await page.getByText(/\d+ clicks, \d+ signups, \d+ sales/).innerText()).match(
    /(\d+) clicks, (\d+) signups, (\d+) sales/,
  );
  const promo = page.getByText(/Buyers can also use your code/);
  return {
    status: "active" as const,
    link: await page.locator("code").first().innerText(),
    promoCode: (await promo.count())
      ? (await promo.innerText()).match(/your code (\S+?)\.?$/)?.[1]
      : undefined,
    onHoldCents: await stat("On hold"),
    readyCents: await stat("Ready to pay"),
    paidCents: await stat("Paid"),
    clicks: Number(funnel?.[1]),
    signups: Number(funnel?.[2]),
    sales: Number(funnel?.[3]),
  };
}

/** An active partner's page; fails unless they're active. */
export async function partnerMe(person: Person) {
  const me = await partnerPage(person);
  if (me.status !== "active") throw new Error(`${person.name} is ${me.status}`);
  return me;
}

/** A partner's short links, as their page lists them. */
export async function linksOf(person: Person) {
  await open(person.page, `${AFFILIATES}/`);
  const card = person.page.locator('[data-slot="card"]').filter({ hasText: "Short links" });
  const rows = card.getByRole("row");
  const out = [];
  for (let i = 1; i < (await rows.count()); i++) {
    const cells = await rows.nth(i).getByRole("cell").allInnerTexts();
    out.push({
      url: cells[0]?.split("\n")[0] ?? "",
      campaign: cells[1] ?? "",
      clicks: Number(cells[2]),
      sales: Number(cells[3]),
    });
  }
  return out;
}

/** Open a tab of the admin page. */
async function adminTab(tab: RegExp) {
  const { page } = await admin();
  await open(page, `${AFFILIATES}/admin`);
  await page.getByRole("tab", { name: tab }).click();
  return page.getByRole("tabpanel");
}

/** A partner's sales (bonuses and clawbacks too), as the admin's Sales tab shows them. */
export async function salesOf(name: string) {
  const panel = await adminTab(/^Sales/);
  const rows = panel.getByRole("row").filter({ hasText: name });
  const out = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const [, , customer = "", paid = "", commission = "", status = ""] = await rows
      .nth(i)
      .getByRole("cell")
      .allInnerTexts();
    const [who = "", ...notes] = customer.split("\n");
    out.push({
      customer: who,
      notes: notes.join("\n"),
      paidCents: cents(paid),
      commissionCents: cents(commission),
      status: status.trim(),
    });
  }
  return out;
}

/** The sale of this paid checkout, found by its customer's email. */
export async function saleOf(name: string, session: Record<string, unknown>) {
  const email = (session.customer_details as { email?: string } | null)?.email?.toLowerCase();
  return (await salesOf(name)).find((s) => s.customer === email);
}

/** An admin's decision on a sale (Approve, Reject, Back to pending), found by its customer. */
export async function decideSale(customer: string, decision: string): Promise<void> {
  const panel = await adminTab(/^Sales/);
  const row = panel.getByRole("row").filter({ hasText: customer });
  await row.getByRole("button", { name: decision }).click();
  await expect.poll(() => row.getByRole("button", { name: decision }).count()).toBe(0);
}

/** A partner's payouts, as the admin's Payouts tab shows them. */
export async function payoutsOf(name: string) {
  const panel = await adminTab(/^Payouts/);
  const rows = panel.getByRole("row").filter({ hasText: name });
  const out = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const [, , amount = "", status = ""] = await rows.nth(i).getByRole("cell").allInnerTexts();
    out.push({ amount, amountCents: cents(amount), status: status.split("\n")[0]?.trim() ?? "" });
  }
  return out;
}

/** Press Run payouts, as an admin. */
export async function runPayouts(): Promise<void> {
  const panel = await adminTab(/^Payouts/);
  await panel.getByRole("button", { name: "Run payouts" }).click();
  await panel.getByText("Payouts queued").waitFor();
}

/** A commission rule for one partner, added on the admin's Rules tab. */
export async function addRule(
  name: string,
  rule: { percent: number; fromSales?: number; capPerCustomer?: string },
): Promise<void> {
  const panel = await adminTab(/^Rules/);
  const form = panel.locator("form").first();
  await form.getByPlaceholder("Percent").fill(String(rule.percent));
  await form.getByLabel("Partner").selectOption({ label: name });
  if (rule.fromSales)
    await form.getByPlaceholder("From sales this month").fill(String(rule.fromSales));
  if (rule.capPerCustomer)
    await form.getByPlaceholder("Most per customer").fill(rule.capPerCustomer);
  await form.getByRole("button", { name: "Add rule" }).click();
  await panel.getByText("Rule added.").waitFor();
}

/** A one-off bonus, added on the admin's Rules tab. */
export async function addBonus(name: string, amount: string, note: string): Promise<void> {
  const panel = await adminTab(/^Rules/);
  const form = panel.locator("form").last();
  await form.getByLabel("Partner").selectOption({ label: name });
  await form.getByPlaceholder("Amount").fill(amount);
  await form.getByPlaceholder("Launch week").fill(note);
  await form.getByRole("button", { name: "Add bonus" }).click();
  await panel.getByText("Bonus added").waitFor();
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

/** Follow a referral link as a browser does: the redirect, and the referral cookie it sets. */
export async function follow(path: string, userAgent = USER_AGENT) {
  const res = await fetch(`${AFFILIATES}${path}`, {
    redirect: "manual",
    headers: { "user-agent": userAgent },
  });
  const cookie =
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith("affiliate_ref="))
      ?.split(";")[0] ?? null;
  return { status: res.status, location: res.headers.get("location"), cookie };
}

/** What the shop adds to a checkout for a buyer who came through this partner's link. */
export async function checkoutVia(partner: Partner) {
  const { cookie } = await follow(`/r/${partner.code}`);
  return shop().checkout({
    userId: null,
    ref: cookie?.split("=")[1] ?? null,
    promoCode: null,
    ip: null,
  });
}

/**
 * A Stripe event, signed with the shop's webhook secret, sent to its Better Auth Stripe webhook
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

/** A paid Checkout Session as Stripe sends it, with the metadata the shop's checkout added. */
export function paidSession(
  metadata: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `cs_test_${crypto.randomUUID().replaceAll("-", "")}`,
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
  const res = await fetch(`${AFFILIATES}/__void/scheduled`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-void-dev-trigger": inject("cronToken") },
    body: JSON.stringify({ cron, scheduledTime: Date.now() }),
  });
  if (!res.ok) throw new Error(`cron ${cron}: ${res.status} ${await res.text()}`);
}

/** Close every browser: after each test file (each-file.ts). */
export async function closeBrowsers(): Promise<void> {
  if (launched) await (await launched).close();
  launched = undefined;
  theAdmin = undefined;
}
