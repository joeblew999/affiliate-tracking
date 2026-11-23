// The tests' people and what they do, as Void's own tests drive apps: in a real browser, on the
// real pages (voidzero-dev/void, packages/*/test/integration). Each person is a browser of their own,
// signed in on the shop. What they see is read off the pages. The shop's own calls to the service
// and Stripe's webhook aren't pages: those go through the shop's client and Stripe's signing.
import { createAuthClient } from "better-auth/client";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import Stripe from "stripe";
import { expect } from "vite-plus/test";
import { affiliates } from "../../apps/affiliates/client.ts";
import {
  customerOf,
  DEMO_PASSWORD,
  demoPayouts,
  demoPeople,
  demoEvents,
  demoSales,
  fixtureId,
  paymentIntentOf,
} from "../../apps/affiliates/demo.ts";

/** The run's two apps (each-file.ts, ../apps.ts); none in a suite that's skipped. */
export const SHOP = globalThis.apps?.shop ?? "";
export const AFFILIATES = globalThis.apps?.affiliates ?? "";

/** Now, by the service's clock: DEMO_NOW when the run started, and running on. */
export const now = () => globalThis.apps.now();

const PASSWORD = "example-password-123";

// Headless Chrome says "HeadlessChrome", which the service treats as a link preview (src/visitor.ts).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let launched: Promise<Browser> | undefined;
// Chromium's shared memory, /dev/shm, is small in containers (CI's included); without this its
// tabs crash on long runs.
const browser = () => (launched ??= chromium.launch({ args: ["--disable-dev-shm-usage"] }));

// The first failure either app reports in this test, and the pages to end when it comes: their
// waiting stops at once, with the failure as the reason, instead of at a timeout.
let failure: string | null = null;
const pages = new Set<Page>();

const failureListeners = new Set<(error: string) => void>();

/** End the test now: what failed, through every open page and everything waiting on an event. */
export function fail(error: string): void {
  if (failure) return;
  failure = error;
  for (const page of pages) void page.close({ reason: error });
  for (const listener of failureListeners) listener(error);
}

/** A new test starts with nothing failed. (each-file.ts, before each test.) */
export function startTest(): void {
  failure = null;
}

/** The message an app's error page carries (Void puts it in the page's data), or the page's start. */
async function errorOf(response: Response | import("playwright").Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const message = /"message":\d+\},\d+,"((?:[^"\\]|\\.)*)"/.exec(body)?.[1];
  return (
    message ??
    body
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 1000)
  );
}

/**
 * A browser of their own, collecting the errors its pages show in the console. A server error on
 * any page (one opened, or a form's action) fails the test there and then.
 */
export async function newBrowser(options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await (
    await browser()
  ).newContext({ userAgent: USER_AGENT, locale: "en-US", ...options });
  const page = await context.newPage();
  pages.add(page);
  page.on("close", () => pages.delete(page));
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", async (response) => {
    if (response.status() < 500) return;
    const url = response.url();
    if (!url.startsWith(SHOP) && !url.startsWith(AFFILIATES)) return;
    fail(`${response.status()} from ${url}: ${await errorOf(response)}`);
  });
  return { context, page, errors };
}

/**
 * Open a page and wait until React has taken it over: a click before that does nothing. Void marks
 * it (#app data-hydrated), and its own tests wait for that mark too. A page whose server failed,
 * or that isn't there, says so here. (Another 4xx is the page saying no on purpose, as "Admins
 * only" does: that one shows.)
 */
export async function open(page: Page, url: string): Promise<void> {
  const response = await page.goto(url);
  if (response && (response.status() >= 500 || response.status() === 404))
    throw new Error(`${response.status()} from ${url}: ${await errorOf(response)}`);
  await page.locator('#app[data-hydrated="true"]').waitFor();
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
  await press(page, page.getByRole("button", { name: "Create account" }));
}

