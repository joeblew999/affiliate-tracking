import { defineHandler } from "void";
import { queues } from "void/queues";
import { z } from "zod";
import { requireAdmin } from "@/access";
import { partnersToPay } from "@/payouts";

// Run payouts: one queue message per partner owed something (or one partner), paid by
// queues/payouts.ts. Returns at once; the payouts list shows how each went.
export const POST = defineHandler.withValidator({
  body: z.object({ partnerId: z.uuid().optional() }),
})(async (c, { body }) => {
  requireAdmin(c);
  const partnerIds = body.partnerId ? [body.partnerId] : await partnersToPay();
  for (const partnerId of partnerIds) await queues.payouts.send({ partnerId });
  return { queued: partnerIds.length };
});
