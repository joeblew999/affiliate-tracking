// `vp run demo` (both apps) or `vp run affiliates#db:seed`: resets the service's local database and
// loads the demo: the fixtures in ../demo.ts, written out (partners, their links, ticket sales,
// bonuses, refunds, payouts, rules), with ids made from their labels. The tests check against the
// same fixtures. Only the clicks and signups behind the charts are generated here, from a fixed
// seed; nothing checks those exactly, and no money comes from them.
//
// Dated from DEMO_NOW when the service's clock is pinned (AFFILIATES_NOW: tests), else from the
// moment it runs (the demo you show). Every row is dated here: a row's default date comes from the
// service's clock (src/clock.ts), which is the Worker's and not there when a seed runs.
import type { SaleItem } from "./schema.ts";
import { defineSeed } from "void/seed";
import {
  customerOf,
  demoPayouts,
  demoPeople,
  demoEvents,
  demoRules,
  demoSales,
  fixtureId,
  HOLD_DAYS,
  paymentIntentOf,
} from "../demo.ts";

const DAY = 24 * 60 * 60 * 1000;
const COUNTRIES = ["US", "US", "US", "GB", "DE", "AU", "TH", "TH", "SG", "PH", "CA", "JP"];
const DEVICES = ["desktop", "desktop", "mobile", "mobile", "mobile", "tablet"] as const;

/** A small, fixed-seed random number generator (mulberry32), for the clicks: the same every load. */
function random(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  return { next, pick, chance: (p: number) => next() < p };
}