/** A fresh shop account, signed in, in a browser of its own. `via`: a referral link they followed first. */
export async function signUp(name = "Test User", { via }: { via?: string } = {}): Promise<Person> {
  const { context, page, errors } = await newBrowser();
  if (via) await open(page, `${AFFILIATES}${via}`);
  const email = `${crypto.randomUUID()}@example.test`;
  // The shop passes each new user to the service through its queue: done once the sign-up's
  // action is, as the admin's control plane shows it.
  const pane = await activity(await adminPage());
  const before = await pane.seen();
  await createAccount(page, name, email);
  await pane.finished("Sign up", { after: before });
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

/**
 * One of the demo's people (apps/affiliates/demo.ts, seeded in every run), signed in on the shop
 * through its Better Auth sign-in, with the seeded password; the session's cookies go in a browser
 * of their own.
 */
export async function signInAs(email: string): Promise<Person> {
  const person = demoPeople.find((p) => p.email === email);
  if (!person) throw new Error(`${email} isn't one of the demo's people`);
  let cookies: string[] = [];
  const { error } = await shopAuth.signIn.email({
    email,
    password: DEMO_PASSWORD,
    fetchOptions: {
      // As the shop's page sends it: Better Auth refuses a sign-in from no origin.
      headers: { origin: SHOP },
      onResponse: ({ response }) => void (cookies = response.headers.getSetCookie()),
    },
  });
  if (error) throw new Error(`${email} can't sign in: ${error.message}`);
  const { context, page, errors } = await newBrowser();
  await context.addCookies(
    cookies.map((cookie) => {
      const [name = "", ...value] = (cookie.split(";")[0] ?? "").split("=");
      return { name, value: value.join("="), url: SHOP };
    }),
  );
  return { name: person.name, email, context, page, errors };
}

/** Sign in on the shop's own form, with the demo's password. */
export async function signInOnForm(email: string): Promise<Person> {
  const person = demoPeople.find((p) => p.email === email);
  if (!person) throw new Error(`${email} isn't one of the demo's people`);
  const { context, page, errors } = await newBrowser();
  await open(page, SHOP);
  await page.locator("#in-email").fill(email);
  await page.locator("#in-password").fill(DEMO_PASSWORD);
  await press(page, page.getByRole("button", { name: "Sign in", exact: true }));
  return { name: person.name, email, context, page, errors };
}

let theAdmin: Promise<Person> | undefined;
/** The demo's admin, signed in: one browser for the whole test file. */
export async function admin(): Promise<Person> {
  const email = demoPeople.find((p) => p.role === "admin")?.email ?? "";
  // A new browser if an earlier test's failure closed it.
  if (theAdmin && (await theAdmin).page.isClosed()) theAdmin = undefined;
  return (theAdmin ??= signInAs(email));
}

/** Apply on the partner page. */
export async function apply(person: Person): Promise<void> {
  await open(person.page, `${AFFILIATES}/`);
  await person.page.getByLabel("Name").fill(person.name);
  await person.page.getByRole("checkbox").click();
  await press(person.page, person.page.getByRole("button", { name: "Apply" }));
}

/** The admin page's row for this partner, on its Partners tab. */
async function partnerRow(name: string) {
  return (await adminTab(/^Partners/)).getByRole("row").filter({ hasText: name });
}

/**
 * Do something on a page that sends a form (a page action, or a sign-in), and wait for the app's
 * answer: the request's own response. Refused (a 4xx), it's the error, with the app's reason; a
 * server error has already failed the test (newBrowser).
 */
export async function act(page: Page, send: () => Promise<void>): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        (r.url().startsWith(SHOP) || r.url().startsWith(AFFILIATES)) &&
        !new URL(r.url()).pathname.startsWith("/live"),
    ),
    send(),
  ]);
  if (!response.ok()) throw new Error(`refused (${response.status()}): ${await errorOf(response)}`);
}

/** Press a button that sends a form, and wait for the app's answer (act). */
export const press = (page: Page, button: Locator) => act(page, () => button.click());

/** Press one of the admin's buttons on a partner's row (Approve, Suspend, Reactivate). */
export async function partnerButton(name: string, button: string): Promise<void> {
  const row = await partnerRow(name);
  await press((await admin()).page, row.getByRole("button", { name: button, exact: true }));
}

/** Set a partner's renewals months, as an admin; done once the saved value comes back. */
export async function setRenewalMonths(name: string, months: number): Promise<void> {
  const label = `Months of renewals for ${name}`;
  const { page } = await admin();
  const input = (await partnerRow(name)).getByLabel(label);
  await input.fill(String(months));
  await act(page, () => input.blur());
  expect(await (await partnerRow(name)).getByLabel(label).inputValue()).toBe(String(months));
}

export interface Partner extends Person {
  /** Their code: their referral link is /r/<code>. */
  code: string;
}

/** A seeded partner as the fixtures write them (apps/affiliates/demo.ts), by their code. */
export function demoPartner(code: string) {
  const person = demoPeople.find((p) => p.partner?.code === code);
  if (!person?.partner) throw new Error(`no demo partner ${code}`);
  return { ...person, ...person.partner };
}

/** A seeded partner (apps/affiliates/demo.ts, by their code), signed in. */
export async function seededPartner(code: string): Promise<Partner> {
  return { ...(await signInAs(demoPartner(code).email)), code };
}

/** What the fixtures have ready to pay a partner: their approved sales, bonuses and clawbacks. */
export const seededReadyCents = (code: string) =>
  demoSales
    .filter((s) => s.partner === code && s.status === "approved")
    .reduce((sum, s) => sum + s.commissionCents, 0);

