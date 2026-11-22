// Step 3 of plans/2026-11-22-01-void-service.md: commission rules and bonuses, renewals, the hold
// period, admin decisions, and payouts through the queue, against the real apps and database.
// Rules here are always for one partner, so they don't change other tests' commission.
import { expect, test } from "vite-plus/test";
import {
  activePartner,
  eventually,
  paidSession,
  runCron,
  salesOf,
  service,
  signInAdmin,
  stripeEvent,
} from "./helpers";

const DAILY = "17 3 * * *";

/** Each session's commission, in the order given (sales in the same second share a time). */
async function commissionsOf(
  partnerId: string,
  sessions: Record<string, unknown>[],
): Promise<number[]> {
  const sales = await salesOf(partnerId);
  return sessions.map(
    (session) => sales.find((sale) => sale.stripeSessionId === session.id)?.commissionCents ?? -1,
  );
}

async function sell(partnerId: string, overrides: Record<string, unknown> = {}, daysAgo = 0) {
  const session = paidSession({ affiliate_partner_id: partnerId }, overrides);
  await stripeEvent("checkout.session.completed", session, { daysAgo });
  expect((await salesOf(partnerId)).some((sale) => sale.stripeSessionId === session.id)).toBe(true);
  return session;
}

test("a partner's rules: percent and the monthly tier", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  const rule = (body: Record<string, unknown>) =>
    service("/api/admin/rules", admin.cookie, { partnerId: nick.partnerId, ...body });
  expect((await rule({ kind: "percent", percent: 30 })).status).toBe(200);
  expect((await rule({ kind: "percent", percent: 40, minMonthlySales: 2 })).status).toBe(200);

  // Both are for this partner and any product, so equally specific: the highest tier reached
  // wins, then the oldest rule. Sales 1 and 2 (0 and 1 before them this month): the 30% rule.
  // Sale 3 (2 before it): the 40% tier.
  const sold = [
    await sell(nick.partnerId, { amount_total: 5000 }),
    await sell(nick.partnerId, { amount_total: 5000 }),
    await sell(nick.partnerId, { amount_total: 5000 }), // 2 sales already this month: the 40% tier
  ];
  expect(await commissionsOf(nick.partnerId, sold)).toEqual([1500, 1500, 2000]);
});

test("a capped rule stops paying for a customer once the cap is reached", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  await service("/api/admin/rules", admin.cookie, {
    partnerId: nick.partnerId,
    kind: "percent",
    percent: 50,
    capPerCustomerCents: 3000,
  });
  const buyer = { customer_details: { email: "repeat@buyer.test", address: null } };
  const sold = [
    await sell(nick.partnerId, { amount_total: 4000, ...buyer }), // 2000
    await sell(nick.partnerId, { amount_total: 4000, ...buyer }), // 1000 left under the cap
    await sell(nick.partnerId, { amount_total: 4000, ...buyer }), // 0
    await sell(nick.partnerId, { amount_total: 4000 }), // another customer: 2000
  ];
  expect(await commissionsOf(nick.partnerId, sold)).toEqual([2000, 1000, 0, 2000]);
});

test("the hold period approves old sales, except disputed, flagged, reviewed or rejected ones", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  const old = await sell(nick.partnerId, {}, 31);
  const recent = await sell(nick.partnerId, {}, 5);
  const flagged = await sell(
    nick.partnerId,
    { customer_details: { email: nick.email, address: null } },
    31,
  );
  const disputed = await sell(nick.partnerId, {}, 31);
  await stripeEvent("charge.dispute.created", {
    id: `dp_${crypto.randomUUID()}`,
    object: "dispute",
    amount: 1000, // part of it: the sale stays, on hold while the dispute is open
    charge: "ch_x",
    payment_intent: disputed.payment_intent,
    status: "needs_response",
  });
  const rejected = await sell(nick.partnerId, {}, 31);
  const rejectedId = (await salesOf(nick.partnerId)).find(
    (s) => s.stripeSessionId === rejected.id,
  )?.id;
  expect(
    (await service("/api/admin/sales/status", admin.cookie, { id: rejectedId, status: "rejected" }))
      .status,
  ).toBe(200);

  const reviewed = await activePartner("Rita");
  await service("/api/admin/partners/update", admin.cookie, {
    id: reviewed.partnerId,
    reviewRequired: true,
  });
  const reviewedSale = await sell(reviewed.partnerId, {}, 31);

  await runCron(DAILY);
  const status = async (partnerId: string, sessionId: unknown) =>
    (await salesOf(partnerId)).find((s) => s.stripeSessionId === sessionId)?.status;
  expect(await status(nick.partnerId, old.id)).toBe("approved");
  expect(await status(nick.partnerId, recent.id)).toBe("pending");
  expect(await status(nick.partnerId, disputed.id)).toBe("pending");
  expect(await status(nick.partnerId, flagged.id)).toBe("pending");
  expect(await status(nick.partnerId, rejected.id)).toBe("rejected");
  expect(await status(reviewed.partnerId, reviewedSale.id)).toBe("pending");
});

