// The hold period: a pending sale is approved once it's AFFILIATES_HOLD_DAYS old, unless it's
// refunded in full (status refunded), under an open dispute, flagged by the fraud checks, its partner isn't active, or the partner's sales
// are always reviewed by hand. Unset: an admin approves every sale. Run daily (crons/daily.ts).
import { partners, refundedPayments, sales } from "@schema";
import { and, db, eq, inArray, isNull, lte, notExists, or } from "void/db";
import { env } from "void/env";
import { now as clock } from "./clock.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function releaseHeldSales(now = clock()): Promise<number> {
  const days = env.AFFILIATES_HOLD_DAYS;
  if (days === undefined) return 0;
  const eligiblePartners = db
    .select({ id: partners.id })
    .from(partners)
    .where(and(eq(partners.status, "active"), eq(partners.reviewRequired, false)));
  const released = await db
    .update(sales)
    .set({ status: "approved", approvedAt: now })
    .where(
      and(
        eq(sales.status, "pending"),
        lte(sales.createdAt, now - days * DAY_MS),
        isNull(sales.fraudReason),
        inArray(sales.partnerId, eligiblePartners),
        or(
          isNull(sales.paymentIntent),
          notExists(
            db
              .select({ paymentIntent: refundedPayments.paymentIntent })
              .from(refundedPayments)
              .where(
                and(
                  eq(refundedPayments.paymentIntent, sales.paymentIntent),
                  eq(refundedPayments.disputeStatus, "open"),
                ),
              ),
          ),
        ),
      ),
    )
    .returning({ id: sales.id });
  return released.length;
}
