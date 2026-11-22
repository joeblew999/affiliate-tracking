import { integer, sqliteTable, text } from "void/schema-d1";
import { now } from "./columns";

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
