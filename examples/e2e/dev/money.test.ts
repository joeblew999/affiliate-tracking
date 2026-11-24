// Commission rules and renewals, on the seeded partners (examples/affiliates/demo.ts). No browser: the
// admin's actions are sent as their page sends them, sales and invoices come in as Stripe's
// events, and what each did is read from the admin's state stream (bus.ts). Each test touches its
// own partner, so none depends on another.
import { expect, test } from "vite-plus/test";
import { adminBus, sell, stripeEvent, written, type Sale } from "./bus.ts";
import { checkoutVia, now, paidSession, seededPartnerId } from "./helpers.ts";

/** A commission rule for one partner, as the admin's Rules tab adds it. */
async function addRule(
  code: string,
  rule: { percent: number; minMonthlySales?: number; capPerCustomerCents?: number },
) {
  await (
    await adminBus()
  ).act("/admin", "addRule", { partnerId: seededPartnerId(code), kind: "percent", ...rule });
}

/** The sales written since the file began, of this partner. */
const salesOf = async (code: string): Promise<Sale[]> =>
  (await written()).sales().filter((sale) => sale.partnerId === seededPartnerId(code));

const commissionOf = (sales: Sale[], customers: string[]) =>
  customers.map((c) => sales.find((s) => s.customerEmail === c)?.commissionCents);

/** A $50 sale through this partner's link; the customer's email. */
const sale = async (code: string, overrides: Record<string, unknown> = {}) =>
  (await sell({ code }, overrides)).customer;

test("a partner's rules: percent and the monthly tier", async () => {
  // Ana's seeded sales are all from last month (DEMO_NOW is the 15th): none this month yet.
  await addRule("ana", { percent: 30 });
  await addRule("ana", { percent: 40, minMonthlySales: 2 });
  // Both for her and any product, so equally specific: the highest tier reached wins. Sales 1 and
  // 2 (0 and 1 before them this month): 30% of $50. Sale 3: 40%.
  const customers = [await sale("ana"), await sale("ana"), await sale("ana")];
  expect(commissionOf(await salesOf("ana"), customers)).toEqual([1500, 1500, 2000]);
});

test("a capped rule stops paying for a customer once the cap is reached", async () => {
  await addRule("priya", { percent: 50, capPerCustomerCents: 3000 });
  const repeat = { email: `${crypto.randomUUID()}@buyer.test`, address: null };
  // One customer three times: $20, then the $10 left under the cap, then nothing.
  for (const _ of [1, 2, 3]) await sale("priya", { amount_total: 4000, customer_details: repeat });
  const other = await sale("priya", { amount_total: 4000 }); // another customer: $20 again
  const sales = await salesOf("priya");
  expect(
    sales
      .filter((s) => s.customerEmail === repeat.email)
      .map((s) => s.commissionCents)
      .sort((x, y) => x - y),
  ).toEqual([0, 1000, 2000]);
  expect(commissionOf(sales, [other])).toEqual([2000]);
});

test("a renewal pays the first sale's partner for their recurring months, once per invoice", async () => {
  // A host selling subscriptions: someone subscribed through Maya's link 95 days ago, at $29 a
  // month. (The demo sells tickets only, so this subscription is the test's own.)
  const first = paidSession((await checkoutVia({ code: "maya" })).metadata, {
    mode: "subscription",
    amount_total: 2900,
    payment_intent: null, // a subscription's payment is its invoice's
    customer: "cus_test_maya_sub",
    subscription: "sub_test_maya_sub",
  });
  await stripeEvent("checkout.session.completed", first, { daysAgo: 95 });
  const email = (first.customer_details as { email: string }).email;
  const invoice = (n: number) => ({
    id: `in_test_maya_sub_${n}`,
    object: "invoice",
    billing_reason: "subscription_cycle",
    amount_paid: 3190, // $29 and 10% tax, which earns nothing
    total_taxes: [{ amount: 290, tax_behavior: "exclusive" }],
    currency: "usd",
    customer: "cus_test_maya_sub",
    customer_email: email,
    customer_address: null,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_test_maya_sub" },
    },
    status_transitions: { paid_at: Math.floor(now() / 1000) },
    lines: { data: [] },
    payments: { data: [] },
  });
  const renewals = async () =>
    (await salesOf("maya")).filter((s) => s.kind === "renewal").map((s) => s.commissionCents);

  await stripeEvent("invoice.paid", invoice(1)); // within the default 12 months: her 25% of $29
  expect(await renewals()).toEqual([725]);
  await stripeEvent("invoice.paid", invoice(1)); // the same invoice again
  expect(await renewals()).toEqual([725]);

  // Paid for 3 months only: 95 days after the first sale, the next invoice earns nothing.
  await (
    await adminBus()
  ).act("/admin", "changePartner", { id: seededPartnerId("maya"), recurringMonths: 3 });
  await stripeEvent("invoice.paid", invoice(2));
  expect(await renewals()).toEqual([725]);
});

test("commission is on the price, not the tax collected with it", async () => {
  // Leo, 20%: a $50 sale with $5 tax on top earns 20% of $50.
  const customer = await sale("leo", {
    amount_total: 5500,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 500 },
  });
  expect(commissionOf(await salesOf("leo"), [customer])).toEqual([1000]);
});
