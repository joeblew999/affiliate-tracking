// Partners, referral links, signup referrals, checkout attribution, and sales and refunds from
// Stripe's webhook: people in a browser, the shop's calls, and Stripe's events, through both apps.
import { expect, test } from "vite-plus/test";
import {
  activePartner,
  AFFILIATES,
  apply,
  checkoutVia,
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
  shop,
  SHOP,
  signUp,
  stripeEvent,
  userIdOf,
} from "./helpers.ts";

test("applying makes a pending partner; only an admin can approve", async () => {
  const pat = await signUp(`Pat ${crypto.randomUUID().slice(0, 6)}`);
  await apply(pat);
  expect((await partnerPage(pat)).status).toBe("pending");

  // Not an admin: the admin page says so. Signed out: it sends you to the shop's sign-in.
  await open(pat.page, `${AFFILIATES}/admin`);
  await pat.page.getByText("Admins only").waitFor();
  const stranger = await newBrowser();
  await open(stranger.page, `${AFFILIATES}/admin`);
  expect(stranger.page.url()).toBe(
    `${SHOP}/?redirect=${encodeURIComponent(`${AFFILIATES}/admin`)}`,
  );

  await partnerButton(pat.name, "Approve");
  expect((await partnerPage(pat)).status).toBe("active");
});

test("a referral link sends the visitor to the shop, sets the cookie and counts one click", async () => {
  const nick = await activePartner();
  const first = await follow(`/r/${nick.code}?utm_source=youtube`);
  expect(first.status).toBe(302);
  expect(first.location).toBe(`${SHOP}/?utm_source=youtube`);
  expect(first.cookie).toMatch(/^affiliate_ref=[0-9a-f-]{36}$/);
  await follow(`/r/${nick.code}`); // same visitor again: still one click
  await eventually(async () => expect((await partnerMe(nick)).clicks).toBe(1));
});

test("a short link counts its own clicks and sales", async () => {
  const nick = await activePartner();
  await open(nick.page, `${AFFILIATES}/`);
  await nick.page.getByLabel("Goes to").fill("/pricing");
  await nick.page.getByLabel("Campaign").fill("Newsletter");
  await nick.page.getByRole("button", { name: "Create link" }).click();
  await nick.page.getByRole("cell", { name: "Newsletter" }).waitFor();
  const link = (await linksOf(nick)).find((l) => l.campaign === "Newsletter");
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
    expect((await linksOf(nick)).find((l) => l.campaign === "Newsletter")).toMatchObject({
      clicks: 1,
      sales: 1,
    });
  });
});

test("a user who signs up through a referral link stays the partner's at checkout, without the cookie", async () => {
  const nick = await activePartner();
  const buyer = await signUp("Buyer", { via: `/r/${nick.code}` });
  const userId = await userIdOf(buyer);
  // The shop tells the service through a queue (apps/shop/queues/affiliate-signups.ts).
  await eventually(async () => expect((await partnerMe(nick)).signups).toBe(1));
  const checkout = await shop().checkout({ userId, ref: null, promoCode: null, ip: null });
  expect(checkout.metadata).toMatchObject({
    affiliate_source: "referral",
    affiliate_user_id: userId,
  });
});

test("checkout without a referral uses the cookie, and nothing without either", async () => {
  const nick = await activePartner();
  const { cookie } = await follow(`/r/${nick.code}`);
  const viaCookie = await shop().checkout({
    userId: null,
    ref: cookie?.split("=")[1] ?? null,
    promoCode: null,
    ip: "203.0.113.9",
  });
  expect(viaCookie.metadata).toMatchObject({ affiliate_source: "cookie" });
  expect(viaCookie.metadata.affiliate_buyer_ip_hash).toMatch(/^[0-9a-f]{64}$/);
  const nothing = await shop().checkout({
    userId: null,
    ref: "made-up",
    promoCode: null,
    ip: null,
  });
  expect(nothing).toEqual({ metadata: {}, promotionCode: null });
});

test("a paid checkout becomes a sale once", async () => {
  const nick = await activePartner();
  const session = paidSession((await checkoutVia(nick)).metadata);
  await stripeEvent("checkout.session.completed", session);
  await stripeEvent("checkout.session.completed", session); // Stripe sending it again
  const me = await partnerMe(nick);
  expect({ sales: me.sales, onHoldCents: me.onHoldCents }).toEqual({ sales: 1, onHoldCents: 1000 });
});

test("a refund or dispute in full marks the sale refunded, even when it arrives first; a won dispute undoes it", async () => {
  const nick = await activePartner();
  const { metadata } = await checkoutVia(nick);
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

  expect((await saleOf(nick.name, sale))?.status).toBe("refunded");
  expect((await saleOf(nick.name, early))?.status).toBe("refunded");
  expect((await partnerMe(nick)).sales).toBe(0);

  // The dispute is won: the sale earns its commission again, back through the hold period.
  await stripeEvent("charge.dispute.closed", { ...dispute, status: "won" });
  expect(await saleOf(nick.name, early)).toMatchObject({
    status: "pending",
    commissionCents: 1000,
    notes: "",
  });
});

test("a partner buying for themselves is flagged", async () => {
  const nick = await activePartner();
  const session = paidSession((await checkoutVia(nick)).metadata, {
    customer_details: { email: nick.email.toUpperCase(), address: null },
  });
  await stripeEvent("checkout.session.completed", session);
  expect((await saleOf(nick.name, session))?.notes).toBe("Flagged: the partner's own email");
});

test("a suspended partner's referrals and links stop counting", async () => {
  const nick = await activePartner();
  const { metadata } = await checkoutVia(nick);
  await partnerButton(nick.name, "Suspend");
  expect((await follow(`/r/${nick.code}`)).cookie).toBeNull();
  const checkout = await shop().checkout({
    userId: null,
    ref: metadata.affiliate_partner_id ?? null,
    promoCode: null,
    ip: null,
  });
  expect(checkout.metadata).toEqual({});
  const session = paidSession(metadata);
  await stripeEvent("checkout.session.completed", session);
  expect(await saleOf(nick.name, session)).toBeUndefined();
});
