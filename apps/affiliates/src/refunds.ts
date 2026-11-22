// Refunds and disputes (routes/api/host/stripe-event.ts, from the host's Stripe webhook), and what they take back from commission.
//
// Stripe sends running totals, so each event sets the payment's refunded and disputed amounts in
// refunded_payments (whether its sale has arrived yet or not), then brings each of its sales in line:
//   - A sale not in a payout: its commission goes down by the share of the sale refunded; refunded
//     in full, its status is refunded. A dispute that's won gives it back.
//   - A sale in a payout (paying or paid): what's in the payout stays, and the change goes on a
//     clawback, a line in the payout currency that the partner's next payout nets off. A payout
//     whose transfer hasn't started yet is sent back instead (src/payouts.ts), so it's never paid.
// Each change to a sale bumps its refundVersion, and a clawback is unique by (sale, version) and
// written in the same transaction as the change, which only happens if the sale is as it was read:
// an event run twice, or two at once, never counts a refund twice.
import { refundedPayments, sales } from "@schema";
import { and, db, eq, inArray, isNull, lt, notExists, or } from "void/db";
import { alias } from "void/schema-d1";
import { now as clock } from "./clock.ts";

type Sale = typeof sales.$inferSelect;

/** The part of a commission that a refund of refundedCents, of a sale of amountCents, takes. */
export function refundShare(commissionCents: number, refundedCents: number, amountCents: number) {
  if (amountCents <= 0 || refundedCents <= 0) return 0;
  return Math.round((commissionCents * Math.min(refundedCents, amountCents)) / amountCents);
}

/** A refund's running total for a payment (Stripe's charge.amount_refunded). */
export async function noteRefund(paymentIntent: string, refundedCents: number): Promise<number> {
  await db
    .insert(refundedPayments)
    .values({ paymentIntent, refundedCents })
    .onConflictDoUpdate({
      target: refundedPayments.paymentIntent,
      set: { refundedCents },
      // Stripe's events can arrive out of order: the total only goes up.
      setWhere: lt(refundedPayments.refundedCents, refundedCents),
    });
  return applyRefunds(paymentIntent);
}

/** A dispute opened (charge.dispute.created) or closed (charge.dispute.closed: won or lost). */
export async function noteDispute(
  paymentIntent: string,
  disputedCents: number,
  status: "open" | "won" | "lost",
): Promise<number> {
  // A dispute's events can arrive out of order: once closed, a late "open" changes nothing.
  await db
    .insert(refundedPayments)
    .values({ paymentIntent, disputedCents, disputeStatus: status })
    .onConflictDoUpdate({
      target: refundedPayments.paymentIntent,
      set: { disputedCents, disputeStatus: status },
      setWhere:
        status === "open"
          ? or(isNull(refundedPayments.disputeStatus), eq(refundedPayments.disputeStatus, "open"))
          : undefined,
    });
  return applyRefunds(paymentIntent);
}

/** Brings every sale of a payment in line with what's refunded of it. How many changed. */
export async function applyRefunds(paymentIntent: string): Promise<number> {
  const [payment] = await db
    .select()
    .from(refundedPayments)
    .where(eq(refundedPayments.paymentIntent, paymentIntent));
  if (!payment) return 0;
  const taken =
    payment.refundedCents + (payment.disputeStatus === "won" ? 0 : payment.disputedCents);
  let changed = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(sales)
      .where(
        and(eq(sales.paymentIntent, paymentIntent), inArray(sales.kind, ["checkout", "renewal"])),
      );
    let retry = false;
    for (const sale of rows) {
      const outcome = await applyToSale(sale, Math.min(taken, sale.amountCents));
      if (outcome === "changed") changed++;
      if (outcome === "raced") retry = true;
    }
    if (!retry) return changed;
  }
}

async function applyToSale(
  sale: Sale,
  refundedCents: number,
): Promise<"unchanged" | "changed" | "raced"> {
  if (refundedCents === sale.refundedCents) return "unchanged";
  const version = sale.refundVersion + 1;
  const unchangedSince = and(eq(sales.id, sale.id), eq(sales.refundVersion, sale.refundVersion));
  const gross = sale.grossCommissionCents;

  if (!sale.payoutId) {
    const full = refundedCents >= sale.amountCents;
    const status =
      full && (sale.status === "pending" || sale.status === "approved")
        ? "refunded"
        : !full && sale.status === "refunded"
          ? "pending" // a won dispute: back through the hold period
          : sale.status;
    const updated = await db
      .update(sales)
      .set({
        refundedCents,
        refundVersion: version,
        status,
        commissionCents: gross - refundShare(gross, refundedCents, sale.amountCents),
        // Settled again at the next payout run, from the new commission.
        payoutCurrency: null,
        payoutCents: null,
        fxSource: null,
      })
      .where(and(unchangedSince, isNull(sales.payoutId)))
      .returning({ id: sales.id });
    return updated.length ? "changed" : "raced";
  }

  // In a payout: the change in what's taken, in the payout currency at the rate it was paid at.
  const takenBefore = refundShare(gross, sale.refundedCents, sale.amountCents);
  const takenNow = refundShare(gross, refundedCents, sale.amountCents);
  const clawCents =
    sale.payoutCents && sale.commissionCents
      ? Math.round(((takenNow - takenBefore) * sale.payoutCents) / sale.commissionCents)
      : 0;
  const update = db
    .update(sales)
    .set({ refundedCents, refundVersion: version })
    .where(and(unchangedSince, eq(sales.payoutId, sale.payoutId)))
    .returning({ id: sales.id });
  if (clawCents === 0) return (await update).length ? "changed" : "raced";
  const now = clock();
  const current = alias(sales, "current");
  const [, updated] = await db.batch([
    db
      .insert(sales)
      .values({
        partnerId: sale.partnerId,
        kind: "clawback",
        status: "approved",
        userId: sale.userId,
        linkId: sale.linkId,
        customerEmail: sale.customerEmail,
        customerCountry: sale.customerCountry,
        amountCents: 0,
        currency: sale.payoutCurrency ?? sale.currency,
        commissionCents: -clawCents,
        grossCommissionCents: -clawCents,
        refundOf: sale.id,
        refundVersion: version,
        payoutCurrency: sale.payoutCurrency,
        payoutCents: -clawCents,
        createdAt: now,
        approvedAt: now,
      })
      .onConflictDoNothing(),
    update,
    // The update didn't happen (the sale changed meanwhile): this clawback isn't owed.
    db.delete(sales).where(
      and(
        eq(sales.kind, "clawback"),
        eq(sales.refundOf, sale.id),
        eq(sales.refundVersion, version),
        isNull(sales.payoutId),
        notExists(
          db
            .select({ id: current.id })
            .from(current)
            .where(
              and(
                eq(current.id, sale.id),
                eq(current.refundVersion, version),
                eq(current.payoutId, sale.payoutId),
              ),
            ),
        ),
      ),
    ),
  ]);
  return updated.length ? "changed" : "raced";
}
