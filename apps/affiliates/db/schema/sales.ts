import { isNotNull } from "void/db";
import { createInsertSchema, createSelectSchema } from "void/drizzle-zod";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "void/schema-d1";
import { z } from "zod";
import { id, now } from "./columns";
import { partners } from "./partners";
import { links } from "./links";
import { payouts } from "./payouts";

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

/** A bonus an admin gives a partner (the admin page's bonus): a sale of kind "bonus". */
export const bonus = createInsertSchema(sales, {
  commissionCents: (s) => s.positive(),
  bonusNote: () => z.string().trim().min(1).max(200),
}).pick({ partnerId: true, commissionCents: true, bonusNote: true });

/** An admin's decision on a sale (the admin page's changeSale): approve, reject, or pending. */
export const saleChange = createSelectSchema(sales)
  .pick({ id: true })
  .extend({
    status: createSelectSchema(sales).shape.status.extract(["approved", "rejected", "pending"]),
  });
