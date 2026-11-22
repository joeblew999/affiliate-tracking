// `vp run affiliates#db:seed` (Void's `void db seed`): resets the service's local database and fills
// it with demo data for looking at the pages. Partners here have made-up shop user ids, so they can't
// sign in; sign up on the shop and apply to see the partner side.
import { defineSeed } from "void/seed";

const DAY = 24 * 60 * 60 * 1000;

export default defineSeed<typeof import("./schema")>(async ({ db, schema }) => {
  const now = Date.now();
  const id = () => crypto.randomUUID();
  const nick = {
    id: id(),
    userId: "demo-user-nick",
    email: "nick@example.test",
    name: "Nick",
    code: "nick-demo",
    status: "active" as const,
    createdAt: now - 40 * DAY,
  };
  const rita = {
    id: id(),
    userId: "demo-user-rita",
    email: "rita@example.test",
    name: "Rita",
    code: "rita-demo",
    status: "active" as const,
    reviewRequired: true,
    createdAt: now - 30 * DAY,
  };
  const sam = {
    id: id(),
    userId: "demo-user-sam",
    email: "sam@example.test",
    name: "Sam",
    code: "sam-demo",
    status: "pending" as const,
    application: "I review productivity tools on YouTube.",
    createdAt: now - DAY,
  };
  await db.insert(schema.partners).values([nick, rita, sam]);

  const youtube = {
    id: id(),
    partnerId: nick.id,
    slug: "nick-youtube",
    destination: "/pricing",
    campaign: "YouTube",
    createdAt: now - 35 * DAY,
  };
  await db.insert(schema.links).values([youtube]);

  const countries = ["TH", "AU", "PH", "US", "DE"];
  const devices = ["mobile", "desktop", "tablet"] as const;
  const referrers = ["www.youtube.com", "instagram.com", null];
  const clicks = Array.from({ length: 90 }, (_, i) => ({
    partnerId: i % 3 === 0 ? rita.id : nick.id,
    linkId: i % 2 === 0 ? youtube.id : null,
    ipHash: `demo-${i}`,
    country: countries[i % countries.length] ?? null,
    device: devices[i % devices.length] ?? null,
    referrerHost: referrers[i % referrers.length] ?? null,
    createdAt: now - ((i * i) % 30) * DAY - 3600_000,
  }));
  await db.insert(schema.clicks).values(clicks);

  const sale = (
    partnerId: string,
    daysAgo: number,
    cents: number,
    status: "pending" | "approved" | "paid" | "refunded",
    extra = {},
  ) => ({
    partnerId,
    kind: "checkout" as const,
    status,
    stripeSessionId: `cs_demo_${id()}`,
    paymentIntent: `pi_demo_${id()}`,
    customerEmail: `buyer${daysAgo}@example.test`,
    customerCountry: "TH",
    amountCents: cents,
    currency: "usd",
    // A refunded demo sale was refunded in full, so it earns nothing.
    commissionCents: status === "refunded" ? 0 : Math.round(cents * 0.2),
    grossCommissionCents: Math.round(cents * 0.2),
    refundedCents: status === "refunded" ? cents : 0,
    refundVersion: status === "refunded" ? 1 : 0,
    commissionPct: 20,
    items: [{ productId: null, name: "Pro plan", variant: "Monthly", quantity: 1 }],
    createdAt: now - daysAgo * DAY,
    ...extra,
  });
  const payout = {
    id: id(),
    partnerId: nick.id,
    amountCents: 1800,
    currency: "usd",
    status: "manual" as const,
    batchKey: id(),
    createdAt: now - 10 * DAY,
    paidAt: now - 10 * DAY,
  };
  await db.insert(schema.payouts).values([payout]);
  await db.insert(schema.sales).values([
    sale(nick.id, 28, 4900, "paid", {
      payoutId: payout.id,
      paidAt: payout.paidAt,
      payoutCents: 980,
      payoutCurrency: "usd",
      linkId: youtube.id,
    }),
    sale(nick.id, 25, 4100, "paid", {
      payoutId: payout.id,
      paidAt: payout.paidAt,
      payoutCents: 820,
      payoutCurrency: "usd",
    }),
    sale(nick.id, 12, 7500, "approved", { linkId: youtube.id }),
    sale(nick.id, 3, 4900, "pending"),
    sale(nick.id, 2, 4900, "refunded"),
    sale(rita.id, 6, 9900, "pending", {
      fraudReason: "self_email" as const,
      customerEmail: rita.email,
    }),
  ]);
  await db
    .insert(schema.commissionRules)
    .values([{ partnerId: nick.id, kind: "percent", percent: 25, minMonthlySales: 10 }]);
});
