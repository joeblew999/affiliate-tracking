import { partners, payoutRun, payouts } from "@schema";
import { defineHandler } from "void";
import { db, desc, eq } from "void/db";
import { queues } from "void/queues";
import { requireAdmin } from "@/access";
import { partnersToPay } from "@/payouts";

// The latest 200 payouts, with their partner's name (admins).
export const GET = defineHandler(async (c) => {
  requireAdmin(c);
  const rows = await db
    .select({ payout: payouts, partnerName: partners.name, partnerCode: partners.code })
    .from(payouts)
    .innerJoin(partners, eq(partners.id, payouts.partnerId))
    .orderBy(desc(payouts.createdAt))
    .limit(200);
  return {
    payouts: rows.map(({ payout, partnerName, partnerCode }) => ({
      ...payout,
      partnerName,
      partnerCode,
    })),
  };
});

// Run payouts: one queue message per partner owed something (or one partner), paid by
// queues/payouts.ts. Returns at once; the payouts list shows how each went.
export const POST = defineHandler.withValidator({ body: payoutRun })(async (c, { body }) => {
  requireAdmin(c);
  const partnerIds = body.partnerId ? [body.partnerId] : await partnersToPay();
  for (const partnerId of partnerIds) await queues.payouts.send({ partnerId });
  return { queued: partnerIds.length };
});
