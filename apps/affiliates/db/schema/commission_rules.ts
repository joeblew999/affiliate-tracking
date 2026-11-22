import { createInsertSchema } from "void/drizzle-zod";
import { index, integer, real, sqliteTable, text } from "void/schema-d1";
import { z } from "zod";
import { id, now } from "./columns";
import { partners } from "./partners";

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

/** A new commission rule (POST /api/commission_rules): a percent, or a fixed amount per unit. */
export const newCommissionRule = createInsertSchema(commissionRules, {
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
    { message: "a percent rule needs percent; a fixed one needs fixedCents and currency" },
  );

/** Retiring a rule (PATCH /api/commission_rules/[id]): earned commission stays as it is. */
export const commissionRuleChange = z.object({ active: z.literal(false) });
