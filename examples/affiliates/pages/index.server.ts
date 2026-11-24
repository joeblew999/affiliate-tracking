import { events, linkToArchive, newLink, partnerApplication, partners, sales } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type InferProps } from "void";
import type { Href } from "void/routes";
import { asc, db, eq, sql } from "void/db";
import { env } from "void/env";
import { z } from "zod";
import { requirePartner, requireUser } from "../src/access.ts";
import { notePartnerIp } from "../src/fraud.ts";
import { archiveLink, createLink, linksOf } from "../src/links.ts";
import { codeFor, partnerForUser } from "../src/partners.ts";
import { payoutCountries } from "../src/payout-countries.ts";
import { hasPayoutsStripe, payoutsStripe } from "../src/stripe.ts";
import { earnings, stats } from "../src/stats.ts";
import { requestIpHash } from "../src/visitor.ts";
import { now as clock } from "../src/clock.ts";
import { partnersWritten } from "../src/outcomes.ts";

// The partner's page: their partner record, and for an active partner their links and the last 30
// days. (Who's signed in is in the layout's shared data: middleware/01.user.ts.)
export const loader = defineHandler(async (c) => {
  const user = requireUser(c);
  const program = { holdDays: env.AFFILIATES_HOLD_DAYS ?? null };
  const record = await partnerForUser(user.id);
  // An admin who isn't a partner has nothing here: the admin page.
  if (user.role === "admin" && !record && !user.impersonatedBy)
    throw new HTTPException(302, { res: c.redirect("/admin") });
  const active = record?.status === "active";
  if (record && active) await notePartnerIp(record.id, await requestIpHash(c.req.raw));
  const origin = new URL(c.req.url).origin;
  return {
    program,
    partner: record
      ? {
          name: record.name,
          role: record.role,
          code: record.code,
          status: record.status,
          commissionPct: record.commissionPct,
          promoCode: record.promoCode,
          paidOut: Boolean(record.stripeAccountId),
          link: new URL(`/r/${record.code}`, origin).toString(),
        }
      : null,
    links: record && active && record.role === "affiliate" ? await linksOf(record.id, origin) : [],
    // An organiser's or a venue contact's events: what each has paid them.
    payeeEvents:
      record && active && record.role !== "affiliate"
        ? await db
            .select({
              id: events.id,
              name: events.name,
              startsAt: events.startsAt,
              currency: events.currency,
              tickets: sql<number>`sum(case when ${sales.kind} = 'organiser' and ${sales.status} != 'refunded' then 1 else 0 end)`,
              earnedCents: sql<number>`sum(${sales.commissionCents})`,
            })
            .from(sales)
            .innerJoin(events, eq(events.id, sales.eventId))
            .where(eq(sales.partnerId, record.id))
            .groupBy(events.id)
            .orderBy(asc(events.startsAt))
        : [],
    stats: record && active ? await stats(record.id, 30) : null,
    earnings: record && active ? await earnings(record.id) : [],
    // Setting up payouts: the countries their Stripe account can be in, theirs (by where they are
    // now) first. None: payouts aren't set up on this service, or they have theirs.
    payoutCountries:
      record && active && !record.stripeAccountId && hasPayoutsStripe()
        ? await payoutCountries()
        : [],
    country: (c.req.raw.cf?.country as string | undefined) ?? null,
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Dashboard" }));

/** The terms a partner accepts when applying; bump when they change. */
export const TERMS_VERSION = "2026-11-22";

// What the partner page does (Void's page actions: each re-runs the loader after).
export const actions = {
  // A signed-in shop user applies to be a partner. Pending until an admin approves.
  apply: defineHandler.withValidator({ body: partnerApplication })(async (c, { body }) => {
    const user = requireUser(c);
    const existing = await partnerForUser(user.id);
    if (existing)
      throw new HTTPException(409, {
        message:
          existing.role === "affiliate"
            ? "Already applied"
            : "An organiser or a venue's contact can't also be an affiliate",
      });
    const [row] = await db
      .insert(partners)
      .values({
        userId: user.id,
        email: user.email,
        name: body.name,
        code: codeFor(body.name),
        application: body.application ?? null,
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: clock(),
      })
      .returning({ id: partners.id });
    await partnersWritten([row?.id]);
  }),

  // A new short link.
  createLink: defineHandler.withValidator({ body: newLink })(async (c, { body }) => {
    const { partner } = await requirePartner(c);
    await createLink(partner, body);
  }),

  // One of their links archived: it stops redirecting (it goes to the site's home page).
  archiveLink: defineHandler.withValidator({ body: linkToArchive })(async (c, { body }) => {
    const { partner } = await requirePartner(c);
    await archiveLink(partner.id, body.id);
  }),

  // Getting paid: a Stripe Connect Express account in the payouts account, in the country the
  // partner chose (made the first time), then Stripe's own onboarding, which comes back here.
  // Until then an admin pays the partner by hand.
  connect: defineHandler.withValidator({ body: z.object({ country: z.string().length(2) }) })(
    async (c, { body }) => {
      const { partner } = await requirePartner(c);
      if (!hasPayoutsStripe())
        throw new HTTPException(503, { message: "Payouts aren't set up on this service" });
      const country = body.country.toUpperCase();
      if (!partner.stripeAccountId && !(await payoutCountries()).includes(country))
        throw new HTTPException(400, {
          message: "Stripe can't pay partners in that country from here",
        });
      let account = partner.stripeAccountId;
      if (!account) {
        const made = await payoutsStripe().accounts.create(
          { type: "express", country, email: partner.email, metadata: { partner_id: partner.id } },
          { idempotencyKey: `affiliates_account_${partner.id}` },
        );
        account = made.id;
        await db
          .update(partners)
          .set({ stripeAccountId: account })
          .where(eq(partners.id, partner.id));
      }
      const back = new URL("/", c.req.url).toString();
      const link = await payoutsStripe().accountLinks.create({
        account,
        type: "account_onboarding",
        refresh_url: back,
        return_url: back,
      });
      return c.redirect(link.url as Href);
    },
  ),
};
