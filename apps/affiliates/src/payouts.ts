// Paying partners, one partner at a time, from the payouts queue (queues/payouts.ts):
//   1. Settle: each approved sale's commission in the payout currency (AFFILIATES_PAYOUT_CURRENCY).
//      Same currency: as is. Another: at the rate Stripe settled that sale at (its balance
//      transaction), kept in fxSource. One Stripe can't convert stays out of the payout.
//   2. Claim: in one transaction, a payout for the partner's settled sales (at least
//      AFFILIATES_MIN_PAYOUT_CENTS), the sales marked paying. A pending payout is resumed instead.
//   3. Pay: a Stripe transfer to the partner's Connect account. Its transfer_group is the payout's
//      own, and Stripe is asked for that group's transfer before sending, so a retry at any age
//      never pays twice. Without a Connect account the payout is manual: an admin pays it.
//   4. Finish: payout sent (or manual), its sales paid. A sale refunded before the transfer sends the
//      payout back: failed, its other sales approved again for the next run.
// Every step can be run again after a crash and picks up where it was.
import { partners, payouts, sales } from "@schema";
import { and, db, eq, isNotNull, isNull, ne, sql, sum } from "void/db";
import { env } from "void/env";
import { hasStripe, stripe } from "./stripe";

export type Payout = typeof payouts.$inferSelect;
export type PayoutOutcome =
  | { status: "sent" | "manual"; payoutId: string; amountCents: number }
  | { status: "nothing owed" }
  | { status: "failed"; payoutId: string; reason: string };

export const transferGroup = (payoutId: string) => `affiliates_payout_${payoutId}`;

/** Step 1: the payout-currency amount of each approved, unclaimed sale that doesn't have one. */
export async function settle(partnerId: string): Promise<void> {
  const target = env.AFFILIATES_PAYOUT_CURRENCY.toLowerCase();
  const unclaimed = and(
    eq(sales.partnerId, partnerId),
    eq(sales.status, "approved"),
    isNull(sales.payoutId),
    isNull(sales.payoutCents),
  );
  await db
    .update(sales)
    .set({ payoutCurrency: target, payoutCents: sql`${sales.commissionCents}` })
    .where(and(unclaimed, eq(sales.currency, target)));
  if (!hasStripe()) return;
  const foreign = await db
    .select({
      id: sales.id,
      paymentIntent: sales.paymentIntent,
      currency: sales.currency,
      commissionCents: sales.commissionCents,
    })
    .from(sales)
    .where(and(unclaimed, ne(sales.currency, target), isNotNull(sales.paymentIntent)))
    .limit(100);
  for (const sale of foreign) {
    const intent = await stripe().paymentIntents.retrieve(sale.paymentIntent ?? "", {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const txn =
      charge && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
    if (
      !charge ||
      !txn ||
      charge.currency !== sale.currency ||
      txn.currency !== target ||
      charge.amount <= 0 ||
      txn.amount <= 0
    )
      continue;
    await db
      .update(sales)
      .set({
        payoutCurrency: target,
        payoutCents: Math.round((sale.commissionCents * txn.amount) / charge.amount),
        fxSource: txn.id,
      })
      .where(and(eq(sales.id, sale.id), isNull(sales.payoutCents)));
  }
}

async function pendingPayout(partnerId: string): Promise<Payout | null> {
  const [row] = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.partnerId, partnerId), eq(payouts.status, "pending")))
    .limit(1);
  return row ?? null;
}

/** Step 2: the partner's pending payout, or a new one for their settled sales; null if none is owed. */
export async function claim(partnerId: string): Promise<Payout | null> {
  const pending = await pendingPayout(partnerId);
  if (pending) return pending;
  const target = env.AFFILIATES_PAYOUT_CURRENCY.toLowerCase();
  const claimable = and(
    eq(sales.partnerId, partnerId),
    eq(sales.status, "approved"),
    isNull(sales.payoutId),
    eq(sales.payoutCurrency, target),
  );
  const [owed] = await db
    .select({ cents: sum(sales.payoutCents) })
    .from(sales)
    .where(claimable);
  const cents = Number(owed?.cents ?? 0);
  if (cents <= 0 || cents < env.AFFILIATES_MIN_PAYOUT_CENTS) return null;
  const [partner] = await db
    .select({ stripeAccountId: partners.stripeAccountId })
    .from(partners)
    .where(eq(partners.id, partnerId));
  const id = crypto.randomUUID();
  // One transaction: the payout and its sales together. The unique pending-payout index makes a
  // second claim running at the same time fail here instead of paying twice.
  await db.batch([
    db.insert(payouts).values({
      id,
      partnerId,
      amountCents: 0,
      currency: target,
      batchKey: id,
      stripeAccountId: partner?.stripeAccountId ?? null,
    }),
    db.update(sales).set({ status: "paying", payoutId: id }).where(claimable),
    db
      .update(payouts)
      .set({
        amountCents: sql`(SELECT COALESCE(SUM(${sales.payoutCents}), 0) FROM ${sales} WHERE ${sales.payoutId} = ${id})`,
      })
      .where(eq(payouts.id, id)),
  ]);
  return pendingPayout(partnerId);
}

