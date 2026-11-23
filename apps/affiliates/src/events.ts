// Events, their venues and organisers, and the money of each:
// - booking: the event, and its venue's payment (a sale of kind venue for the venue's payee,
//   approved at once), queued to be paid like any payout (src/payouts.ts);
// - on sale: once the venue's payment has gone (venuePaid, from the payout's finish, and the daily
//   job in case that was missed), the event is on sale and the host is told (queues/on-sale.ts);
// - figures: per event, what it has sold and earned, what it costs, and how many more tickets
//   it takes to break even.
import { events, partners, sales, venues, type eventBooking } from "@schema";
import { HTTPException } from "hono/http-exception";
import { and, asc, db, eq, gt, inArray, isNotNull, isNull, ne, sql } from "void/db";
import { queues } from "./activity.ts";
import { queuePayouts } from "./payouts.ts";
import type { z } from "zod";
import type { Event } from "./host-contract.ts";
import { now as clock } from "./clock.ts";
import { refundShare } from "./refunds.ts";

/** Tickets sold, by event: a ticket's record is its organiser's share (every ticket has one). */
async function ticketsSold(): Promise<Map<string, number>> {
  const rows = await db
    .select({ eventId: sales.eventId, n: sql<number>`count(*)` })
    .from(sales)
    .where(and(eq(sales.kind, "organiser"), ne(sales.status, "refunded")))
    .groupBy(sales.eventId);
  return new Map(rows.map((r) => [r.eventId ?? "", Number(r.n)]));
}

/** The events on sale and still to come, soonest first, as the host shows them. */
export async function eventsOnSale(): Promise<Event[]> {
  const rows = await db
    .select({ event: events, venue: venues })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(isNotNull(events.onSaleAt), gt(events.endsAt, clock())))
    .orderBy(asc(events.startsAt));
  const sold = await ticketsSold();
  return rows.map(({ event, venue }) => ({
    id: event.id,
    productId: event.productId,
    name: event.name,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: venue.location,
    priceCents: event.priceCents,
    currency: event.currency,
    placesLeft: Math.max(0, venue.capacity - (sold.get(event.id) ?? 0)),
  }));
}

/** One event, as the host shows it, if it's on sale. */
export async function eventOnSale(id: string): Promise<Event | null> {
  return (await eventsOnSale()).find((e) => e.id === id) ?? null;
}

/** The organiser and pct for a ticket to this event, if it's on sale. */
export async function ticketTerms(eventId: string) {
  const [row] = await db
    .select({ event: events, organiser: partners })
    .from(events)
    .innerJoin(partners, eq(partners.id, events.organiserId))
    .where(and(eq(events.id, eventId), isNotNull(events.onSaleAt)));
  return row ?? null;
}

/** An admin books an event: it's made, and its venue's payment queued. Not on sale until paid. */
export async function bookEvent(booking: z.output<typeof eventBooking>) {
  const [venue] = await db.select().from(venues).where(eq(venues.id, booking.venueId));
  if (!venue) throw new HTTPException(400, { message: "There's no such venue" });
  const [organiser] = await db
    .select()
    .from(partners)
    .where(
      and(
        eq(partners.id, booking.organiserId),
        eq(partners.role, "organiser"),
        eq(partners.status, "active"),
      ),
    );
  if (!organiser) throw new HTTPException(400, { message: "There's no such organiser" });
  const startsAt = Date.parse(`${booking.startsAt}Z`);
  if (!(startsAt > clock()))
    throw new HTTPException(400, { message: "An event has to start in the future" });
  const id = crypto.randomUUID();
  const now = clock();
  await db.batch([
    db.insert(events).values({
      id,
      productId: `prod_${id.replaceAll("-", "")}`,
      name: booking.name,
      description: booking.description,
      venueId: venue.id,
      organiserId: organiser.id,
      organiserPct: booking.organiserPct,
      priceCents: booking.priceCents,
      currency: venue.currency,
      startsAt,
      endsAt: startsAt + booking.hours * 60 * 60 * 1000,
      bookedAt: now,
    }),
    // The venue's payment: its price, approved now, paid by the next payout for its payee.
    db.insert(sales).values({
      partnerId: venue.payeeId,
      kind: "venue",
      status: "approved",
      eventId: id,
      amountCents: venue.priceCents,
      netCents: venue.priceCents,
      currency: venue.currency,
      commissionCents: venue.priceCents,
      grossCommissionCents: venue.priceCents,
      createdAt: now,
      approvedAt: now,
    }),
  ]);
  await queuePayouts([venue.payeeId]);
  return id;
}

/**
 * Events whose venue payment has been paid (in this payout, or any) and that aren't on sale yet:
 * on sale now, and the host told. Run again, it finds none.
 */
