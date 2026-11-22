// The affiliate service's tables. Every key is a random UUID (crypto.randomUUID). Times are
// milliseconds since 1970 (Date.now()); money is in a currency's minor units (cents). Column names are
// snake_case (database.casing in void.config.ts). People are the host app's users: this service
// stores their user id, never a password or session.
import { isNotNull, sql } from "void/db";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "void/drizzle-zod";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "void/schema-d1";
import { z } from "zod";

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const now = () =>
  integer()
    .notNull()
    .$defaultFn(() => Date.now());

/** A host user who promotes the product, once approved. */
export const partners = sqliteTable(
  "partners",
  {
    id: id(),
    /** The host app's user id. */
    userId: text().notNull().unique(),
    email: text().notNull(),
    name: text(),
    /** In their default link, /r/<code>. */
    code: text().notNull().unique(),
    status: text({ enum: ["pending", "active", "suspended"] })
      .notNull()
      .default("pending"),
    commissionPct: real().notNull().default(20),
    /** Months after a subscription's first sale that its renewals earn commission; null: the default. */
    recurringMonths: integer(),
    /** Every sale waits for an admin, whatever the hold period. */
    reviewRequired: integer({ mode: "boolean" }).notNull().default(false),
    /** The buyer discount code, and its Stripe promotion code id, made when approved. */
    promoCode: text(),
    promoCodeId: text(),
    /** Their Stripe Connect Express account, for payouts. */
    stripeAccountId: text(),
    termsVersion: text(),
    termsAcceptedAt: integer(),
    /** What they wrote when applying. */
    application: text(),
    createdAt: now(),
  },
  // Stored uppercase (src/approval.ts), so one code can't belong to two partners in any case.
  (t) => [uniqueIndex("partners_promo_code").on(t.promoCode)],
);

