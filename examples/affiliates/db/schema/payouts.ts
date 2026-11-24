import { sql } from "void/db";
import { createInsertSchema } from "void/drizzle-zod";
import { integer, sqliteTable, text, uniqueIndex } from "void/schema-d1";
import { id, now } from "./columns.ts";
import { partners } from "./partners.ts";

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
    /**
     * The money for the transfer, added to the payouts account from the business's bank (a Stripe
     * top-up), before the transfer is sent. Null for a manual payout.
     */
    stripeTopupId: text(),
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

/** Run payouts (the admin page's runPayouts): for everyone owed, or one partner. */
export const payoutRun = createInsertSchema(payouts).pick({ partnerId: true }).partial();
