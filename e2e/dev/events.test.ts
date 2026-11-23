// Events, their venues and organisers, on the seeded demo (apps/affiliates/demo.ts): booking one
// pays its venue first, then puts it on sale and emails every shop user (Void's dev inbox); a
// ticket pays its organiser and the affiliate who brought the buyer, and a refund takes back both;
// the admin page's money for an event is the fixtures'; and an organiser is never an affiliate.
import { expect, test } from "vite-plus/test";
import {
  demoEvents,
  demoOrganiserShares,
  demoPeople,
  demoSales,
  demoVenues,
} from "../../apps/affiliates/demo.ts";
import {
  activity,
  admin,
  adminTab,
  AFFILIATES,
  checkoutVia,
  demoPartner,
  inbox,
  open,
  paidSession,
  payoutsOf,
  press,
  salesOf,
  seededEventId,
  seededPartner,
  SHOP,
  signInAs,
  stripeEvent,
} from "./helpers.ts";
import { DEMO_NOW } from "../../apps/affiliates/demo.ts";

const DAY = 24 * 60 * 60 * 1000;
const usd = (cents: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(cents / 100);

test("booking an event pays its venue first, then puts it on sale and emails every shop user", async () => {
  const venue = demoVenues.meetRoom;
  const contact = demoPartner(venue.contact);
  const organiser = demoPartner("olivia");
  const seededVenuePayouts = (await payoutsOf(contact.name)).length;

  const panel = await adminTab(/^Events/);
  const form = panel.locator("form").first();
  await form.getByPlaceholder("Name").fill("Launch party");
  await form.getByPlaceholder("Description").fill("An hour to see what's new, and ask.");
  await form
    .getByLabel("Venue")
    .selectOption({ label: `${venue.name}: ${venue.capacity} places, ${usd(venue.priceCents)}` });
  await form.getByLabel("Organiser", { exact: true }).selectOption({ label: organiser.name });
  await form.getByLabel("Organiser's percent").fill("12");
  await form.getByLabel("Ticket price").fill("49");
  const starts = new Date(Date.parse(DEMO_NOW) + 30 * DAY).toISOString().slice(0, 16);
  await form.getByLabel("Starts (UTC)").fill(starts);
  await form.getByLabel("Hours").fill("1");
  // One action, in the admin's control plane: the venue's payout, on sale, the shop told, the
  // emails, whichever app each step ran in.
  const { page } = await admin();
  const pane = await activity(page);
  const before = await pane.seen();
  await press(page, form.getByRole("button", { name: "Book event" }));
  await pane.finished("Book event", { after: before });

  // The venue's price, paid to its contact (by hand here: no Stripe in the dev tests).
  const payouts = await payoutsOf(contact.name);
  expect(payouts).toHaveLength(seededVenuePayouts + 1);
  expect(payouts[0]).toMatchObject({ amountCents: venue.priceCents, status: "manual" });

  // Then it's on sale at the shop, and every shop user is told.
  await open(page, SHOP);
  expect(await page.getByRole("link", { name: "Launch party" }).count()).toBe(1);
  const sent = (await inbox()).filter((m) => m.subject === "On sale now: Launch party");
  expect(sent.map((m) => m.to).sort()).toEqual(demoPeople.map((p) => p.email).sort());
  expect(sent[0]?.text).toContain(venue.location);
  expect(sent[0]?.text).toContain("/unsubscribe?u=");
});

test("a ticket pays its organiser their share and the affiliate theirs; a refund in full takes back both", async () => {
  const leo = await seededPartner("leo"); // 20%
  const workshop = demoEvents.workshop; // Olivia's, 15%
  const olivia = demoPartner(workshop.organiser);
  const session = paidSession(
    (await checkoutVia(leo, { eventId: seededEventId("workshop") })).metadata,
    { amount_total: workshop.cents },
  );
  await stripeEvent("checkout.session.completed", session);
  const buyer = (session.customer_details as { email: string }).email;
  const rowOf = async (name: string) =>
    (await salesOf(name)).find((s) => s.customer === buyer && !s.notes.startsWith("clawback"));
  expect(await rowOf(leo.name)).toMatchObject({ commissionCents: 580, status: "pending" });
  expect(await rowOf(olivia.name)).toMatchObject({
    commissionCents: Math.round((workshop.cents * workshop.organiserPct) / 100),
    status: "pending",
  });

  await stripeEvent("charge.refunded", {
    id: "ch_ticket_refund",
    object: "charge",
    amount: workshop.cents,
    amount_refunded: workshop.cents,
    payment_intent: session.payment_intent,
  });
  expect(await rowOf(leo.name)).toMatchObject({ commissionCents: 0, status: "refunded" });
  expect(await rowOf(olivia.name)).toMatchObject({ commissionCents: 0, status: "refunded" });
});

test("a ticket no affiliate brought still pays its organiser", async () => {
  const masterclass = demoEvents.masterclass; // Raj's, 20%
  const raj = demoPartner(masterclass.organiser);
  const session = paidSession(
    (await checkoutVia(null, { eventId: seededEventId("masterclass") })).metadata,
    { amount_total: masterclass.cents },
  );
  await stripeEvent("checkout.session.completed", session);
  const buyer = (session.customer_details as { email: string }).email;
  expect((await salesOf(raj.name)).find((s) => s.customer === buyer)).toMatchObject({
    commissionCents: Math.round((masterclass.cents * masterclass.organiserPct) / 100),
  });
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

test("an organiser has their events and payouts, and is never an affiliate", async () => {
  const olivia = demoPartner("olivia");
  const { page } = await signInAs(olivia.email);
  await open(page, `${AFFILIATES}/`);
  await page.getByText("Your events", { exact: true }).waitFor();
  await page.getByRole("cell", { name: new RegExp(demoEvents.workshop.name) }).waitFor();
  expect(await page.getByRole("button", { name: "Apply" }).count()).toBe(0);
  expect(await page.getByText("Your link").count()).toBe(0);

  // Nor can an affiliate be made an organiser.
  const panel = await adminTab(/^Events/);
  const form = panel.locator("form").nth(1);
  await form.getByPlaceholder("Organiser's email").fill(demoPartner("maya").email);
  await expect(
    press((await admin()).page, form.getByRole("button", { name: "Add organiser" })),
  ).rejects.toThrow(`${demoPartner("maya").email} is already an affiliate`);
});
