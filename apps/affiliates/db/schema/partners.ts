import { createInsertSchema, createSelectSchema, createUpdateSchema } from "void/drizzle-zod";
import { integer, real, sqliteTable, text, uniqueIndex } from "void/schema-d1";
import { z } from "zod";
import { id, now } from "./columns";

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

/** A shop user applying to be a partner (POST /api/partners). */
export const partnerApplication = createInsertSchema(partners, {
  application: (s) => s.trim().max(2000),
})
  .pick({ application: true })
  .partial()
  // The column allows no name; an applicant gives one.
  .extend({ name: z.string().trim().min(1).max(100), acceptTerms: z.literal(true) });

/**
 * An admin's change to a partner (PATCH /api/partners/[id]): approve or suspend (pending is only for
 * new applicants), and their terms.
 */
export const partnerChange = createUpdateSchema(partners, {
  commissionPct: (s) => s.min(0).max(100),
  recurringMonths: (s) => s.min(0).max(1200),
})
  .pick({ commissionPct: true, recurringMonths: true, reviewRequired: true })
  .extend({ status: createSelectSchema(partners).shape.status.exclude(["pending"]).optional() });
