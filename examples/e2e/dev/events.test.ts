// Events, their venues and organisers, on the seeded demo (examples/affiliates/demo.ts): booking one
// pays its venue first, then puts it on sale and emails every shop user (Void's dev inbox); a
// ticket pays its organiser and the affiliate who brought the buyer, and a refund takes back both;
// and an organiser is never an affiliate. No browser: what each action did is read from the
// admin's state stream (bus.ts). What the pages show of events is pages.test.ts's.
import { expect, test } from "vite-plus/test";
import { DEMO_NOW, demoEvents, demoPeople, demoVenues, fixtureId } from "../../affiliates/demo.ts";
import { adminBus, sell, stripeEvent, written } from "./bus.ts";
import { demoPartner, inbox, seededEventId, seededPartnerId } from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;

test("booking an event pays its venue first, then puts it on sale and emails every shop user", async () => {
  const venue = demoVenues.meetRoom;
  const contact = seededPartnerId(venue.contact);
  // One action, in the admin's control plane: the venue's payout, on sale, the shop told, the
  // emails, whichever app each step ran in.
  await (
    await adminBus()
  ).act("/admin", "bookEvent", {
    name: "Launch party",
    description: "An hour to see what's new, and ask.",
    venueId: fixtureId("venue:meetRoom"),
    organiserId: seededPartnerId("olivia"),
    organiserPct: 12,
    priceCents: 4900,
    startsAt: new Date(Date.parse(DEMO_NOW) + 30 * DAY).toISOString().slice(0, 16),
    hours: 1,
  });
  const state = await written();

  // The venue's price, paid to its contact (by hand here: no Stripe in the dev tests).
  expect(state.payouts().filter((p) => p.partnerId === contact)).toEqual([
    expect.objectContaining({ amountCents: venue.priceCents, status: "manual" }),
  ]);
  // Then it's on sale, and every shop user is told.
  const [event] = state.events();
  expect(event).toMatchObject({ name: "Launch party", priceCents: 4900 });
  expect(event?.onSaleAt).not.toBeNull();
  const sent = (await inbox()).filter((m) => m.subject === "On sale now: Launch party");
  expect(sent.map((m) => m.to).sort()).toEqual(demoPeople.map((p) => p.email).sort());
  expect(sent[0]?.text).toContain(venue.location);
  expect(sent[0]?.text).toContain("/unsubscribe?u=");
});

test("a ticket pays its organiser their share and the affiliate theirs; a refund in full takes back both", async () => {
  const workshop = demoEvents.workshop; // Olivia's, 15%; Leo brings the buyer, 20%
  const { session, customer } = await sell(
    { code: "leo" },
    { amount_total: workshop.cents },
    { eventId: seededEventId("workshop") },
  );
  const rowOf = async (code: string) =>
    (await written())
      .sales()
      .find(
        (s) =>
          s.customerEmail === customer &&
          s.partnerId === seededPartnerId(code) &&
          s.kind !== "clawback",
      );
  expect(await rowOf("leo")).toMatchObject({ commissionCents: 580, status: "pending" });
  expect(await rowOf(workshop.organiser)).toMatchObject({
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
  expect(await rowOf("leo")).toMatchObject({ commissionCents: 0, status: "refunded" });
  expect(await rowOf(workshop.organiser)).toMatchObject({
    commissionCents: 0,
    status: "refunded",
  });
});

test("a ticket no affiliate brought still pays its organiser", async () => {
  const masterclass = demoEvents.masterclass; // Raj's, 20%
  const { customer } = await sell(
    null,
    { amount_total: masterclass.cents },
    { eventId: seededEventId("masterclass") },
  );
  expect((await written()).sales().filter((s) => s.customerEmail === customer)).toEqual([
    expect.objectContaining({
      partnerId: seededPartnerId(masterclass.organiser),
      commissionCents: Math.round((masterclass.cents * masterclass.organiserPct) / 100),
    }),
  ]);
});

test("an affiliate can't be made an organiser", async () => {
  const maya = demoPartner("maya").email;
  await expect((await adminBus()).act("/admin", "addOrganiser", { email: maya })).rejects.toThrow(
    `${maya} is already an affiliate`,
  );
});
