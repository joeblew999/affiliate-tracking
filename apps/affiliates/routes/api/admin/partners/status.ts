import { partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { z } from "zod";
import { requireAdmin } from "@/access";
import { ensurePromotionCode } from "@/approval";

// Approve (active), suspend or reactivate a partner. Approving also makes their buyer-discount
// promotion code, when the service has a Stripe key and a coupon (src/approval.ts).
export const POST = defineHandler.withValidator({
  body: z.object({ id: z.uuid(), status: z.enum(["active", "suspended"]) }),
})(async (c, { body }) => {
  requireAdmin(c);
  const [row] = await db
    .update(partners)
    .set({ status: body.status })
    .where(eq(partners.id, body.id))
    .returning();
  if (!row) throw new HTTPException(404, { message: "No such partner" });
  if (row.status === "active") await ensurePromotionCode(row);
  return { id: row.id, status: row.status };
});
