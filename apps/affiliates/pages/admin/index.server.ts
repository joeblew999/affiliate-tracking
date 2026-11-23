import {
  bonus,
  commissionRules,
  eventBooking,
  newOrganiser,
  newVenue,
  newCommissionRule,
  partnerChange,
  partners,
  payoutRun,
  payouts,
  ruleToRetire,
  saleChange,
  sales,
} from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type InferProps } from "void";
import { and, asc, db, desc, eq, inArray, ne } from "void/db";
import { env } from "void/env";
import { ensurePromotionCode } from "../../src/approval.ts";
import { linksOf } from "../../src/links.ts";
import { activePartner, partnerById } from "../../src/partners.ts";
import { partnersToPay, queuePayouts } from "../../src/payouts.ts";
import { stats } from "../../src/stats.ts";
import { bookEvent, bookingChoices, eventFigures } from "../../src/events.ts";
import { addOrganiser, addVenue } from "../../src/payees.ts";
import { shopUserByEmail } from "../../src/user.ts";
import { now as clock } from "../../src/clock.ts";

// The admin page: everything, for the host's admins only. ?partner=<id>: only that partner's sales
// and payouts. ?links=<partner id>: that partner's short links too, for the dialog that shows them.
export const loader = defineHandler(async (c) => {
  const linksFor = c.req.query("links") ?? null;
  const partnerId = c.req.query("partner");
  const origin = new URL(c.req.url).origin;
  const [partnerRows, payeeRows, saleRows, payoutRows, ruleRows, performance, events, choices] =
    await Promise.all([
      // Affiliates. Organisers and venues' contacts are paid too, but have no commission to set.
      db
        .select()
        .from(partners)
        .where(eq(partners.role, "affiliate"))
        .orderBy(desc(partners.createdAt)),
      db
        .select({
          id: partners.id,
          name: partners.name,
          email: partners.email,
          role: partners.role,
          stripeAccountId: partners.stripeAccountId,
        })
        .from(partners)
        .where(ne(partners.role, "affiliate"))
        .orderBy(asc(partners.name)),
      db
        .select({ sale: sales, partnerName: partners.name })
        .from(sales)
        .innerJoin(partners, eq(partners.id, sales.partnerId))
        .where(partnerId ? eq(sales.partnerId, partnerId) : undefined)
        .orderBy(desc(sales.createdAt))
        .limit(200),
      db
        .select({ payout: payouts, partnerName: partners.name })
        .from(payouts)
        .innerJoin(partners, eq(partners.id, payouts.partnerId))
        .where(partnerId ? eq(payouts.partnerId, partnerId) : undefined)
        .orderBy(desc(payouts.createdAt))
        .limit(200),
      db
        .select()
        .from(commissionRules)
        .orderBy(desc(commissionRules.active), desc(commissionRules.createdAt)),
      stats(null, 30),
      eventFigures(),
      bookingChoices(),
    ]);
  return {
    payoutCurrency: env.AFFILIATES_PAYOUT_CURRENCY,
    partners: partnerRows,
    payees: payeeRows.map(({ stripeAccountId, ...payee }) => ({
      ...payee,
      payoutsSetUp: stripeAccountId !== null,
    })),
    sales: saleRows.map(({ sale, partnerName }) => ({ ...sale, partnerName })),
    payouts: payoutRows.map(({ payout, partnerName }) => ({ ...payout, partnerName })),
    rules: ruleRows,
    stats: performance,
    links: linksFor ? { partnerId: linksFor, links: await linksOf(linksFor, origin) } : null,
    events,
    choices,
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Admin" }));

// What the admin page does (Void's page actions: each re-runs the loader after). Admins only, as
// the whole page is (middleware/01.user.ts).
export const actions = {
  // Book an event at a venue: its venue is paid at once (through the payout queue), and once that's
  // gone it's on sale and the shop tells its users (src/events.ts).
  bookEvent: defineHandler.withValidator({ body: eventBooking })(async (_c, { body }) => {
    await bookEvent(body);
  }),
  // A shop user, by email, becomes an organiser: paid a share of every ticket for their events.
  addOrganiser: defineHandler.withValidator({ body: newOrganiser })(async (c, { body }) => {
    const user = await shopUserByEmail(c, body.email);
    if (!user)
      throw new HTTPException(404, { message: `No shop user has the email ${body.email}` });
    await addOrganiser(user);
  }),
  // A venue, paid through its contact, a shop user found by email.
  addVenue: defineHandler.withValidator({ body: newVenue })(async (c, { body }) => {
    const { contactEmail, ...venue } = body;
    const contact = await shopUserByEmail(c, contactEmail);
    if (!contact)
      throw new HTTPException(404, { message: `No shop user has the email ${contactEmail}` });
    await addVenue(venue, contact);
  }),
  // Approve (active), suspend or reactivate a partner, and their terms. Approving also makes their
  // buyer-discount promotion code, when the service has a Stripe key and a coupon.
  changePartner: defineHandler.withValidator({ body: partnerChange })(async (c, { body }) => {
    const { id, ...change } = body;
    const [row] = await db.update(partners).set(change).where(eq(partners.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: "No such partner" });
    if (change.status === "active") await ensurePromotionCode(row);
  }),

  // A decision on a sale not yet paid: approve it, reject it (never approved automatically), or put
  // it back to pending. Not a clawback: what a refund takes back isn't up to a decision.
  changeSale: defineHandler.withValidator({ body: saleChange })(async (c, { body }) => {
    const [row] = await db
      .update(sales)
      .set({ status: body.status, approvedAt: body.status === "approved" ? clock() : null })
      .where(
        and(
          eq(sales.id, body.id),
          ne(sales.kind, "clawback"),
          inArray(sales.status, ["pending", "approved", "rejected"]),
        ),
      )
      .returning({ id: sales.id });
    if (!row)
      throw new HTTPException(409, {
        message: "Only a pending, approved or rejected sale (not a clawback) can be changed",
      });
  }),

  // A one-off bonus: a sale of kind "bonus", approved straight away and paid with the partner's next
  // payout. In the payout currency: a bonus has no Stripe payment to convert from.
  bonus: defineHandler.withValidator({ body: bonus })(async (c, { body }) => {
    if (!(await activePartner(body.partnerId)))
      throw new HTTPException(404, { message: "No such active partner" });
    const currency = env.AFFILIATES_PAYOUT_CURRENCY.toLowerCase();
    const now = clock();
    await db.insert(sales).values({
      partnerId: body.partnerId,
      kind: "bonus",
      status: "approved",
      amountCents: 0,
      currency,
      commissionCents: body.commissionCents,
      grossCommissionCents: body.commissionCents,
      payoutCurrency: currency,
      payoutCents: body.commissionCents,
      bonusNote: body.bonusNote,
      createdAt: now,
      approvedAt: now,
    });
  }),

  // A commission rule (src/commission.ts).
  addRule: defineHandler.withValidator({ body: newCommissionRule })(async (c, { body }) => {
    if (body.partnerId && !(await partnerById(body.partnerId)))
      throw new HTTPException(404, { message: "No such partner" });
    await db.insert(commissionRules).values(body);
  }),

  // A rule retired. Commission already earned under it stays as it is.
  retireRule: defineHandler.withValidator({ body: ruleToRetire })(async (c, { body }) => {
    await db.update(commissionRules).set({ active: false }).where(eq(commissionRules.id, body.id));
  }),

  // Payouts: one queue message per partner owed something (or one partner), paid by
  // queues/payouts.ts. Returns at once; the payouts list shows how each went.
  runPayouts: defineHandler.withValidator({ body: payoutRun })(async (c, { body }) => {
    const partnerIds = body.partnerId ? [body.partnerId] : await partnersToPay();
    await queuePayouts(partnerIds);
  }),
};
