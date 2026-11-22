import { partnerChange, partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { requireAdmin } from "@/access";
import { ensurePromotionCode } from "@/approval";

// An admin's change to a partner: approve (active), suspend or reactivate, and their terms (commission
// percent, months of renewal commission, whether every sale waits for an admin). Approving also
// makes their buyer-discount promotion code, when the service has a Stripe key and a coupon.
export const PATCH = defineHandler.withValidator({ body: partnerChange })(async (c, { body }) => {
  requireAdmin(c);
  const [row] = await db
    .update(partners)
    .set(body)
    .where(eq(partners.id, c.req.param("id") ?? ""))
    .returning();
  if (!row) throw new HTTPException(404, { message: "No such partner" });
  if (body.status === "active") await ensurePromotionCode(row);
  return { partner: row };
});
