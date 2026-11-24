// Partners, referral links, signup referrals, checkout attribution, and sales and refunds from
// Stripe's webhook: the seeded people (apps/affiliates/demo.ts), the shop's calls, and Stripe's
// events, through the apps. No browser: people's actions are sent as their pages send them, and
// what each did is read from the state stream of whoever did it, or the admin's (bus.ts). What a
// page shows of it is pages.test.ts's.
import { expect, test } from "vite-plus/test";
import { adminBus, createAccount, sell, stripeEvent, watch, written } from "./bus.ts";
import {
  AFFILIATES,
  checkoutVia,
  demoPartner,
  follow,
  paidSession,
  seededPartnerId,
  SHOP,
  shop,
} from "./helpers.ts";

test("applying makes a pending partner; only an admin can approve", async () => {
  const chris = await watch("chris@demo.test"); // a customer who never applied
  await chris.act("/", "apply", { name: "Chris Park", acceptTerms: true });
  const [applied] = (await chris.state()).partners();
  expect(applied).toMatchObject({ email: "chris@demo.test", status: "pending" });

  // Not an admin: the admin page refuses. Signed out: it sends you to the shop's sign-in.
  expect((await chris.get("/admin")).status).toBe(403);
  const stranger = await fetch(`${AFFILIATES}/admin`, { redirect: "manual" });
  expect(stranger.status).toBe(302);
  expect(stranger.headers.get("location")).toBe(
    `${SHOP}/?redirect=${encodeURIComponent(`${AFFILIATES}/admin`)}`,
  );
  // Nor can they approve themselves.
  await expect(
    chris.act("/admin", "changePartner", { id: applied?.id, status: "active" }),
  ).rejects.toThrow("403");

  await (await adminBus()).act("/admin", "changePartner", { id: applied?.id, status: "active" });
  expect((await written()).partners().find((p) => p.id === applied?.id)?.status).toBe("active");
  chris.close();
});

test("a referral link sends the visitor to the shop and sets the cookie", async () => {
  const first = await follow(`/r/ana?utm_source=youtube`);
  expect(first.status).toBe(302);
  expect(first.location).toBe(`${SHOP}/?utm_source=youtube`);
  expect(first.cookie).toMatch(/^affiliate_ref=[0-9a-f-]{36}$/);
});

test("a short link goes where it says, and its sales are its own", async () => {
  const priya = await watch(demoPartner("priya").email);
  await priya.act("/", "createLink", { destination: "/pricing", campaign: "Newsletter" });
  const link = (await priya.state()).links().find((l) => l.campaign === "Newsletter");
  if (!link) throw new Error("no link made");
  priya.close();

  const followed = await follow(`/r/${link.slug}`);
  expect(followed.location).toBe(`${SHOP}/pricing`);
  const checkout = await shop().checkout({
    userId: null,
    ref: followed.cookie?.split("=")[1] ?? null,
    promoCode: null,
    ip: null,
  });
  const session = paidSession(checkout.metadata);
  await stripeEvent("checkout.session.completed", session);
  const email = (session.customer_details as { email: string }).email;
  expect((await written()).sales().filter((s) => s.customerEmail === email)).toEqual([
    expect.objectContaining({ partnerId: seededPartnerId("priya"), linkId: link.id }),
  ]);
});

test("a user who signs up through a referral link stays the partner's at checkout, without the cookie", async () => {
  const { cookie } = await follow(`/r/leo`);
  // The shop publishes the sign-up to the hub, and the service, following it, records it
  // (apps/shop/src/published.ts, apps/affiliates/queues/wakes.ts): one action, "Sign up".
  const userId = await (await adminBus()).during("Sign up", () => createAccount("Buyer", cookie));
  expect((await written()).referrals().find((r) => r.userId === userId)).toMatchObject({
    partnerId: seededPartnerId("leo"),
    source: "signup",
  });
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
  const session = paidSession((await checkoutVia({ code: "priya" })).metadata);
  await stripeEvent("checkout.session.completed", session);
  await stripeEvent("checkout.session.completed", session); // Stripe sending it again
  const email = (session.customer_details as { email: string }).email;
  expect((await written()).sales().filter((s) => s.customerEmail === email)).toEqual([
    expect.objectContaining({ status: "pending", commissionCents: 1000 }), // her 20% of $50
  ]);
});

test("a refund or dispute in full marks the sale refunded, even when it arrives first; a won dispute undoes it", async () => {
  const { metadata } = await checkoutVia({ code: "leo" });
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
  const of = async (session: Record<string, unknown>) =>
    (await written()).sales().find((s) => s.paymentIntent === session.payment_intent);
  expect((await of(sale))?.status).toBe("refunded");
  expect((await of(early))?.status).toBe("refunded");

  // The dispute is won: the sale earns its commission again, back through the hold period.
  await stripeEvent("charge.dispute.closed", { ...dispute, status: "won" });
  expect(await of(early)).toMatchObject({
    status: "pending",
    commissionCents: 1000,
    refundedCents: 0,
  });
});

test("a partner buying for themselves is flagged", async () => {
  const { customer } = await sell(
    { code: "priya" },
    { customer_details: { email: "PRIYA@demo.test", address: null } },
  );
  // Emails are kept lowercase.
  expect(customer).toBe("PRIYA@demo.test");
  expect(
    (await written()).sales().find((s) => s.customerEmail === "priya@demo.test"),
  ).toMatchObject({ fraudReason: "self_email" });
});

test("a suspended partner's referrals and links stop counting", async () => {
  // Ken is suspended in the seed.
  expect((await follow(`/r/ken`)).cookie).toBeNull();
  const ken = seededPartnerId("ken");
  const checkout = await shop().checkout({ userId: null, ref: ken, promoCode: null, ip: null });
  expect(checkout.metadata).toEqual({});
  const session = paidSession({ affiliate_partner_id: ken, affiliate_source: "cookie" });
  await stripeEvent("checkout.session.completed", session);
  expect((await written()).sales().filter((s) => s.partnerId === ken)).toEqual([]);
});
