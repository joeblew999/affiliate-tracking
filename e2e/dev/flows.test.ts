// Partners, referral links, signup referrals, checkout attribution, and sales and refunds from
// Stripe's webhook: the seeded people (apps/affiliates/demo.ts) in a browser, the shop's calls, and
// Stripe's events, through both apps. Each check is a change from what the seed starts with.
import { expect, test } from "vite-plus/test";
import {
  AFFILIATES,
  apply,
  checkoutVia,
  demoPartner,
  eventually,
  follow,
  linksOf,
  newBrowser,
  open,
  paidSession,
  partnerButton,
  partnerMe,
  partnerPage,
  saleOf,
  salesOf,
  seededPartner,
  seededPartnerId,
  SHOP,
  shop,
  signInAs,
  signUp,
  stripeEvent,
  userIdOf,
} from "./helpers.ts";

test("applying makes a pending partner; only an admin can approve", async () => {
  const chris = await signInAs("chris@demo.test"); // a customer who never applied
  await apply(chris);
  expect((await partnerPage(chris)).status).toBe("pending");

  // Not an admin: the admin page says so. Signed out: it sends you to the shop's sign-in.
  await open(chris.page, `${AFFILIATES}/admin`);
  await chris.page.getByText("Admins only").waitFor();
  const stranger = await newBrowser();
  await open(stranger.page, `${AFFILIATES}/admin`);
  expect(stranger.page.url()).toBe(
    `${SHOP}/?redirect=${encodeURIComponent(`${AFFILIATES}/admin`)}`,
  );

  await partnerButton(chris.name, "Approve");
  expect((await partnerPage(chris)).status).toBe("active");
});

test("a referral link sends the visitor to the shop, sets the cookie and counts one click", async () => {
  const ana = await seededPartner("ana");
  const before = (await partnerMe(ana)).clicks;
  const first = await follow(`/r/ana?utm_source=youtube`);
  expect(first.status).toBe(302);
  expect(first.location).toBe(`${SHOP}/?utm_source=youtube`);
  expect(first.cookie).toMatch(/^affiliate_ref=[0-9a-f-]{36}$/);
  await follow(`/r/ana`); // same visitor again: still one click
  await eventually(async () => expect((await partnerMe(ana)).clicks).toBe(before + 1));
});

test("a short link counts its own clicks and sales", async () => {
  const priya = await seededPartner("priya");
  await open(priya.page, `${AFFILIATES}/`);
  await priya.page.getByLabel("Goes to").fill("/pricing");
  await priya.page.getByLabel("Campaign").fill("Newsletter");
  await priya.page.getByRole("button", { name: "Create link" }).click();
  await priya.page.getByRole("cell", { name: "Newsletter" }).waitFor();
  const link = (await linksOf(priya)).find((l) => l.campaign === "Newsletter");
  if (!link) throw new Error("no link made");

  const followed = await follow(new URL(link.url).pathname);
  expect(followed.location).toBe(`${SHOP}/pricing`);
  const checkout = await shop().checkout({
    userId: null,
    ref: followed.cookie?.split("=")[1] ?? null,
    promoCode: null,
    ip: null,
  });
  await stripeEvent("checkout.session.completed", paidSession(checkout.metadata));
  await eventually(async () => {
    expect((await linksOf(priya)).find((l) => l.campaign === "Newsletter")).toMatchObject({
      clicks: 1,
      sales: 1,
    });
  });
});

test("a user who signs up through a referral link stays the partner's at checkout, without the cookie", async () => {
  const leo = await seededPartner("leo");
  const before = (await partnerMe(leo)).signups;
  const buyer = await signUp("Buyer", { via: `/r/leo` });
  const userId = await userIdOf(buyer);
  // The shop tells the service through a queue (apps/shop/queues/affiliate-signups.ts).
  await eventually(async () => expect((await partnerMe(leo)).signups).toBe(before + 1));
  const checkout = await shop().checkout({ userId, ref: null, promoCode: null, ip: null });
  expect(checkout.metadata).toMatchObject({
    affiliate_partner_id: seededPartnerId("leo"),
    affiliate_source: "referral",
    affiliate_user_id: userId,
  });
});