export default defineSeed<typeof import("./schema.ts")>(async ({ db, schema }) => {
  const now = process.env.AFFILIATES_NOW ? Date.parse(process.env.AFFILIATES_NOW) : Date.now();
  const ago = (days: number) => now - days * DAY;
  const partnerOf = (code: string) => fixtureId(`partner:${code}`);

  // D1 takes at most 100 values a statement, so rows go in in small batches.
  async function insert<T extends Record<string, unknown>>(
    put: (rows: T[]) => Promise<unknown>,
    rows: T[],
  ) {
    const columns = Math.max(1, ...rows.map((row) => Object.keys(row).length));
    const size = Math.max(1, Math.floor(99 / columns));
    for (let i = 0; i < rows.length; i += size) await put(rows.slice(i, i + size));
  }

  const partners = demoPeople.flatMap((person) =>
    person.partner
      ? [
          {
            id: partnerOf(person.partner.code),
            userId: person.userId,
            email: person.email,
            name: person.name,
            code: person.partner.code,
            status: person.partner.status,
            commissionPct: person.partner.commissionPct,
            reviewRequired: person.partner.reviewRequired ?? false,
            promoCode: person.partner.promoCode ?? null,
            application: person.partner.application,
            termsVersion: "2026-01",
            termsAcceptedAt: ago(person.partner.joinedDaysAgo),
            createdAt: ago(person.partner.joinedDaysAgo),
          },
        ]
      : [],
  );

  const links = demoPeople.flatMap((person) => {
    const p = person.partner;
    if (!p || p.status === "pending") return [];
    return [
      { slug: `${p.code}-review`, destination: "/pricing", campaign: "Review" },
      { slug: `${p.code}-launch`, destination: "/", campaign: "Launch week" },
    ].map((link) => ({
      id: fixtureId(`link:${link.slug}`),
      partnerId: partnerOf(p.code),
      ...link,
      createdAt: ago(p.joinedDaysAgo),
    }));
  });

  const payouts = demoPayouts.map((p) => ({
    id: fixtureId(`payout:${p.label}`),
    partnerId: partnerOf(p.partner),
    amountCents: p.amountCents,
    currency: "usd",
    status: "manual" as const,
    batchKey: fixtureId(`payout:${p.label}`),
    createdAt: ago(p.daysAgo),
    paidAt: ago(p.daysAgo),
  }));

  const people = new Map(demoPeople.map((person) => [person.partner?.code, person]));
  const sales = demoSales.map((s) => {
    const event = s.event ? demoEvents[s.event] : null;
    const pct = people.get(s.partner)?.partner?.commissionPct ?? null;
    const createdAt = ago(s.daysAgo);
    const payout = s.payout ? demoPayouts.find((p) => p.label === s.payout) : undefined;
    const approvedAt =
      s.status === "approved" || s.status === "paid"
        ? s.kind === "bonus" || s.kind === "clawback"
          ? createdAt
          : createdAt + HOLD_DAYS * DAY
        : null;
    const items: SaleItem[] = event
      ? [{ productId: event.productId, name: event.name, variant: null, quantity: 1 }]
      : [];
    return {
      id: fixtureId(`sale:${s.label}`),
      partnerId: partnerOf(s.partner),
      kind: s.kind,
      status: s.status,
      stripeSessionId: s.kind === "checkout" ? `cs_demo_${s.label}` : null,
      paymentIntent: event ? paymentIntentOf(s.label) : null,
      stripeCustomerId: event ? `cus_demo_${s.label}` : null,
      customerEmail: customerOf(s),
      customerCountry: event ? "US" : null,
      amountCents: event?.cents ?? 0,
      currency: "usd",
      commissionCents: s.commissionCents,
      grossCommissionCents: s.grossCommissionCents ?? s.commissionCents,
      commissionPct: event ? pct : null,
      refundedCents: s.refundedCents ?? 0,
      refundVersion: s.refundedCents ? 1 : 0,
      refundOf: s.kind === "clawback" && s.of ? fixtureId(`sale:${s.of}`) : null,
      fraudReason: s.fraudReason ?? null,
      bonusNote: s.bonusNote ?? null,
      items,
      createdAt,
      approvedAt,
      payoutId: payout ? fixtureId(`payout:${payout.label}`) : null,
      payoutCurrency: payout || s.kind === "clawback" ? "usd" : null,
      payoutCents: payout || s.kind === "clawback" ? s.commissionCents : null,
      paidAt: payout ? ago(payout.daysAgo) : null,
    };
  });
  const refunds = demoSales
    .filter((s) => s.refundedCents)
    .map((s) => ({
      paymentIntent: paymentIntentOf(s.label),
      refundedCents: s.refundedCents ?? 0,
      createdAt: ago(s.daysAgo),
    }));

  // The clicks and signups behind the charts: each active (or since suspended) partner's traffic,
  // growing over 90 days, busier on weekdays, as much as their reach. Generated, never checked
  // exactly.
  const rand = random(2026);
  const clicks: (typeof schema.clicks.$inferInsert)[] = [];
  const signups: (typeof schema.referrals.$inferInsert)[] = [];
  let n = 0;
  for (const person of demoPeople) {
    const p = person.partner;
    if (!p || p.status === "pending") continue;
    const own = links.filter((link) => link.partnerId === partnerOf(p.code));
    const lastDay = p.status === "suspended" ? 20 : 0; // Ken: no traffic since he was suspended
    const days = Math.min(90, p.joinedDaysAgo);
    for (let daysAgo = days; daysAgo >= lastDay; daysAgo--) {
      const weekday = new Date(ago(daysAgo)).getUTCDay() % 6 === 0 ? 0.6 : 1;
      const growth = 0.5 + (days - daysAgo) / days;
      const count = Math.round(p.reach * weekday * growth * (0.5 + rand.next()));
      for (let c = 0; c < count; c++) {
        n++;
        const createdAt = ago(daysAgo) - Math.floor(rand.next() * DAY * 0.9);
        clicks.push({
          id: fixtureId(`click:${n}`),
          partnerId: partnerOf(p.code),
          linkId: rand.chance(0.6) ? rand.pick(own).id : null,
          ipHash: `demo-${n}`,
          country: rand.pick(COUNTRIES),
          device: rand.pick(DEVICES),
          referrerHost: rand.pick(p.sites),
          createdAt,
        });
        if (rand.chance(0.05))
          signups.push({
            id: fixtureId(`signup:${n}`),
            userId: `demo-customer-${n}`,
            partnerId: partnerOf(p.code),
            source: "signup",
            createdAt,
          });
      }
    }
  }

  await insert((rows) => db.insert(schema.partners).values(rows), partners);
  await insert((rows) => db.insert(schema.links).values(rows), links);
  await insert((rows) => db.insert(schema.clicks).values(rows), clicks);
  await insert((rows) => db.insert(schema.referrals).values(rows), signups);
  await insert((rows) => db.insert(schema.payouts).values(rows), payouts);
  await insert((rows) => db.insert(schema.sales).values(rows), sales);
  await insert((rows) => db.insert(schema.refundedPayments).values(rows), refunds);
  await insert(
    (rows) => db.insert(schema.commissionRules).values(rows),
    demoRules.map(({ label, partner, ...rule }) => ({
      id: fixtureId(`rule:${label}`),
      partnerId: partner ? partnerOf(partner) : null,
      ...rule,
      createdAt: ago(120),
    })),
  );
  console.log(
    `demo: ${partners.length} partners, ${sales.length} sales, ${payouts.length} payouts, ${clicks.length} clicks, ${signups.length} signups`,
  );
});