/** Step 4 when a sale in it was refunded first: the payout failed, its other sales back to approved. */
async function release(payout: Payout, reason: string): Promise<void> {
  await db.batch([
    db
      .update(payouts)
      .set({ status: "failed", lastError: reason })
      .where(and(eq(payouts.id, payout.id), eq(payouts.status, "pending"))),
    db
      .update(sales)
      .set({
        status: sql`CASE WHEN ${sales.status} = 'paying' THEN 'approved' ELSE ${sales.status} END`,
        payoutId: null,
      })
      .where(eq(sales.payoutId, payout.id)),
  ]);
}

/** Step 4: the payout done, its sales paid. */
async function finish(
  payout: Payout,
  status: "sent" | "manual",
  transferId: string | null,
): Promise<void> {
  const now = Date.now();
  await db.batch([
    db
      .update(payouts)
      .set({ status, stripeTransferId: transferId, paidAt: now, lastError: null })
      .where(and(eq(payouts.id, payout.id), eq(payouts.status, "pending"))),
    db
      .update(sales)
      .set({ status: "paid", paidAt: now })
      .where(and(eq(sales.payoutId, payout.id), eq(sales.status, "paying"))),
  ]);
}

/** Step 3: the transfer for this payout, found (an earlier attempt's) or made. */
async function transfer(payout: Payout, destination: string): Promise<string> {
  const group = transferGroup(payout.id);
  const existing = await stripe().transfers.list({ transfer_group: group, limit: 1 });
  const found = existing.data[0];
  if (found) return found.id;
  const made = await stripe().transfers.create(
    {
      amount: payout.amountCents,
      currency: payout.currency,
      destination,
      transfer_group: group,
      metadata: { partner_id: payout.partnerId, payout_id: payout.id },
    },
    { idempotencyKey: `affiliates_transfer_${payout.batchKey}` },
  );
  return made.id;
}

export async function payPartner(partnerId: string): Promise<PayoutOutcome> {
  await settle(partnerId);
  const payout = await claim(partnerId);
  if (!payout) return { status: "nothing owed" };
  const [refunded] = await db
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.payoutId, payout.id), eq(sales.status, "refunded")))
    .limit(1);
  if (refunded && !payout.transferStartedAt) {
    await release(payout, "a sale in it was refunded before paying; run payouts again");
    return {
      status: "failed",
      payoutId: payout.id,
      reason: "a sale in it was refunded before paying",
    };
  }
  if (!payout.stripeAccountId) {
    await finish(payout, "manual", null);
    return { status: "manual", payoutId: payout.id, amountCents: payout.amountCents };
  }
  await db
    .update(payouts)
    .set({ transferStartedAt: sql`COALESCE(${payouts.transferStartedAt}, ${Date.now()})` })
    .where(eq(payouts.id, payout.id));
  try {
    const transferId = await transfer(payout, payout.stripeAccountId);
    await finish(payout, "sent", transferId);
    return { status: "sent", payoutId: payout.id, amountCents: payout.amountCents };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.update(payouts).set({ lastError: reason }).where(eq(payouts.id, payout.id));
    throw err; // the queue retries
  }
}

/** Partners owed something, or with a payout still pending: who a payout run queues. */
export async function partnersToPay(): Promise<string[]> {
  const owed = await db
    .selectDistinct({ id: sales.partnerId })
    .from(sales)
    .innerJoin(partners, eq(partners.id, sales.partnerId))
    .where(
      and(eq(sales.status, "approved"), isNull(sales.payoutId), eq(partners.status, "active")),
    );
  const pending = await db
    .selectDistinct({ id: payouts.partnerId })
    .from(payouts)
    .where(eq(payouts.status, "pending"));
  return [...new Set([...owed, ...pending].map((row) => row.id))];
}

export async function partnersWithPendingPayouts(): Promise<string[]> {
  return (
    await db
      .selectDistinct({ id: payouts.partnerId })
      .from(payouts)
      .where(eq(payouts.status, "pending"))
  ).map((row) => row.id);
}
