// What the service's work leaves behind, written to the streams as it's saved, so whoever watches
// an action finish can read its result there and needn't ask the database or a page. Durable State
// (@durable-streams/state): each change says which thing, by type and key, and its value now.
// Written by the code that did the saving, as part of its step (examples/activity's outcome): the
// outcome of an action, not a second copy of the tables kept in step by something else. Each
// goes to the viewers of the action it's part of (who did it, and the admins).
import { createStateSchema } from "@durable-streams/state";
import { events, links, partners, payouts, referrals, sales } from "@schema";
import { outcome } from "activity/server";
import { and, db, eq, inArray, isNull, or } from "void/db";
import { createSelectSchema } from "void/drizzle-zod";

/** The things written, each as its table has it. */
export const outcomes = createStateSchema({
  sales: { schema: createSelectSchema(sales), type: "sale", primaryKey: "id" },
  payouts: { schema: createSelectSchema(payouts), type: "payout", primaryKey: "id" },
  partners: { schema: createSelectSchema(partners), type: "partner", primaryKey: "id" },
  links: { schema: createSelectSchema(links), type: "link", primaryKey: "id" },
  referrals: { schema: createSelectSchema(referrals), type: "referral", primaryKey: "id" },
  events: { schema: createSelectSchema(events), type: "event", primaryKey: "id" },
});

type Ids = readonly (string | null | undefined)[];
const known = (ids: Ids) => ids.filter((id): id is string => typeof id === "string");

/** These sales were just written (new, or changed): each as it's now saved. */
export async function salesWritten(ids: Ids) {
  if (known(ids).length === 0) return;
  const rows = await db
    .select()
    .from(sales)
    .where(inArray(sales.id, known(ids)));
  await outcome(...rows.map((value) => outcomes.sales.upsert({ value })));
}

/** Every sale of a payment, and what was clawed back for them: after its refunds were applied. */
export async function salesOfPaymentWritten(paymentIntent: string) {
  const of = await db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.paymentIntent, paymentIntent));
  if (of.length === 0) return;
  const ids = of.map((sale) => sale.id);
  const rows = await db
    .select()
    .from(sales)
    .where(or(inArray(sales.id, ids), inArray(sales.refundOf, ids)));
  await outcome(...rows.map((value) => outcomes.sales.upsert({ value })));
}

/**
 * A partner was just paid, or tried: the payout, the sales in it, and (a payout let go of) the
 * partner's sales that are owed again.
 */
export async function payoutWritten(partnerId: string, payoutId: string | undefined) {
  if (!payoutId) return;
  const paid = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  const theirs = await db
    .select()
    .from(sales)
    .where(
      or(
        eq(sales.payoutId, payoutId),
        and(eq(sales.partnerId, partnerId), isNull(sales.payoutId), eq(sales.status, "approved")),
      ),
    );
  await outcome(
    ...paid.map((value) => outcomes.payouts.upsert({ value })),
    ...theirs.map((value) => outcomes.sales.upsert({ value })),
  );
}

/** These partners were just written. */
export async function partnersWritten(ids: Ids) {
  if (known(ids).length === 0) return;
  const rows = await db
    .select()
    .from(partners)
    .where(inArray(partners.id, known(ids)));
  await outcome(...rows.map((value) => outcomes.partners.upsert({ value })));
}

/** These links were just written. */
export async function linksWritten(ids: Ids) {
  if (known(ids).length === 0) return;
  const rows = await db
    .select()
    .from(links)
    .where(inArray(links.id, known(ids)));
  await outcome(...rows.map((value) => outcomes.links.upsert({ value })));
}

/** This user's referral was just written (a user has one at most). */
export async function referralWritten(userId: string) {
  const rows = await db.select().from(referrals).where(eq(referrals.userId, userId));
  await outcome(...rows.map((value) => outcomes.referrals.upsert({ value })));
}

/** These events were just written, with the sales made for them at the time (the venue's payment). */
export async function eventsWritten(ids: Ids) {
  if (known(ids).length === 0) return;
  const rows = await db
    .select()
    .from(events)
    .where(inArray(events.id, known(ids)));
  const venue = await db
    .select()
    .from(sales)
    .where(and(inArray(sales.eventId, known(ids)), eq(sales.kind, "venue")));
  await outcome(
    ...rows.map((value) => outcomes.events.upsert({ value })),
    ...venue.map((value) => outcomes.sales.upsert({ value })),
  );
}
