import { bonusInput, sales } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db } from "void/db";
import { env } from "void/env";
import { requireAdmin } from "@/access";
import { activePartner } from "@/partners";

// A one-off bonus for a partner: approved straight away and paid with their next payout. In the
// payout currency: a bonus has no Stripe payment to convert from.
export const POST = defineHandler.withValidator({
  body: bonusInput,
})(async (c, { body }) => {
  requireAdmin(c);
  if (!(await activePartner(body.partnerId)))
    throw new HTTPException(404, { message: "No such active partner" });
  const currency = env.AFFILIATES_PAYOUT_CURRENCY.toLowerCase();
  const now = Date.now();
  const [row] = await db
    .insert(sales)
    .values({
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
    })
    .returning({ id: sales.id });
  if (!row) throw new Error("bonus not recorded");
  return { id: row.id, currency };
});
