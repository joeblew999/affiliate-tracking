// Commission rules and renewals, on the seeded partners (apps/affiliates/demo.ts): the admin works
// the admin page in a browser; sales and invoices come in as Stripe's events. Each test touches its
// own partner, so none depends on another.
import { expect, test } from "vite-plus/test";
import {
  addRule,
  now,
  salesOf,
  seededPartner,
  sell,
  setRenewalMonths,
  stripeEvent,
  type Partner,
} from "./helpers.ts";

/** The commission of these customers' sales of this partner, in that order. */
async function commissionOf(partner: Partner, customers: string[]) {
  const sales = await salesOf(partner.name);
  return customers.map((c) => sales.find((s) => s.customer === c)?.commissionCents);
}

test("a partner's rules: percent and the monthly tier", async () => {
  // Ana's seeded sales are all from last month (DEMO_NOW is the 15th): none this month yet.
  const ana = await seededPartner("ana");
  await addRule(ana.name, { percent: 30 });
  await addRule(ana.name, { percent: 40, fromSales: 2 });
  // Both for her and any product, so equally specific: the highest tier reached wins. Sales 1 and
  // 2 (0 and 1 before them this month): 30% of $50. Sale 3: 40%.
  const customers = [await sell(ana), await sell(ana), await sell(ana)];
  expect(await commissionOf(ana, customers)).toEqual([1500, 1500, 2000]);
});

test("a capped rule stops paying for a customer once the cap is reached", async () => {
  const priya = await seededPartner("priya");
  await addRule(priya.name, { percent: 50, capPerCustomer: "30" });
  const repeat = { email: `${crypto.randomUUID()}@buyer.test`, address: null };
  // One customer three times: $20, then the $10 left under the cap, then nothing.
  for (const _ of [1, 2, 3]) await sell(priya, { amount_total: 4000, customer_details: repeat });
  const other = await sell(priya, { amount_total: 4000 }); // another customer: $20 again
  const sales = await salesOf(priya.name);
  expect(
    sales
      .filter((s) => s.customer === repeat.email)
      .map((s) => s.commissionCents)
      .sort((x, y) => x - y),
  ).toEqual([0, 1000, 2000]);
  expect(await commissionOf(priya, [other])).toEqual([2000]);
});

test("a renewal pays the first sale's partner for their recurring months, once per invoice", async () => {
  // Maya's monthly Pro (seeded sale maya_2, 95 days ago) renews on its subscription.
  const maya = await seededPartner("maya");
  const invoice = (n: number) => ({
    id: `in_test_maya_2_${n}`,
    object: "invoice",
    billing_reason: "subscription_cycle",
    amount_paid: 3190, // $29 and 10% tax, which earns nothing
    total_taxes: [{ amount: 290, tax_behavior: "exclusive" }],
    currency: "usd",
    customer: "cus_demo_maya_2",
    customer_email: "maya_2@customer.demo.test",
    customer_address: null,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_demo_maya_2" },
    },
    status_transitions: { paid_at: Math.floor(now() / 1000) },
    lines: { data: [] },
    payments: { data: [] },
  });
  const renewals = async () =>
    (await salesOf(maya.name)).filter((s) => s.notes === "renewal").map((s) => s.commissionCents);
  const before = await renewals();

  await stripeEvent("invoice.paid", invoice(1)); // within the default 12 months: her 25% of $29
  expect(await renewals()).toEqual([725, ...before]);
  await stripeEvent("invoice.paid", invoice(1)); // the same invoice again
  expect(await renewals()).toHaveLength(before.length + 1);

  // Paid for 3 months only: 95 days after the first sale, the next invoice earns nothing.
  await setRenewalMonths(maya.name, 3);
  await stripeEvent("invoice.paid", invoice(2));
  expect(await renewals()).toHaveLength(before.length + 1);
});

test("commission is on the price, not the tax collected with it", async () => {
  // Leo, 20%: a $50 sale with $5 tax on top earns 20% of $50.
  const leo = await seededPartner("leo");
  const customer = await sell(leo, {
    amount_total: 5500,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 500 },
  });
  expect(await commissionOf(leo, [customer])).toEqual([1000]);
});