/** A partner's short link: /r/<slug> goes to destination, a path on the host's site. */
export const links = sqliteTable(
  "links",
  {
    id: id(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    slug: text().notNull(),
    destination: text().notNull(),
    campaign: text(),
    status: text({ enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: now(),
  },
  (t) => [
    // Stored lowercase (src/links.ts), so a short name is one link in any case.
    uniqueIndex("links_slug").on(t.slug),
    index("links_partner").on(t.partnerId, t.status),
  ],
);

/** A visit through a partner's link. At most one per visitor IP per partner per day. */
export const clicks = sqliteTable(
  "clicks",
  {
    id: id(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    linkId: text().references(() => links.id),
    /** Salted SHA-256 of the IP; the IP itself is never stored. */
    ipHash: text(),
    country: text(),
    device: text({ enum: ["mobile", "tablet", "desktop"] }),
    referrerHost: text(),
    createdAt: now(),
  },
  (t) => [
    index("clicks_partner_ip").on(t.partnerId, t.ipHash, t.createdAt),
    index("clicks_link").on(t.linkId),
    index("clicks_created").on(t.createdAt),
  ],
);

/** A host user who signed up through a partner: their later purchases are the partner's. */
export const referrals = sqliteTable(
  "referrals",
  {
    id: id(),
    userId: text().notNull().unique(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    source: text({ enum: ["signup", "promo_code", "checkout"] }).notNull(),
    stripeCustomerId: text(),
    createdAt: now(),
    /** Their first paid sale. */
    convertedAt: integer(),
  },
  (t) => [
    index("referrals_partner").on(t.partnerId, t.createdAt),
    index("referrals_customer").on(t.stripeCustomerId),
  ],
);

/** The IP hashes a partner used the dashboard from: a sale from one of them is a self-referral. */
export const partnerIpHashes = sqliteTable(
  "partner_ip_hashes",
  {
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    ipHash: text().notNull(),
    lastSeenAt: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.partnerId, t.ipHash] })],
);

/** A payout to a partner: one transfer (or manual payment) covering approved sales. */
export const payouts = sqliteTable(
  "payouts",
  {
    id: id(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    amountCents: integer().notNull(),
    currency: text().notNull(),
    status: text({ enum: ["pending", "sent", "failed", "manual"] })
      .notNull()
      .default("pending"),
    /** The idempotency key the transfer is sent with: a retry never pays twice. */
    batchKey: text().notNull().unique(),
    stripeTransferId: text(),
    /** The Connect account at the time, in case the partner's changes later. */
    stripeAccountId: text(),
    transferStartedAt: integer(),
    /** Why the last attempt didn't finish; cleared when it does. */
    lastError: text(),
    createdAt: now(),
    paidAt: integer(),
  },
  // A literal, not eq(): SQLite allows no bound parameters in a partial index's WHERE.
  (t) => [
    uniqueIndex("payouts_one_pending")
      .on(t.partnerId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/**
 * A sale (first purchase or renewal), a bonus, or a clawback, and the commission it earns a partner.
 * A refund or dispute takes its share of the commission: off the sale itself while the sale isn't in
 * a payout (commissionCents goes down), else as a clawback, a negative line the partner's next payout
 * nets off (src/refunds.ts).
 */
export const sales = sqliteTable(
  "sales",
  {
    id: id(),
    partnerId: text()
      .notNull()
      .references(() => partners.id),
    kind: text({ enum: ["checkout", "renewal", "bonus", "clawback"] }).notNull(),
    /** rejected: an admin said no; never approved automatically. refunded: refunded in full. */
    status: text({ enum: ["pending", "approved", "rejected", "paying", "paid", "refunded"] })
      .notNull()
      .default("pending"),
    stripeSessionId: text().unique(),
    stripeInvoiceId: text().unique(),
    stripeEventId: text(),
    paymentIntent: text(),
    stripeCustomerId: text(),
    stripeSubscriptionId: text(),
    /** The host user who bought, when the host said. */
    userId: text(),
    linkId: text().references(() => links.id),
    customerEmail: text(),
    customerCountry: text(),
    /** What the customer paid, after discounts, in the sale's currency. */
    amountCents: integer().notNull(),
    currency: text().notNull(),
    /** What the sale earns now: before any refund, less what refunds took while it wasn't paid. */
    commissionCents: integer().notNull(),
    /** What it earned before any refund. */
    grossCommissionCents: integer().notNull(),
    /** How much of amountCents was refunded or is disputed, by Stripe's latest count. */
    refundedCents: integer().notNull().default(0),
    /** Goes up by one each time refundedCents changes: a clawback names the version it's for. */
    refundVersion: integer().notNull().default(0),
    /** For a clawback: the sale it takes back from. */
    refundOf: text(),
    commissionPct: real(),
    /** How the commission was worked out: [{ ruleId, productId, baseCents, commissionCents }]. */
    commissionDetail: text({ mode: "json" }).$type<CommissionLine[]>(),
    items: text({ mode: "json" }).$type<SaleItem[]>().notNull().default([]),
    /** self_email or self_ip: never approved automatically. */
    fraudReason: text({ enum: ["self_email", "self_ip"] }),
    /** For a bonus: why. */
    bonusNote: text(),
    /** The commission in the payout currency, at the rate Stripe settled the sale at. */
    payoutCurrency: text(),
    payoutCents: integer(),
    /** The Stripe balance transaction the rate came from; null when no conversion was needed. */
    fxSource: text(),
    createdAt: now(),
    approvedAt: integer(),
    paidAt: integer(),
    payoutId: text().references(() => payouts.id),
  },
  (t) => [
    index("sales_partner").on(t.partnerId, t.status),
    index("sales_partner_created").on(t.partnerId, t.createdAt),
    index("sales_status_created").on(t.status, t.createdAt),
    index("sales_payment_intent").on(t.paymentIntent),
    index("sales_payout").on(t.payoutId),
    index("sales_customer").on(t.stripeCustomerId, t.createdAt),
    index("sales_subscription").on(t.stripeSubscriptionId, t.createdAt),
    index("sales_link").on(t.linkId),
    index("sales_user").on(t.userId),
    uniqueIndex("sales_one_clawback_per_refund")
      .on(t.refundOf, t.refundVersion)
      .where(isNotNull(t.refundOf)),
  ],
);

/**
 * What's been refunded or disputed of a payment, by Stripe's latest count; kept whether its sale
 * arrives before or after. Refunds only go up (Stripe sends the running total). A dispute counts
 * while open or lost, not once won.
 */
export const refundedPayments = sqliteTable("refunded_payments", {
  paymentIntent: text().primaryKey(),
  refundedCents: integer().notNull().default(0),
  disputedCents: integer().notNull().default(0),
  disputeStatus: text({ enum: ["open", "won", "lost"] }),
  createdAt: now(),
});

/**
 * How commission is worked out, beyond each partner's own percent. For each item sold the most
 * specific active rule wins: partner + product, then product, then partner, then everyone.
 */
export const commissionRules = sqliteTable(
  "commission_rules",
  {
    id: id(),
    /** null: every partner. */
    partnerId: text().references(() => partners.id),
    /** A Stripe prod_… or price_… id; null: every product. */
    productId: text(),
    kind: text({ enum: ["percent", "fixed"] }).notNull(),
    percent: real(),
    /** Per unit sold, in currency. */
    fixedCents: integer(),
    currency: text(),
    /** A tier: applies once the partner has this many sales this calendar month (UTC). */
    minMonthlySales: integer().notNull().default(0),
    /** The most one customer can earn the partner under this rule. */
    capPerCustomerCents: integer(),
    active: integer({ mode: "boolean" }).notNull().default(true),
    createdAt: now(),
  },
  (t) => [index("commission_rules_partner").on(t.partnerId, t.active)],
);

export interface CommissionLine {
  ruleId: string | null;
  productId: string | null;
  baseCents: number;
  commissionCents: number;
}

export interface SaleItem {
  productId: string | null;
  name: string | null;
  variant: string | null;
  quantity: number;
}

// What requests may send, derived from the tables above (Void's "Schema-Derived Validators", in
// void/drizzle-zod): a column's type and allowed values are written once, here in the tables, and
// the routes validate against these.
const partnerRow = createSelectSchema(partners);
const saleRow = createSelectSchema(sales);

/** An admin's decision on a partner: active or suspended (pending is only for new applicants). */
export const partnerStatusInput = partnerRow
  .pick({ id: true })
  .extend({ status: partnerRow.shape.status.exclude(["pending"]) });

/** An admin's change to a partner's terms. */
export const partnerUpdateInput = createUpdateSchema(partners, {
  commissionPct: (s) => s.min(0).max(100),
  recurringMonths: (s) => s.min(0).max(1200),
})
  .pick({ commissionPct: true, recurringMonths: true, reviewRequired: true })
  .extend(partnerRow.pick({ id: true }).shape);

/** A shop user applying to be a partner. */
export const applyInput = createInsertSchema(partners, {
  application: (s) => s.trim().max(2000),
})
  .pick({ application: true })
  // The column allows no name (an admin's partner may have none); an applicant gives one.
  .extend({ name: z.string().trim().min(1).max(100), acceptTerms: z.literal(true) });

/** An admin's decision on a sale: approve, reject, or back to pending. */
export const saleStatusInput = saleRow
  .pick({ id: true })
  .extend({ status: saleRow.shape.status.extract(["approved", "rejected", "pending"]) });

/** A bonus an admin gives a partner: a sale of kind "bonus" (routes/api/admin/bonus.ts). */
export const bonusInput = createInsertSchema(sales, {
  commissionCents: (s) => s.positive(),
  bonusNote: () => z.string().trim().min(1).max(200),
}).pick({ partnerId: true, commissionCents: true, bonusNote: true });

/** A new commission rule: a percent, or a fixed amount per unit in a currency. */
export const ruleInput = createInsertSchema(commissionRules, {
  productId: (s) => s.regex(/^(prod|price)_[A-Za-z0-9]+$/, "a Stripe prod_… or price_… id"),
  percent: (s) => s.min(0).max(100),
  fixedCents: (s) => s.min(0),
  currency: (s) => s.regex(/^[a-z]{3}$/),
  minMonthlySales: (s) => s.min(0),
  capPerCustomerCents: (s) => s.min(0),
})
  .pick({
    partnerId: true,
    productId: true,
    kind: true,
    percent: true,
    fixedCents: true,
    currency: true,
    minMonthlySales: true,
    capPerCustomerCents: true,
  })
  .refine(
    (r) => (r.kind === "percent" ? r.percent != null : r.fixedCents != null && r.currency != null),
    {
      message: "a percent rule needs percent; a fixed one needs fixedCents and currency",
    },
  );

/** A partner's new short link. The slug is made from their code when not given. */
export const linkInput = createInsertSchema(links, {
  destination: (s) => s.max(512).regex(/^\/(?!\/)[^\s\\]*$/, "a path on the site, like /pricing"),
  campaign: (s) => s.trim().max(100),
  slug: (s) => s.regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "2–64 lowercase letters, digits or dashes"),
})
  .pick({ destination: true, campaign: true, slug: true })
  .partial();

/** One row, by its id. */
export const partnerIdInput = createSelectSchema(links).pick({ partnerId: true });
export const ruleIdInput = createSelectSchema(commissionRules).pick({ id: true });
export const linkIdInput = createSelectSchema(links).pick({ id: true });
export const payoutRunInput = createInsertSchema(payouts).pick({ partnerId: true }).partial();
