// Commission rules and bonuses, renewals, the hold period, admin decisions, and payouts through the
// queue: the admin works the admin page in a browser; sales come in as Stripe's events.
// Rules here are always for one partner, so they don't change other tests' commission.
import { expect, test } from "vite-plus/test";
import {
  activePartner,
  addBonus,
  addRule,
  checkoutVia,
  decideSale,
  eventually,
  paidSession,
  payoutsOf,
  reviewEverySale,
  runCron,
  runPayouts,
  saleOf,
  salesOf,
  setRenewalMonths,
  stripeEvent,
  type Partner,
} from "./helpers.ts";

const DAILY = "17 3 * * *";

/** A sale for this partner, as Stripe reports it, `daysAgo` days back. */
async function sell(partner: Partner, overrides: Record<string, unknown> = {}, daysAgo = 0) {
  const session = paidSession((await checkoutVia(partner)).metadata, overrides);
  await stripeEvent("checkout.session.completed", session, { daysAgo });
  return session;
}

const customerOf = (session: Record<string, unknown>) =>
  (session.customer_details as { email: string }).email;

test("a partner's rules: percent and the monthly tier", async () => {
  const nick = await activePartner();
  await addRule(nick.name, { percent: 30 });
  await addRule(nick.name, { percent: 40, fromSales: 2 });
  // Both are for this partner and any product, so equally specific: the highest tier reached
  // wins. Sales 1 and 2 (0 and 1 before them this month): the 30% rule. Sale 3: the 40% tier.
  const sold = [await sell(nick), await sell(nick), await sell(nick)];
  const sales = await salesOf(nick.name);
  const commission = (s: Record<string, unknown>) =>
    sales.find((sale) => sale.customer === customerOf(s))?.commissionCents;
  expect(sold.map(commission)).toEqual([1500, 1500, 2000]);
});

test("a capped rule stops paying for a customer once the cap is reached", async () => {
  const nick = await activePartner();
  await addRule(nick.name, { percent: 50, capPerCustomer: "30" });
  const repeat = {
    customer_details: { email: `${crypto.randomUUID()}@buyer.test`, address: null },
  };
  // One customer three times: 2000, then the 1000 left under the cap, then nothing. Another
  // customer: 2000 again.
  for (const _ of [1, 2, 3]) await sell(nick, { amount_total: 4000, ...repeat });
  await sell(nick, { amount_total: 4000 });
  const commissions = (await salesOf(nick.name)).map((s) => s.commissionCents);
  expect(commissions.sort((x, y) => x - y)).toEqual([0, 1000, 2000, 2000]);
});

test("the hold period approves old sales, except disputed, flagged, reviewed or rejected ones", async () => {
  const nick = await activePartner();
  const old = await sell(nick, {}, 31);
  const recent = await sell(nick, {}, 5);
  const flagged = await sell(nick, { customer_details: { email: nick.email, address: null } }, 31);
  const disputed = await sell(nick, {}, 31);
  await stripeEvent("charge.dispute.created", {
    id: `dp_${crypto.randomUUID()}`,
    object: "dispute",
    amount: 1000, // part of it: the sale stays, on hold while the dispute is open
    charge: "ch_x",
    payment_intent: disputed.payment_intent,
    status: "needs_response",
  });
  const rejected = await sell(nick, {}, 31);
  await decideSale(customerOf(rejected), "Reject");

  const rita = await activePartner("Rita");
  await reviewEverySale(rita.name);
  const reviewed = await sell(rita, {}, 31);

  await runCron(DAILY);
  const status = async (partner: Partner, session: Record<string, unknown>) =>
    (await saleOf(partner.name, session))?.status;
  expect(await status(nick, old)).toBe("approved");
  expect(await status(nick, recent)).toBe("pending");
  expect(await status(nick, disputed)).toBe("pending");
  expect(await status(nick, flagged)).toBe("pending");
  expect(await status(nick, rejected)).toBe("rejected");
  expect(await status(rita, reviewed)).toBe("pending");
});

