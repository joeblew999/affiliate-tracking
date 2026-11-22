import {
  bonus,
  commissionRules,
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
import { and, db, desc, eq, inArray, ne } from "void/db";
import { env } from "void/env";
import { queues } from "void/queues";
import { requireAdmin } from "@/access";
import { ensurePromotionCode } from "@/approval";
import { linksOf } from "@/links";
import { activePartner, partnerById } from "@/partners";
import { partnersToPay } from "@/payouts";
import { stats } from "@/stats";

// The admin page: everything, for the host's admins only. ?partner=<id>: only that partner's sales
// and payouts. ?links=<partner id>: that partner's short links too, for the dialog that shows them.
export const loader = defineHandler(async (c) => {
  const user = c.get("shopUser");
  const shopUrl = env.HOST_SITE_URL;
  if (user?.role !== "admin")
    return {
      allowed: false as const,
      shopUrl,
      // An admin viewing as someone: the way back is in the bar.
      viewingAs: user?.impersonatedBy ? user.name : null,
    };
  const linksFor = c.req.query("links") ?? null;
  const partnerId = c.req.query("partner");
  const origin = new URL(c.req.url).origin;
  const [partnerRows, saleRows, payoutRows, ruleRows, performance] = await Promise.all([
    db.select().from(partners).orderBy(desc(partners.createdAt)),
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
  ]);
  return {
    allowed: true as const,
    shopUrl,
    email: user.email,
    payoutCurrency: env.AFFILIATES_PAYOUT_CURRENCY,
    partners: partnerRows,
    sales: saleRows.map(({ sale, partnerName }) => ({ ...sale, partnerName })),
    payouts: payoutRows.map(({ payout, partnerName }) => ({ ...payout, partnerName })),
    rules: ruleRows,
    stats: performance,
    links: linksFor ? { partnerId: linksFor, links: await linksOf(linksFor, origin) } : null,
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead(() => ({ title: "Admin" }));

// What the admin page does (Void's page actions: each re-runs the loader after).
export const actions = {
  // Approve (active), suspend or reactivate a partner, and their terms. Approving also makes their
  // buyer-discount promotion code, when the service has a Stripe key and a coupon.
  changePartner: defineHandler.withValidator({ body: partnerChange })(async (c, { body }) => {
    requireAdmin(c);
    const { id, ...change } = body;
    const [row] = await db.update(partners).set(change).where(eq(partners.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: "No such partner" });
    if (change.status === "active") await ensurePromotionCode(row);
  }),

  // A decision on a sale not yet paid: approve it, reject it (never approved automatically), or put
  // it back to pending. Not a clawback: what a refund takes back isn't up to a decision.
  changeSale: defineHandler.withValidator({ body: saleChange })(async (c, { body }) => {
    requireAdmin(c);
    const [row] = await db
      .update(sales)
      .set({ status: body.status, approvedAt: body.status === "approved" ? Date.now() : null })
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
    requireAdmin(c);
    if (!(await activePartner(body.partnerId)))
      throw new HTTPException(404, { message: "No such active partner" });
    const currency = env.AFFILIATES_PAYOUT_CURRENCY.toLowerCase();
    const now = Date.now();
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
    requireAdmin(c);
    if (body.partnerId && !(await partnerById(body.partnerId)))
      throw new HTTPException(404, { message: "No such partner" });
    await db.insert(commissionRules).values(body);
  }),

  // A rule retired. Commission already earned under it stays as it is.
  retireRule: defineHandler.withValidator({ body: ruleToRetire })(async (c, { body }) => {
    requireAdmin(c);
    await db.update(commissionRules).set({ active: false }).where(eq(commissionRules.id, body.id));
  }),

  // Payouts: one queue message per partner owed something (or one partner), paid by
  // queues/payouts.ts. Returns at once; the payouts list shows how each went.
  runPayouts: defineHandler.withValidator({ body: payoutRun })(async (c, { body }) => {
    requireAdmin(c);
    const partnerIds = body.partnerId ? [body.partnerId] : await partnersToPay();
    for (const partnerId of partnerIds) await queues.payouts.send({ partnerId });
  }),
};
