// The pages as people use them, in a browser: an admin views the program as a partner and comes
// back, the shop's events, what a partner's and an organiser's page and the admin's Events tab
// show, and every page fits a phone. Any error on a page fails the test. What the program does
// (rather than what a page shows of it) is tested over the streams, without a browser (bus.ts).
import { devices } from "playwright";
import { expect, test } from "vite-plus/test";
import { demoEvents, demoOrganiserShares, demoSales, demoVenues } from "../../affiliates/demo.ts";
import {
  admin,
  adminTab,
  AFFILIATES,
  demoPartner,
  follow,
  newBrowser,
  open,
  partnerMe,
  seededEventId,
  seededPartner,
  SHOP,
  signInAs,
} from "./helpers.ts";

const usd = (cents: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(cents / 100);

test("an admin lands on the admin page, views the program as a partner, and comes back", async () => {
  const pat = await seededPartner("maya");
  const { page, errors } = await admin();
  await open(page, `${AFFILIATES}/`);
  await page.waitForURL(`${AFFILIATES}/admin`);

  await page.getByRole("tab", { name: /^Partners/ }).click();
  const row = page.getByRole("row").filter({ hasText: pat.email });
  await row.getByRole("button", { name: `More for ${pat.email}` }).click();
  await page.getByRole("menuitem", { name: `View as ${pat.name}` }).click();
  await page.waitForURL(`${AFFILIATES}/`);
  await page.getByText(`Viewing as ${pat.name}`).waitFor();
  expect(await page.getByText("Your link", { exact: true }).count()).toBe(1);

  await page.locator('#app[data-hydrated="true"]').waitFor(); // the button works once React has the page
  await page.getByRole("button", { name: "Back to admin" }).click();
  await page.waitForURL(`${AFFILIATES}/admin`);
  await page.getByText("Viewing as").waitFor({ state: "detached" });
  expect(errors).toEqual([]);
});

test("the shop lists its events; without a Stripe key an event's page sells no tickets", async () => {
  const { page, errors } = await signInAs("chris@demo.test");
  await open(page, SHOP);
  const workshop = demoEvents.workshop;
  await page.getByRole("link", { name: workshop.name }).click();
  await page.getByRole("heading", { name: workshop.name }).waitFor();
  await page.getByText(demoVenues[workshop.venue].location).waitFor();
  await page.getByText("This shop isn't taking payments: it has no Stripe key.").waitFor();
  expect(await page.getByRole("button", { name: /^Buy ticket/ }).count()).toBe(0);
  expect(errors).toEqual([]);
});

test("every page fits a phone's width, as a phone renders it", async () => {
  const { page } = await newBrowser(devices["iPhone 15"]);
  const workshop = `${SHOP}/events/${seededEventId("workshop")}`;
  for (const url of [SHOP, workshop, `${AFFILIATES}/`, `${AFFILIATES}/admin`]) {
    await open(page, url);
    // Without the viewport tag a phone lays the page out 980 pixels wide and shrinks it.
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(
      devices["iPhone 15"].viewport.width,
    );
  }
});

test("a partner's page counts a visitor through their link once", async () => {
  const ana = await seededPartner("ana");
  const before = (await partnerMe(ana)).clicks;
  await follow(`/r/ana?utm_source=youtube`);
  await follow(`/r/ana`); // same visitor again: still one click
  expect((await partnerMe(ana)).clicks).toBe(before + 1);
});

test("the admin page's money for an event is the fixtures'", async () => {
  const key = "teamSession"; // one no other test here buys a ticket for
  const event = demoEvents[key];
  const shares = demoOrganiserShares.filter((s) => s.event === key);
  const sold = shares.filter((s) => s.status !== "refunded").length;
  const revenue = shares.reduce(
    (sum, s) =>
      sum + event.cents - Math.round(((s.refundedCents ?? 0) * event.cents) / event.cents),
    0,
  );
  const organiser = shares.reduce((sum, s) => sum + s.commissionCents, 0);
  const tickets = demoSales.filter((s) => s.kind === "checkout" && s.event === key);
  const clawbacks = demoSales.filter(
    (s) => s.kind === "clawback" && tickets.some((t) => t.label === s.of),
  );
  const affiliates = [...tickets, ...clawbacks].reduce((sum, s) => sum + s.commissionCents, 0);
  const venue = demoVenues[event.venue].priceCents;
  const profit = revenue - organiser - affiliates - venue;
  const toBreakEven =
    profit >= 0 ? 0 : Math.ceil(-profit / ((revenue - organiser - affiliates) / sold));

  const panel = await adminTab(/^Events/);
  const cells = await panel
    .getByRole("row")
    .filter({ hasText: event.name })
    .getByRole("cell")
    .allInnerTexts();
  expect(cells.slice(1)).toEqual([
    `${sold} of ${demoVenues[event.venue].capacity}`,
    usd(revenue),
    usd(venue),
    usd(organiser),
    usd(affiliates),
    usd(profit),
    String(toBreakEven),
  ]);
});

test("an organiser's page has their events, and nothing an affiliate's has", async () => {
  const olivia = demoPartner("olivia");
  const { page } = await signInAs(olivia.email);
  await open(page, `${AFFILIATES}/`);
  await page.getByText("Your events", { exact: true }).waitFor();
  await page.getByRole("cell", { name: new RegExp(demoEvents.workshop.name) }).waitFor();
  expect(await page.getByRole("button", { name: "Apply" }).count()).toBe(0);
  expect(await page.getByText("Your link").count()).toBe(0);
});