test("renewals pay the first sale's partner for their recurring months, once per invoice", async () => {
  const nick = await activePartner();
  await setRenewalMonths(nick.name, 2);
  const subscription = `sub_${crypto.randomUUID().replaceAll("-", "")}`;
  // No `mode: "subscription"`: with it, the shop's Better Auth Stripe plugin fetches the
  // subscription from Stripe, which this made-up one isn't in. The service reads only its id.
  await sell(
    nick,
    { subscription, customer: "cus_renew", amount_total: 2000, payment_intent: null },
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
    return (await salesOf(nick.name))
      .filter((s) => s.notes === "renewal")
      .map((s) => s.commissionCents);
  };
  expect(await renew(invoice(0, 70, "subscription_create"))).toEqual([]); // the checkout sale
  expect(await renew(invoice(1, 40))).toEqual([400]);
  expect(await renew(invoice(1, 40))).toEqual([400]); // the same invoice again
  expect(await renew(invoice(2, 5))).toEqual([400]); // past the partner's 2 recurring months
});

test("a payout run pays each partner's approved sales and bonuses, through the queue", async () => {
  const nick = await activePartner();
  await sell(nick, { amount_total: 5000 }, 31); // 1000 commission
  await runCron(DAILY);
  await addBonus(nick.name, "25", "Launch week");
  await runPayouts();

  // No Connect account: a manual payout, for an admin to pay.
  await eventually(async () =>
    expect(await payoutsOf(nick.name)).toEqual([
      expect.objectContaining({ status: "manual", amountCents: 3500 }),
    ]),
  );
  expect((await salesOf(nick.name)).map((s) => s.status)).toEqual(["paid", "paid"]);

  // Nothing left: running again pays nothing more.
  await runPayouts();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await payoutsOf(nick.name)).toHaveLength(1);
});

test("a refund takes its share: off a sale not yet paid, else as a clawback on the next payout", async () => {
  const nick = await activePartner();
  const refund = (session: Record<string, unknown>, refunded: number) =>
    stripeEvent("charge.refunded", {
      id: `ch_${crypto.randomUUID().replaceAll("-", "")}`,
      object: "charge",
      amount: 5000,
      amount_refunded: refunded, // Stripe's running total
      payment_intent: session.payment_intent,
    });
  const amounts = async () =>
    (await payoutsOf(nick.name)).map((p) => p.amountCents).sort((a, b) => a - b);
  const payOut = async (expected: number[]) => {
    await runPayouts();
    await eventually(async () => expect(await amounts()).toEqual(expected));
  };

  // 30% refunded before it's paid: 1000 commission becomes 700, and it's still approved.
  const sold = await sell(nick, { amount_total: 5000 }, 31);
  await refund(sold, 1500);
  await refund(sold, 1500); // sent again: no change
  await runCron(DAILY);
  expect(await saleOf(nick.name, sold)).toMatchObject({
    status: "approved",
    commissionCents: 700,
    notes: "$15.00 refunded",
  });
  await payOut([700]);

  // Another 50% refunded after it was paid: what was paid stays, 500 more is clawed back.
  await refund(sold, 4000);
  await refund(sold, 4000);
  const clawbacks = (await salesOf(nick.name)).filter((s) => s.notes.startsWith("clawback"));
  expect(clawbacks).toEqual([
    expect.objectContaining({ status: "approved", commissionCents: -500 }),
  ]);
  expect(await saleOf(nick.name, sold)).toMatchObject({
    status: "paid",
    commissionCents: 700,
    notes: "$40.00 refunded",
  });

  // Owed less than the clawback: nothing paid. A new sale's 1000 nets 500 at the next payout.
  await runPayouts();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(await amounts()).toEqual([700]);
  await sell(nick, { amount_total: 5000 }, 31);
  await runCron(DAILY);
  await payOut([500, 700]);
  const after = (await salesOf(nick.name)).filter((s) => s.notes.startsWith("clawback"));
  expect(after.map((s) => s.status)).toEqual(["paid"]);
});
