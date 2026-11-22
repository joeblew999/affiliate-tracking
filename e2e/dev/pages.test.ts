// Step 4 of plans/2026-11-22-01-void-service.md: the service's pages in a real browser, against the
// running apps. A partner applies, an admin approves them, the partner makes and archives a link;
// an admin uses every tab. Any error on a page fails the test.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import {
  activePartner,
  eventually,
  paidSession,
  signInAdmin,
  signUp,
  stripeEvent,
  type Account,
} from "./helpers";
import { AFFILIATES } from "./setup";

// Headless Chrome says "HeadlessChrome", which the service treats as a link preview (src/visitor.ts).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** A browser signed in as this shop account, collecting page errors. */
async function as(
  account: Account,
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({ userAgent: USER_AGENT });
  await context.addCookies(
    account.cookie.split("; ").map((pair) => {
      const eq = pair.indexOf("=");
      return { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: "localhost", path: "/" };
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return { context, page, errors };
}

/** Open a page and wait until its scripts have loaded: a click before React takes over does nothing. */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
}

test("a partner applies, an admin approves, the partner makes and archives a link", async () => {
  const pat = await signUp("Pat Browser");
  const partner = await as(pat);
  await open(partner.page, `${AFFILIATES}/`);
  await partner.page.getByLabel("Name").fill("Pat Browser");
  await partner.page.getByLabel("How will you promote us?").fill("My newsletter");
  await partner.page.getByRole("checkbox").click();
  await partner.page.getByRole("button", { name: "Apply" }).click();
  await eventually(async () =>
    expect(await partner.page.getByText("Application received").count()).toBe(1),
  );

  const admin = await as(await signInAdmin());
  await open(admin.page, `${AFFILIATES}/admin`);
  const row = admin.page.getByRole("row").filter({ hasText: pat.email });
  await row.getByRole("button", { name: "Approve" }).click();
  await eventually(async () =>
    expect(await row.getByText("active").filter({ visible: true }).count()).toBe(1),
  );

  await partner.page.reload({ waitUntil: "networkidle" });
  await eventually(async () =>
    expect(await partner.page.getByText("Your link", { exact: true }).count()).toBe(1),
  );
  await partner.page.getByLabel("Goes to").fill("/pricing");
  await partner.page.getByLabel("Campaign").fill("Newsletter");
  await partner.page.getByRole("button", { name: "Create link" }).click();
  const link = partner.page.getByRole("row").filter({ hasText: "Newsletter" });
  await eventually(async () => expect(await link.count()).toBe(1));
  await link.getByRole("button", { name: "Archive" }).click();
  await eventually(async () => expect(await link.count()).toBe(0));

  expect([...partner.errors, ...admin.errors]).toEqual([]);
  await partner.context.close();
  await admin.context.close();
});

test("an admin uses every tab: sales, payouts, rules, bonuses, performance", async () => {
  const nick = await signUp("Nick Tabs");
  const applied = await fetch(`${AFFILIATES}/api/partner/apply`, {
    method: "POST",
    headers: { cookie: nick.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Nick Tabs", acceptTerms: true }),
  }).then((r) => r.json() as Promise<{ id: string }>);
  const adminAccount = await signInAdmin();
  await fetch(`${AFFILIATES}/api/admin/partners/status`, {
    method: "POST",
    headers: { cookie: adminAccount.cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: applied.id, status: "active" }),
  });
  const buyer = `${crypto.randomUUID()}@buyer.test`;
  const session = paidSession(
    { affiliate_partner_id: applied.id },
    { customer_details: { email: buyer, address: null } },
  );
  await stripeEvent("checkout.session.completed", session);

  const admin = await as(adminAccount);
  await open(admin.page, `${AFFILIATES}/admin`);
  await admin.page.getByRole("tab", { name: "Sales" }).click();
  const sale = admin.page.getByRole("row").filter({ hasText: buyer });
  await sale.getByRole("button", { name: "Approve" }).click();
  await eventually(async () =>
    expect(await sale.getByText("approved").filter({ visible: true }).count()).toBe(1),
  );

  await admin.page.getByRole("tab", { name: "Rules & bonuses" }).click();
  await admin.page.getByPlaceholder("Percent").fill("35");
  await admin.page.getByRole("button", { name: "Add rule" }).click();
  await eventually(async () => expect(await admin.page.getByText("Rule added.").count()).toBe(1));
  const rule = admin.page.getByRole("row").filter({ hasText: "35%" }).first();
  await rule.getByRole("button", { name: "Archive" }).click(); // every partner: don't leave it on
  await eventually(async () =>
    expect(await admin.page.getByText("Rule archived.").count()).toBe(1),
  );
  await admin.page.getByLabel("Partner").last().selectOption({ label: "Nick Tabs" });
  await admin.page.getByPlaceholder("Amount").last().fill("12.50");
  await admin.page.getByPlaceholder("Launch week").fill("Browser test");
  await admin.page.getByRole("button", { name: "Add bonus" }).click();
  await eventually(async () => expect(await admin.page.getByText(/Bonus added/).count()).toBe(1));

  await admin.page.getByRole("tab", { name: "Payouts" }).click();
  await admin.page.getByRole("button", { name: "Run payouts" }).click();
  await eventually(async () =>
    expect(await admin.page.getByText(/Payouts queued/).count()).toBe(1),
  );

  await admin.page.getByRole("tab", { name: "Performance" }).click();
  await eventually(async () =>
    expect(await admin.page.getByRole("img", { name: "Clicks per day" }).count()).toBe(1),
  );

  expect(admin.errors).toEqual([]);
  await admin.context.close();
});

test("an admin lands on the admin page, views the program as a partner, and comes back", async () => {
  const pat = await activePartner("Pat Viewed");
  const admin = await as(await signInAdmin());
  await open(admin.page, `${AFFILIATES}/`);
  await eventually(async () => expect(admin.page.url()).toBe(`${AFFILIATES}/admin`));

  const row = admin.page.getByRole("row").filter({ hasText: pat.email });
  await row.getByRole("button", { name: `More for ${pat.email}` }).click();
  await admin.page.getByRole("menuitem", { name: "View as Pat Viewed" }).click();
  await admin.page.waitForURL(`${AFFILIATES}/`);
  await eventually(async () =>
    expect(await admin.page.getByText("Viewing as Pat Viewed").count()).toBe(1),
  );
  expect(await admin.page.getByText("Your link", { exact: true }).count()).toBe(1);

  await admin.page.getByRole("button", { name: "Back to admin" }).click();
  await admin.page.waitForURL(`${AFFILIATES}/admin`);
  await eventually(async () => expect(await admin.page.getByText("Viewing as").count()).toBe(0));
  expect(admin.errors).toEqual([]);
  await admin.context.close();
});
