// `vp run demo` (both apps) or `vp run affiliates#db:seed`: resets the service's local database and
// fills it with 90 days of a believable program, for demos. The people are in ../demo.ts, shared
// with the shop's seed, which makes them shop accounts. The numbers and ids come from a fixed random seed: every run makes the same program, dated back from today.
//
// What it makes: partners in every state (active, review-required, suspended, waiting for
// approval), their short links, clicks from several countries, devices and sites, signups, sales
// of three products (some renewals, some refunded in full or in part, some flagged), the monthly
// payouts that paid the older ones, commission rules and bonuses.
import type { SaleItem } from "./schema.ts";
import { defineSeed } from "void/seed";
import { demoPeople } from "../demo.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOLD_DAYS = 30;
/** Days ago that the monthly payouts ran. */
const PAYOUT_DAYS_AGO = [72, 42, 12];

const PRODUCTS = [
  { productId: "prod_demo_pro", name: "Pro", variant: "Monthly", cents: 2900, monthly: true },
  { productId: "prod_demo_pro", name: "Pro", variant: "Yearly", cents: 29000, monthly: false },
  { productId: "prod_demo_team", name: "Team", variant: "Monthly", cents: 9900, monthly: true },
];
const COUNTRIES = ["US", "US", "US", "GB", "DE", "AU", "TH", "TH", "SG", "PH", "CA", "JP"];
const DEVICES = ["desktop", "desktop", "mobile", "mobile", "mobile", "tablet"] as const;
const FIRST = ["alex", "sam", "jo", "kim", "lee", "ana", "ben", "mia", "noah", "eva", "raj", "li"];
const DOMAINS = ["studio.test", "mail.test", "agency.test", "works.test"];

