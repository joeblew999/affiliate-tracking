// Step 2 of plans/2026-11-22-01-void-service.md: partners, referral links, signup referrals, checkout
// attribution, and sales and refunds from Stripe's webhook, through the real apps and database.
import { expect, test } from "vite-plus/test";
import {
  activePartner,
  eventually,
  host,
  paidSession,
  partnerMe,
  salesOf,
  service,
  signInAdmin,
  signUp,
  stripeEvent,
} from "./helpers";
import { AFFILIATES } from "./setup";

interface Checkout {
  metadata: Record<string, string>;
  promotionCode: string | null;
}

/** Follow a referral link as a browser would: the redirect and the referral cookie it sets. */
async function follow(path: string, userAgent = "Mozilla/5.0 (Macintosh) Safari/605.1.15") {
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

test("applying makes a pending partner; only an admin can approve", async () => {
  const user = await signUp("Pat");
  const applied = await service<{ id: string; status: string }>("/api/partner/apply", user.cookie, {
    name: "Pat",
    acceptTerms: true,
  });
  expect(applied.body.status).toBe("pending");
  expect(
    (await service("/api/partner/apply", user.cookie, { name: "Pat", acceptTerms: true })).status,
  ).toBe(409);
  expect(
    (
      await service("/api/admin/partners/status", user.cookie, {
        id: applied.body.id,
        status: "active",
      })
    ).status,
  ).toBe(403);
  expect((await service("/api/admin/partners", "")).status).toBe(401);
  const admin = await signInAdmin();
  expect(
    (
      await service("/api/admin/partners/status", admin.cookie, {
        id: applied.body.id,
        status: "active",
      })
    ).status,
  ).toBe(200);
  expect((await partnerMe(user.cookie)).status).toBe("active");
});

test("a referral link sends the visitor to the shop, sets the cookie and counts one click", async () => {
  const nick = await activePartner();
  const first = await follow(`/r/${nick.code}?utm_source=youtube`);
  expect(first.status).toBe(302);
  expect(first.location).toBe("http://localhost:5173/?utm_source=youtube");
  expect(first.cookie).toBe(`affiliate_ref=${nick.partnerId}`);
  await follow(`/r/${nick.code}`); // same visitor again: still one click
  await eventually(async () => expect((await partnerMe(nick.cookie)).clicks).toBe(1));
});

test("a short link counts its own clicks and sales", async () => {
  const nick = await activePartner();
  const made = await service<{ link: { id: string; slug: string } }>(
    "/api/partner/links",
    nick.cookie,
    { destination: "/pricing", campaign: "Newsletter" },
  );
  const followed = await follow(`/r/${made.body.link.slug}`);
  expect(followed.location).toBe("http://localhost:5173/pricing");
  await stripeEvent(
    "checkout.session.completed",
    paidSession({ affiliate_partner_id: nick.partnerId, affiliate_link_id: made.body.link.id }),
  );
  await eventually(async () => {
    const { body } = await service<{ links: { id: string; clicks: number; sales: number }[] }>(
      "/api/partner/links",
      nick.cookie,
    );
    expect(body.links.find((link) => link.id === made.body.link.id)).toMatchObject({
      clicks: 1,
      sales: 1,
    });
  });
});

test("a user who signs up with the referral cookie stays the partner's at checkout, without the cookie", async () => {
  const nick = await activePartner();
  const { cookie } = await follow(`/r/${nick.code}`);
  const buyer = await signUp("Buyer", cookie ?? "");
  // The shop tells the service through a queue (apps/shop/queues/affiliate-signups.ts).
  await eventually(async () => {
    const checkout = await host<Checkout>("/api/host/checkout", {
      userId: buyer.id,
      ref: null,
      promoCode: null,
      ip: null,
    });
    expect(checkout.metadata).toMatchObject({
      affiliate_partner_id: nick.partnerId,
      affiliate_source: "referral",
      affiliate_user_id: buyer.id,
    });
  });
});

test("checkout without a referral uses the cookie, and nothing without either", async () => {
  const nick = await activePartner();
  const viaCookie = await host<Checkout>("/api/host/checkout", {
    userId: null,
    ref: nick.partnerId,
    promoCode: null,
    ip: "203.0.113.9",
  });
  expect(viaCookie.metadata).toMatchObject({
    affiliate_partner_id: nick.partnerId,
    affiliate_source: "cookie",
  });
  expect(viaCookie.metadata.affiliate_buyer_ip_hash).toMatch(/^[0-9a-f]{64}$/);
  const nothing = await host<Checkout>("/api/host/checkout", {
    userId: null,
    ref: "made-up",
    promoCode: null,
    ip: null,
  });
  expect(nothing).toEqual({ metadata: {}, promotionCode: null });
});

test("a paid checkout becomes a sale once", async () => {
  const nick = await activePartner();
  const session = paidSession({ affiliate_partner_id: nick.partnerId, affiliate_source: "cookie" });
  await stripeEvent("checkout.session.completed", session);
  await stripeEvent("checkout.session.completed", session); // Stripe sending it again
  const me = await partnerMe(nick.cookie);
  expect({ sales: me.sales, commissionCents: me.commissionCents }).toEqual({
    sales: 1,
    commissionCents: 1000,
  });
});

test("a refund or dispute in full marks the sale refunded, even when it arrives first; a won dispute undoes it", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  const sale = paidSession({ affiliate_partner_id: nick.partnerId });
  await stripeEvent("checkout.session.completed", sale);
  await stripeEvent("charge.refunded", {
    id: "ch_1",
    object: "charge",
    amount: 5000,
    amount_refunded: 5000,
    payment_intent: sale.payment_intent,
  });

  const early = paidSession({ affiliate_partner_id: nick.partnerId });
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

  const all = await service<{ sales: { stripeSessionId: string; status: string }[] }>(
    "/api/admin/sales",
    admin.cookie,
  );
  const status = (id: unknown) => all.body.sales.find((s) => s.stripeSessionId === id)?.status;
  expect([status(sale.id), status(early.id)]).toEqual(["refunded", "refunded"]);
  expect((await partnerMe(nick.cookie)).sales).toBe(0);

  // The dispute is won: the sale earns its commission again, back through the hold period.
  await stripeEvent("charge.dispute.closed", { ...dispute, status: "won" });
  const won = (await salesOf(nick.partnerId)).find((s) => s.stripeSessionId === early.id);
  expect(won).toMatchObject({ status: "pending", commissionCents: 1000, refundedCents: 0 });
});

test("a partner buying for themselves is flagged", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  const session = paidSession(
    { affiliate_partner_id: nick.partnerId },
    { customer_details: { email: nick.email.toUpperCase(), address: null } },
  );
  await stripeEvent("checkout.session.completed", session);
  const all = await service<{ sales: { stripeSessionId: string; fraudReason: string | null }[] }>(
    "/api/admin/sales",
    admin.cookie,
  );
  expect(all.body.sales.find((s) => s.stripeSessionId === session.id)?.fraudReason).toBe(
    "self_email",
  );
});

test("a suspended partner's referrals and links stop counting", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  await service("/api/admin/partners/status", admin.cookie, {
    id: nick.partnerId,
    status: "suspended",
  });
  expect((await follow(`/r/${nick.code}`)).cookie).toBeNull();
  const checkout = await host<Checkout>("/api/host/checkout", {
    userId: null,
    ref: nick.partnerId,
    promoCode: null,
    ip: null,
  });
  expect(checkout.metadata).toEqual({});
  const session = paidSession({ affiliate_partner_id: nick.partnerId });
  await stripeEvent("checkout.session.completed", session);
  expect((await salesOf(nick.partnerId)).some((sale) => sale.stripeSessionId === session.id)).toBe(
    false,
  );
});