test("renewals pay the first sale's partner for their recurring months, once per invoice", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  await service("/api/admin/partners/update", admin.cookie, {
    id: nick.partnerId,
    recurringMonths: 2,
  });
  const subscription = `sub_${crypto.randomUUID().replaceAll("-", "")}`;
  await sell(
    nick.partnerId,
    {
      // No `mode: "subscription"`: with it, the shop's Better Auth Stripe plugin fetches the
      // subscription from Stripe, which this made-up one isn't in. The service reads only its id.
      subscription,
      customer: "cus_renew",
      amount_total: 2000,
      payment_intent: null,
    },
    70,
  );

  const invoice = (n: number, daysAgo: number, reason = "subscription_cycle") => ({
    id: `in_${subscription}_${n}`,
    object: "invoice",
    billing_reason: reason,
    amount_paid: 2000,
    currency: "usd",
    customer: "cus_renew",
    customer_email: "sub@buyer.test",
    customer_address: null,
    parent: { type: "subscription_details", subscription_details: { subscription } },
    status_transitions: { paid_at: Math.floor((Date.now() - daysAgo * 86_400_000) / 1000) },
    lines: { data: [] },
    payments: { data: [] },
  });
  /** The partner's renewals' commissions after the invoice is paid. */
  const renew = async (body: Record<string, unknown>) => {
    await stripeEvent("invoice.paid", body);
    return (await salesOf(nick.partnerId))
      .filter((s) => s.kind === "renewal")
      .map((s) => s.commissionCents);
  };
  expect(await renew(invoice(0, 70, "subscription_create"))).toEqual([]); // the checkout sale
  expect(await renew(invoice(1, 40))).toEqual([400]);
  expect(await renew(invoice(1, 40))).toEqual([400]); // the same invoice again
  expect(await renew(invoice(2, 5))).toEqual([400]); // past the partner's 2 recurring months
});

test("a payout run pays each partner's approved sales and bonuses, through the queue", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  const sold = await sell(nick.partnerId, { amount_total: 5000 }, 31); // 1000 commission
  await runCron(DAILY);
  expect(
    (
      await service("/api/admin/bonus", admin.cookie, {
        partnerId: nick.partnerId,
        commissionCents: 2500,
        bonusNote: "Launch week",
      })
    ).status,
  ).toBe(200);
  const run = await service<{ queued: number }>("/api/admin/payouts/run", admin.cookie, {
    partnerId: nick.partnerId,
  });
  expect(run.body.queued).toBe(1);

  await eventually(async () => {
    const payouts = await service<{
      payouts: { partnerId: string; status: string; amountCents: number }[];
    }>("/api/admin/payouts", admin.cookie);
    // No Connect account: a manual payout, for an admin to pay.
    expect(payouts.body.payouts.filter((p) => p.partnerId === nick.partnerId)).toEqual([
      expect.objectContaining({ status: "manual", amountCents: 3500 }),
    ]);
  });
  const paid = await salesOf(nick.partnerId);
  expect(paid.map((s) => s.status)).toEqual(["paid", "paid"]);
  expect(paid.find((s) => s.stripeSessionId === sold.id)?.payoutId).toBeTruthy();

  // Nothing left: running again pays nothing more.
  await service("/api/admin/payouts/run", admin.cookie, { partnerId: nick.partnerId });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = await service<{ payouts: { partnerId: string }[] }>(
    "/api/admin/payouts",
    admin.cookie,
  );
  expect(after.body.payouts.filter((p) => p.partnerId === nick.partnerId)).toHaveLength(1);
});

test("a refund takes its share: off a sale not yet paid, else as a clawback on the next payout", async () => {
  const nick = await activePartner();
  const admin = await signInAdmin();
  const refund = (session: Record<string, unknown>, refunded: number) =>
    stripeEvent("charge.refunded", {
      id: `ch_${crypto.randomUUID().replaceAll("-", "")}`,
      object: "charge",
      amount: 5000,
      amount_refunded: refunded, // Stripe's running total
      payment_intent: session.payment_intent,
    });
  const payoutsOf = async () =>
    (
      await service<{ payouts: { partnerId: string; amountCents: number }[] }>(
        "/api/admin/payouts",
        admin.cookie,
      )
    ).body.payouts
      .filter((p) => p.partnerId === nick.partnerId)
      .map((p) => p.amountCents)
      .sort((a, b) => a - b);
  const payOut = async (expected: number[]) => {
    await service("/api/admin/payouts/run", admin.cookie, { partnerId: nick.partnerId });
    await eventually(async () => expect(await payoutsOf()).toEqual(expected));
  };

  // 30% refunded before it's paid: 1000 commission becomes 700, and it's still approved.
  const sold = await sell(nick.partnerId, { amount_total: 5000 }, 31);
  await refund(sold, 1500);
  await refund(sold, 1500); // sent again: no change
  await runCron(DAILY);
  const byId = async () =>
    (await salesOf(nick.partnerId)).find((s) => s.stripeSessionId === sold.id);
  expect(await byId()).toMatchObject({
    status: "approved",
    commissionCents: 700,
    refundedCents: 1500,
  });
  await payOut([700]);

  // Another 50% refunded after it was paid: what was paid stays, 500 more is clawed back.
  await refund(sold, 4000);
  await refund(sold, 4000);
  const sales = await salesOf(nick.partnerId);
  const clawbacks = sales.filter((s) => s.kind === "clawback");
  expect(clawbacks).toEqual([
    expect.objectContaining({
      refundOf: (await byId())?.id,
      status: "approved",
      commissionCents: -500,
    }),
  ]);
  expect(await byId()).toMatchObject({ status: "paid", commissionCents: 700, refundedCents: 4000 });

  // Owed less than the clawback: nothing paid. A new sale's 1000 nets 500 at the next payout.
  await service("/api/admin/payouts/run", admin.cookie, { partnerId: nick.partnerId });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await payoutsOf()).toEqual([700]);
  await sell(nick.partnerId, { amount_total: 5000 }, 31);
  await runCron(DAILY);
  await payOut([500, 700]);
  const after = await salesOf(nick.partnerId);
  expect(after.filter((s) => s.kind === "clawback").map((s) => s.status)).toEqual(["paid"]);
});