test("checkout without a referral uses the cookie, and nothing without either", async () => {
  const { cookie } = await follow(`/r/ana`);
  const viaCookie = await shop().checkout({
    userId: null,
    ref: cookie?.split("=")[1] ?? null,
    promoCode: null,
    ip: "203.0.113.9",
  });
  expect(viaCookie.metadata).toMatchObject({
    affiliate_partner_id: seededPartnerId("ana"),
    affiliate_source: "cookie",
  });
  expect(viaCookie.metadata.affiliate_buyer_ip_hash).toMatch(/^[0-9a-f]{64}$/);
  const nothing = await shop().checkout({
    userId: null,
    ref: "made-up",
    promoCode: null,
    ip: null,
  });
  expect(nothing).toEqual({ metadata: {}, promotionCode: null });
});

test("a paid checkout becomes a sale once, on hold", async () => {
  const priya = await seededPartner("priya");
  const session = paidSession((await checkoutVia(priya)).metadata);
  await stripeEvent("checkout.session.completed", session);
  await stripeEvent("checkout.session.completed", session); // Stripe sending it again
  const email = (session.customer_details as { email: string }).email;
  expect((await salesOf(priya.name)).filter((s) => s.customer === email)).toEqual([
    expect.objectContaining({ status: "pending", commissionCents: 1000 }), // her 20% of $50
  ]);
});

test("a refund or dispute in full marks the sale refunded, even when it arrives first; a won dispute undoes it", async () => {
  const leo = await seededPartner("leo");
  const { metadata } = await checkoutVia(leo);
  const sale = paidSession(metadata);
  await stripeEvent("checkout.session.completed", sale);
  await stripeEvent("charge.refunded", {
    id: "ch_1",
    object: "charge",
    amount: 5000,
    amount_refunded: 5000,
    payment_intent: sale.payment_intent,
  });

  const early = paidSession(metadata);
  const dispute = {
    id: "dp_1",
    object: "dispute",
    amount: 5000,
    charge: "ch_2",
    payment_intent: early.payment_intent,
    status: "needs_response",
  };
  await stripeEvent("charge.dispute.created", dispute);
  await stripeEvent("checkout.session.completed", early);
  expect((await saleOf(leo.name, sale))?.status).toBe("refunded");
  expect((await saleOf(leo.name, early))?.status).toBe("refunded");

  // The dispute is won: the sale earns its commission again, back through the hold period.
  await stripeEvent("charge.dispute.closed", { ...dispute, status: "won" });
  expect(await saleOf(leo.name, early)).toMatchObject({
    status: "pending",
    commissionCents: 1000,
    notes: "",
  });
});

test("a partner buying for themselves is flagged", async () => {
  const priya = await seededPartner("priya");
  const session = paidSession((await checkoutVia(priya)).metadata, {
    customer_details: { email: "PRIYA@demo.test", address: null },
  });
  await stripeEvent("checkout.session.completed", session);
  expect((await saleOf(priya.name, session))?.notes).toBe("Flagged: the partner's own email");
});

test("a suspended partner's referrals and links stop counting", async () => {
  // Ken is suspended in the seed.
  expect((await follow(`/r/ken`)).cookie).toBeNull();
  const ken = seededPartnerId("ken");
  const checkout = await shop().checkout({ userId: null, ref: ken, promoCode: null, ip: null });
  expect(checkout.metadata).toEqual({});
  const session = paidSession({ affiliate_partner_id: ken, affiliate_source: "cookie" });
  await stripeEvent("checkout.session.completed", session);
  expect(await saleOf(demoPartner("ken").name, session)).toBeUndefined();
});
