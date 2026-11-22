// Step 4 of plans/2026-11-22-01-void-service.md: the service's pages in a real browser, against the
// running apps. A partner applies, an admin approves them, the partner makes and archives a link;
// an admin uses every tab. Any error on a page fails the test.
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { activePartner, eventually, signInAdmin, type Account } from "./helpers";
import { AFFILIATES, SHOP } from "./setup";

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

test("every page fits a phone's width, as a phone renders it", async () => {
  const context = await browser.newContext(devices["iPhone 15"]);
  const page = await context.newPage();
  for (const url of [SHOP, `${AFFILIATES}/`, `${AFFILIATES}/admin`]) {
    await open(page, url);
    // Without the viewport tag a phone lays the page out 980 pixels wide and shrinks it.
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(
      devices["iPhone 15"].viewport.width,
    );
  }
  await context.close();
});