export async function venuePaid(payoutId?: string): Promise<number> {
  const paidVenueSales = db
    .select({ eventId: sales.eventId })
    .from(sales)
    .where(
      and(
        eq(sales.kind, "venue"),
        eq(sales.status, "paid"),
        payoutId ? eq(sales.payoutId, payoutId) : undefined,
      ),
    );
  const ready = await db
    .update(events)
    .set({ onSaleAt: clock() })
    .where(and(isNull(events.onSaleAt), inArray(events.id, paidVenueSales)))
    .returning({ id: events.id });
  for (const { id } of ready) {
    await queues["on-sale"].send({ eventId: id });
  }
  return ready.length;
}

/** Each event's money, for the admin page. */
export async function eventFigures() {
  const rows = await db
    .select({ event: events, venue: venues, organiser: partners })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(partners, eq(partners.id, events.organiserId))
    .orderBy(asc(events.startsAt));
  // Every event's lines, by condition rather than a list of ids: D1 takes at most 100 values in a
  // query.
  const lines = rows.length
    ? await db
        .select({
          eventId: sales.eventId,
          id: sales.id,
          kind: sales.kind,
          status: sales.status,
          netCents: sales.netCents,
          amountCents: sales.amountCents,
          refundedCents: sales.refundedCents,
          commissionCents: sales.commissionCents,
        })
        .from(sales)
        .where(isNotNull(sales.eventId))
    : [];
  // A clawback (a refund after a share was paid) takes back from its sale's event too.
  const clawbacks = rows.length
    ? await db
        .select({ refundOf: sales.refundOf, commissionCents: sales.commissionCents })
        .from(sales)
        .where(
          and(
            eq(sales.kind, "clawback"),
            inArray(
              sales.refundOf,
              db.select({ id: sales.id }).from(sales).where(isNotNull(sales.eventId)),
            ),
          ),
        )
    : [];
  const clawedBack = new Map<string, number>();
  for (const c of clawbacks)
    clawedBack.set(c.refundOf ?? "", (clawedBack.get(c.refundOf ?? "") ?? 0) + c.commissionCents);

  return rows.map(({ event, venue, organiser }) => {
    const mine = lines.filter((l) => l.eventId === event.id);
    const shares = mine.filter((l) => l.kind === "organiser");
    const sold = shares.filter((l) => l.status !== "refunded").length;
    // What the tickets brought in, not counting tax, less what refunds gave back.
    const revenueCents = shares.reduce(
      (sum, l) =>
        sum + (l.netCents ?? 0) - refundShare(l.netCents ?? 0, l.refundedCents, l.amountCents),
      0,
    );
    const paidOut = (kind: "organiser" | "checkout") =>
      mine
        .filter((l) => l.kind === kind)
        .reduce((sum, l) => sum + l.commissionCents + (clawedBack.get(l.id) ?? 0), 0);
    const organiserCents = paidOut("organiser");
    const affiliateCents = paidOut("checkout");
    const venueCents = venue.priceCents;
    const profitCents = revenueCents - organiserCents - affiliateCents - venueCents;
    // What a ticket nets after its shares: on average so far, or before any, the price less the
    // organiser's share.
    const perTicketCents = sold
      ? (revenueCents - organiserCents - affiliateCents) / sold
      : event.priceCents * (1 - event.organiserPct / 100);
    return {
      id: event.id,
      name: event.name,
      startsAt: event.startsAt,
      onSale: event.onSaleAt !== null,
      venue: venue.name,
      organiser: organiser.name ?? organiser.email,
      organiserPct: event.organiserPct,
      priceCents: event.priceCents,
      currency: event.currency,
      capacity: venue.capacity,
      sold,
      revenueCents,
      venueCents,
      organiserCents,
      affiliateCents,
      profitCents,
      toBreakEven:
        profitCents >= 0 || perTicketCents <= 0 ? 0 : Math.ceil(-profitCents / perTicketCents),
    };
  });
}

/** The venues and organisers an admin can book an event with. */
export async function bookingChoices() {
  const venueRows = await db
    .select({ venue: venues, contact: partners.email })
    .from(venues)
    .innerJoin(partners, eq(partners.id, venues.payeeId))
    .orderBy(asc(venues.name));
  const organisers = await db
    .select({ id: partners.id, name: partners.name, email: partners.email })
    .from(partners)
    .where(and(eq(partners.role, "organiser"), eq(partners.status, "active")))
    .orderBy(asc(partners.name));
  return {
    venues: venueRows.map(({ venue, contact }) => ({
      id: venue.id,
      name: venue.name,
      location: venue.location,
      capacity: venue.capacity,
      priceCents: venue.priceCents,
      currency: venue.currency,
      contact,
    })),
    organisers,
  };
}