/** A small, fixed-seed random number generator (mulberry32): the same demo every run. */
function random(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  /** A UUID (version 4's shape) from the same numbers: the same ids every run too. */
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16)).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[Math.floor(next() * 4)]}${hex.slice(17, 20)}-${hex.slice(20)}`;
  };
  return { next, pick, uuid, chance: (p: number) => next() < p };
}

export default defineSeed<typeof import("./schema.ts")>(async ({ db, schema }) => {
  const now = Date.now();
  const rand = random(2026);
  const uuid = rand.uuid;
  const at = (daysAgo: number) => now - daysAgo * DAY - Math.floor(rand.next() * DAY * 0.9);

  // D1 takes at most 100 values a statement, so rows go in in small batches.
  async function insert<T extends Record<string, unknown>>(
    put: (rows: T[]) => Promise<unknown>,
    rows: T[],
  ) {
    const columns = Math.max(1, ...rows.map((row) => Object.keys(row).length));
    const size = Math.max(1, Math.floor(99 / columns));
    for (let i = 0; i < rows.length; i += size) await put(rows.slice(i, i + size));
  }

  const partnerRows: (typeof schema.partners.$inferInsert)[] = [];
  const linkRows: (typeof schema.links.$inferInsert)[] = [];
  const clickRows: (typeof schema.clicks.$inferInsert)[] = [];
  const referralRows: (typeof schema.referrals.$inferInsert)[] = [];
  const saleRows: (typeof schema.sales.$inferInsert & { id: string; createdAt: number })[] = [];
  const refundRows: (typeof schema.refundedPayments.$inferInsert)[] = [];
  let customers = 0;

  for (const person of demoPeople) {
    const p = person.partner;
    if (!p) continue;
    const partnerId = uuid();
    partnerRows.push({
      id: partnerId,
      userId: person.userId,
      email: person.email,
      name: person.name,
      code: p.code,
      status: p.status,
      commissionPct: p.commissionPct,
      reviewRequired: p.reviewRequired ?? false,
      promoCode: p.promoCode ?? null,
      application: p.application,
      termsVersion: "2026-01",
      termsAcceptedAt: now - p.joinedDaysAgo * DAY,
      createdAt: now - p.joinedDaysAgo * DAY,
    });
    if (p.status === "pending") continue;

    const links = [
      { slug: `${p.code}-review`, destination: "/pricing", campaign: "Review" },
      { slug: `${p.code}-launch`, destination: "/", campaign: "Launch week" },
    ].map((link) => ({ id: uuid(), partnerId, ...link, createdAt: now - p.joinedDaysAgo * DAY }));
    linkRows.push(...links);

    // Ken was suspended 20 days ago: no traffic since.
    const lastDay = p.status === "suspended" ? 20 : 0;
    const days = Math.min(90, p.joinedDaysAgo);
    for (let daysAgo = days; daysAgo >= lastDay; daysAgo--) {
      // Traffic grows over time, busier on weekdays.
      const weekday = new Date(now - daysAgo * DAY).getUTCDay() % 6 === 0 ? 0.6 : 1;
      const growth = 0.5 + (days - daysAgo) / days;
      const count = Math.round(p.reach * weekday * growth * (0.5 + rand.next()));
      for (let c = 0; c < count; c++) {
        const createdAt = at(daysAgo);
        const link = rand.chance(0.6) ? rand.pick(links) : null;
        clickRows.push({
          id: uuid(),
          partnerId,
          linkId: link?.id ?? null,
          ipHash: `demo-${Math.floor(rand.next() * 1e9).toString(36)}`,
          country: rand.pick(COUNTRIES),
          device: rand.pick(DEVICES),
          referrerHost: rand.pick(p.sites),
          createdAt,
        });
        if (!rand.chance(0.09)) continue;

        // A signup, and often a sale a few days later.
        customers++;
        const userId = `demo-customer-${customers}`;
        const saleAt = createdAt + Math.floor(rand.next() * 6) * DAY;
        const buys = rand.chance(0.45) && saleAt < now;
        const stripeCustomerId = buys ? `cus_demo_${customers}` : null;
        referralRows.push({
          id: uuid(),
          userId,
          partnerId,
          source: "signup",
          stripeCustomerId,
          createdAt,
          convertedAt: buys ? saleAt : null,
        });
        if (!buys) continue;
        const product = rand.pick(PRODUCTS);
        const email = `${rand.pick(FIRST)}${customers}@${rand.pick(DOMAINS)}`;
        const sale = (kind: "checkout" | "renewal", when: number) => {
          const commission = Math.round((product.cents * p.commissionPct) / 100);
          const items: SaleItem[] = [
            {
              productId: product.productId,
              name: product.name,
              variant: product.variant,
              quantity: 1,
            },
          ];
          saleRows.push({
            id: uuid(),
            partnerId,
            kind,
            status: "pending",
            stripeSessionId: kind === "checkout" ? `cs_demo_${customers}` : null,
            stripeInvoiceId: kind === "renewal" ? `in_demo_${customers}_${when}` : null,
            paymentIntent: `pi_demo_${uuid().slice(0, 18)}`,
            stripeCustomerId,
            stripeSubscriptionId: `sub_demo_${customers}`,
            userId,
            linkId: link?.id ?? null,
            customerEmail: email,
            customerCountry: rand.pick(COUNTRIES),
            amountCents: product.cents,
            currency: "usd",
            commissionCents: commission,
            grossCommissionCents: commission,
            commissionPct: p.commissionPct,
            commissionDetail: [
              {
                ruleId: null,
                productId: product.productId,
                baseCents: product.cents,
                commissionCents: commission,
              },
            ],
            items,
            createdAt: when,
          });
        };
        sale("checkout", saleAt);
        // Monthly plans renew while the customer stays.
        if (product.monthly)
          for (let renewal = saleAt + 30 * DAY; renewal < now; renewal += 30 * DAY)
            if (rand.chance(0.85)) sale("renewal", renewal);
            else break;
      }
    }
  }

  // Where each sale is now: refunded (in full or in part), flagged, or through the hold period.
  for (const sale of saleRows) {
    const partner = partnerRows.find((row) => row.id === sale.partnerId);
    const age = (now - sale.createdAt) / DAY;
    const gross = sale.grossCommissionCents;
    if (rand.chance(0.05)) {
      sale.status = "refunded";
      sale.refundedCents = sale.amountCents;
      sale.refundVersion = 1;
      sale.commissionCents = 0;
      refundRows.push({ paymentIntent: sale.paymentIntent ?? "", refundedCents: sale.amountCents });
      continue;
    }
    if (rand.chance(0.04)) {
      const refunded = Math.round(sale.amountCents * 0.3);
      sale.refundedCents = refunded;
      sale.refundVersion = 1;
      sale.commissionCents = gross - Math.round(gross * 0.3);
      refundRows.push({ paymentIntent: sale.paymentIntent ?? "", refundedCents: refunded });
    }
    if (partner?.code === "ken" && rand.chance(0.3)) {
      sale.fraudReason = "self_ip";
      continue;
    }
    if (partner?.reviewRequired && age < 50) continue; // waiting for an admin
    if (age >= HOLD_DAYS) {
      sale.status = "approved";
      sale.approvedAt = sale.createdAt + HOLD_DAYS * DAY;
    }
  }
  // One sale flagged as the partner buying through their own link.
  const maya = partnerRows.find((row) => row.code === "maya");
  const recent = saleRows.find((s) => s.partnerId === maya?.id && s.status === "pending");
  if (recent) {
    recent.fraudReason = "self_email";
    recent.customerEmail = "maya@demo.test";
  }

  // Bonuses: one paid with a past payout, one waiting for the next.
  const leo = partnerRows.find((row) => row.code === "leo");
  for (const [partner, cents, note, daysAgo] of [
    [maya, 5000, "Launch video", 70],
    [leo, 2500, "Newsletter feature", 10],
  ] as const) {
    if (!partner?.id) continue;
    saleRows.push({
      id: uuid(),
      partnerId: partner.id,
      kind: "bonus",
      status: "approved",
      amountCents: 0,
      currency: "usd",
      commissionCents: cents,
      grossCommissionCents: cents,
      bonusNote: note,
      createdAt: now - daysAgo * DAY,
      approvedAt: now - daysAgo * DAY,
    });
  }

  // The monthly payouts: each paid everything approved by then (manual: no Stripe Connect here).
  const payoutRows: (typeof schema.payouts.$inferInsert)[] = [];
  for (const daysAgo of PAYOUT_DAYS_AGO) {
    const runAt = now - daysAgo * DAY;
    for (const partner of partnerRows) {
      const due = saleRows.filter(
        (s) =>
          s.partnerId === partner.id &&
          s.status === "approved" &&
          !s.payoutId &&
          (s.approvedAt ?? Infinity) <= runAt,
      );
      const cents = due.reduce((total, s) => total + (s.commissionCents ?? 0), 0);
      if (cents <= 0 || !partner.id) continue;
      const payoutId = uuid();
      payoutRows.push({
        id: payoutId,
        partnerId: partner.id,
        amountCents: cents,
        currency: "usd",
        status: "manual",
        batchKey: payoutId,
        createdAt: runAt,
        paidAt: runAt,
      });
      for (const s of due)
        Object.assign(s, {
          status: "paid",
          payoutId,
          payoutCurrency: "usd",
          payoutCents: s.commissionCents,
          paidAt: runAt,
        });
    }
  }

  // A refund after one of Maya's sales was paid out: a clawback on her next payout.
  const paid = saleRows.find(
    (s) => s.partnerId === maya?.id && s.status === "paid" && s.kind === "checkout",
  );
  if (paid && maya?.id) {
    const clawback = Math.round((paid.commissionCents ?? 0) * 0.5);
    paid.refundedCents = Math.round(paid.amountCents * 0.5);
    paid.refundVersion = 1;
    refundRows.push({ paymentIntent: paid.paymentIntent ?? "", refundedCents: paid.refundedCents });
    saleRows.push({
      id: uuid(),
      partnerId: maya.id,
      kind: "clawback",
      status: "approved",
      amountCents: 0,
      currency: "usd",
      commissionCents: -clawback,
      grossCommissionCents: -clawback,
      refundOf: paid.id,
      refundVersion: 1,
      payoutCurrency: "usd",
      payoutCents: -clawback,
      customerEmail: paid.customerEmail,
      linkId: paid.linkId,
      createdAt: now - 5 * DAY,
      approvedAt: now - 5 * DAY,
    });
  }

  await insert((rows) => db.insert(schema.partners).values(rows), partnerRows);
  await insert((rows) => db.insert(schema.links).values(rows), linkRows);
  await insert((rows) => db.insert(schema.clicks).values(rows), clickRows);
  await insert((rows) => db.insert(schema.referrals).values(rows), referralRows);
  await insert((rows) => db.insert(schema.payouts).values(rows), payoutRows);
  await insert((rows) => db.insert(schema.sales).values(rows), saleRows);
  await insert(
    (rows) => db.insert(schema.refundedPayments).values(rows).onConflictDoNothing(),
    refundRows,
  );
  await insert(
    (rows) => db.insert(schema.commissionRules).values(rows),
    [
      // Maya earns more in a month she sells a lot.
      { partnerId: maya?.id ?? null, kind: "percent" as const, percent: 30, minMonthlySales: 15 },
      // Team plans pay a fixed amount, for everyone.
      {
        partnerId: null,
        productId: "prod_demo_team",
        kind: "fixed" as const,
        fixedCents: 2500,
        currency: "usd",
      },
    ],
  );
  console.log(
    `demo: ${partnerRows.length} partners, ${clickRows.length} clicks, ${referralRows.length} signups, ${saleRows.length} sales and bonuses, ${payoutRows.length} payouts`,
  );
});
