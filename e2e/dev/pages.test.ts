// The pages as people use them: an admin views the program as a partner and comes back, the shop's
// events, and every page fits a phone. Any error on a page fails the test.
import { devices } from "playwright";
import { expect, test } from "vite-plus/test";
import { demoEvents, demoVenues } from "../../apps/affiliates/demo.ts";
import { admin, AFFILIATES, newBrowser, open, seededPartner, SHOP, signInAs } from "./helpers.ts";

test("an admin lands on the admin page, views the program as a partner, and comes back", async () => {
  const pat = await seededPartner("maya");
  const { page, errors } = await admin();
  await open(page, `${AFFILIATES}/`);
  await page.waitForURL(`${AFFILIATES}/admin`);

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
  for (const url of [SHOP, `${SHOP}/events/workshop`, `${AFFILIATES}/`, `${AFFILIATES}/admin`]) {
    await open(page, url);
    // Without the viewport tag a phone lays the page out 980 pixels wide and shrinks it.
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(
      devices["iPhone 15"].viewport.width,
    );
  }
});