/** How many payouts the fixtures have for a partner. */
export const seededPayoutCount = (code: string) =>
  demoPayouts.filter((p) => p.partner === code).length;

/** A seeded sale (apps/affiliates/demo.ts), with its customer and Stripe payment as seeded. */
export function seededSale(label: string) {
  const sale = demoSales.find((s) => s.label === label);
  if (!sale) throw new Error(`no demo sale ${label}`);
  return { ...sale, customer: customerOf(sale) ?? "", paymentIntent: paymentIntentOf(label) };
}

/** A seeded partner's id: made from their label, as the seed makes it. */
export const seededPartnerId = (code: string) => fixtureId(`partner:${code}`);

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
export async function adminTab(tab: RegExp) {
  const page = await adminPage();
  await page.getByRole("tab", { name: tab }).click();
  return page.getByRole("tabpanel");
}

/**
 * The admin's browser, on the service's admin page. Opened only if it isn't there already: the
 * page keeps itself up to date (it reloads its data when an action finishes, and finished() waits
 * for that), so nothing opens it again just to look, or to watch its Activity pane.
 */
export async function adminPage(): Promise<Page> {
  const { page } = await admin();
  const there = page.url() === "about:blank" ? null : new URL(page.url());
  if (!there || `${there.origin}${there.pathname}${there.search}` !== `${AFFILIATES}/admin`)
    await open(page, `${AFFILIATES}/admin`);
  return page;
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

/** A sale, by its customer's email, or the paid checkout it came from. */
export async function saleOf(name: string, sale: string | Record<string, unknown>) {
  const email = (
    typeof sale === "string" ? sale : (sale.customer_details as { email?: string } | null)?.email
  )?.toLowerCase();
  // A clawback shows its sale's customer too: the sale is the one that isn't a clawback.
  return (await salesOf(name)).find((s) => s.customer === email && !s.notes.startsWith("clawback"));
}

/** An admin's decision on a sale (Approve, Reject, Back to pending), found by its customer. */
export async function decideSale(
  partner: string,
  customer: string,
  decision: string,
): Promise<void> {
  const panel = await adminTab(/^Sales/);
  // The partner's row: a ticket also has a row for its event's organiser, with the same customer.
  const row = panel.getByRole("row").filter({ hasText: customer }).filter({ hasText: partner });
  await press((await admin()).page, row.getByRole("button", { name: decision, exact: true }));
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

/** Press Run payouts, as an admin, and see it through: done once every payout has run. */
export async function runPayouts(): Promise<void> {
  const { page } = await admin();
  const panel = await adminTab(/^Payouts/);
  const pane = await activity(page);
  const before = await pane.seen();
  await press(page, panel.getByRole("button", { name: "Run payouts" }));
  await pane.finished("Run payouts", { after: before });
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
  await press((await admin()).page, form.getByRole("button", { name: "Add rule" }));
}

/**
 * Put the demo back as it was (apps/affiliates/src/demo-reset.ts): the admin presses "Reset demo",
 * done once that action is. Before each test file (each-file.ts).
 */
export async function resetDemo(): Promise<void> {
  const page = await adminPage();
  const pane = await activity(page);
  const before = await pane.seen();
  await press(page, page.getByRole("button", { name: "Reset demo" }));
  await pane.finished("Reset demo", { after: before });
}

/** A one-off bonus, added on the admin's Rules tab. */
export async function addBonus(name: string, amount: string, note: string): Promise<void> {
  const panel = await adminTab(/^Rules/);
  const form = panel.locator("form").last();
  await form.getByLabel("Partner").selectOption({ label: name });
  await form.getByPlaceholder("Amount").fill(amount);
  await form.getByPlaceholder("Launch week").fill(note);
  await press((await admin()).page, form.getByRole("button", { name: "Add bonus" }));
}

/** The shop's own client for the service (affiliates/client), reaching it by URL with its token. */
export const shop = () =>
  affiliates(
    {
      fetch: (input, init) =>
        fetch(new URL(new URL(new Request(input).url).pathname, AFFILIATES), init),
    },
    globalThis.apps.hostToken,
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

/**
 * What the shop adds to a checkout for a buyer who came through this partner's link (or none), for
 * a ticket to this event (or none).
 */
export async function checkoutVia(
  partner: Partner | null,
  { eventId = null as string | null } = {},
) {
  const { cookie } = partner ? await follow(`/r/${partner.code}`) : { cookie: null };
  return shop().checkout({
    userId: null,
    ref: cookie?.split("=")[1] ?? null,
    promoCode: null,
    ip: null,
    eventId,
  });
}

/** A seeded event's id (apps/affiliates/demo.ts), as the seed makes it. */
export const seededEventId = (key: keyof typeof demoEvents) => fixtureId(`event:${key}`);

/** The emails the shop has sent, newest first, from Void's dev inbox: who to, subject and text. */
export async function inbox(): Promise<{ to: string; subject: string; text: string }[]> {
  const headers = { "x-void-dev-trigger": globalThis.apps.inboxToken };
  const list = await (await fetch(`${SHOP}/__void/inbox`, { headers })).text();
  const ids = [...new Set([...list.matchAll(/\/__void\/inbox\/([^/?"]+)\?/g)].map((m) => m[1]))];
  return Promise.all(
    ids.map(async (id) => {
      const raw = await (await fetch(`${SHOP}/__void/inbox/${id}/raw`, { headers })).text();
      const [head = "", ...body] = raw.split(/\r?\n\r?\n/);
      const header = (name: string) =>
        head.match(new RegExp(`^${name}: (.*)$`, "im"))?.[1]?.trim() ?? "";
      // Quoted-printable soft line breaks and escapes, as sendEmail writes plain text.
      const text = body
        .join("\n\n")
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      return { to: header("To"), subject: header("Subject"), text };
    }),
  );
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
    created: Math.floor((now() - daysAgo * 24 * 60 * 60 * 1000) / 1000),
    data: { object },
    livemode: false,
    api_version: Stripe.API_VERSION, // what the installed Stripe SDK reads and Stripe sends
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: globalThis.apps.webhookSecret,
  });
  // The shop queues each event for the service: done once that webhook's action is, in the admin's
  // control plane.
  const pane = await activity(await adminPage());
  const before = await pane.seen();
  const res = await fetch(`${SHOP}/api/auth/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
  if (!res.ok) throw new Error(`${type}: ${res.status} ${await res.text()}`);
  await pane.finished("Stripe webhook", { step: `Stripe ${type}`, after: before });
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

/** A sale for this partner through their link, as Stripe reports it; the customer's email. */
export async function sell(partner: Partner, overrides: Record<string, unknown> = {}) {
  const session = paidSession((await checkoutVia(partner)).metadata, overrides);
  await stripeEvent("checkout.session.completed", session);
  return (session.customer_details as { email: string }).email;
}

/**
 * Run one of the service's crons, through Void's dev endpoint (guide/jobs.md): as of now, or as of
 * `daysLater` days on, so the seeded sales have aged that much for it.
 */
export async function runCron(cron: string, { daysLater = 0 } = {}): Promise<void> {
  // The run is an action of its own in the admin's control plane: done once that is.
  const pane = await activity(await adminPage());
  const before = await pane.seen();
  const res = await fetch(`${AFFILIATES}/__void/scheduled`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-void-dev-trigger": globalThis.apps.cronToken,
    },
    body: JSON.stringify({ cron, scheduledTime: now() + daysLater * 24 * 60 * 60 * 1000 }),
  });
  if (!res.ok) throw new Error(`cron ${cron}: ${res.status} ${await res.text()}`);
  await pane.finished("Daily job", { after: before });
}

/** Close every browser: after each test file (each-file.ts). */
export async function closeBrowsers(): Promise<void> {
  if (launched) await (await launched).close();
  launched = undefined;
  theAdmin = undefined;
}

// The control plane, as people see it: the Activity pane on every page (packages/activity).

/** The page's Activity pane, opened, once it's listening (its data-live mark). */
export async function activity(page: Page) {
  const pane = page.locator("aside[aria-label='Activity']");
  if ((await pane.getByRole("log").count()) === 0) await pane.getByRole("button").click();
  await page.locator("aside[aria-label='Activity'][data-live='connected']").waitFor();
  const actions = pane.locator("[data-action]");
  return {
    /** The actions the pane shows now: to tell the next ones from them. */
    async seen(): Promise<string[]> {
      return actions.evaluateAll((els) => els.map((el) => el.getAttribute("data-action") ?? ""));
    },
    /**
     * The next action with this title (and by this person), finished: done, or failed, which
     * fails the test there and then with the steps that failed.
     */
    async finished(
      title: string,
      { by, step, after = [] }: { by?: string; step?: string; after?: string[] } = {},
    ) {
      const which =
        `[data-action][data-title="${title}"]` +
        (by ? `[data-by="${by}"]` : "") +
        (step ? `:has([data-step="${step}"])` : "") +
        after.map((id) => `:not([data-action="${id}"])`).join("");
      const settled = pane
        .locator(`${which}:is([data-state="done"],[data-state="failed"])`)
        .first();
      await settled.waitFor();
      if ((await settled.getAttribute("data-state")) === "failed")
        throw new Error(`${title} failed: ${await settled.innerText()}`);
      // And the page shows what the action saved (it reloads its data when one finishes).
      await page.locator("aside[aria-label='Activity'][data-page='fresh']").waitFor();
      return settled;
    },
  };
}
