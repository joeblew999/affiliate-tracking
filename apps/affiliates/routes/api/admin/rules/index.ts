import { commissionRules, ruleInput } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, desc } from "void/db";
import { requireAdmin } from "@/access";
import { partnerById } from "@/partners";

// The commission rules (src/commission.ts): all of them, newest first; and adding one.
export const GET = defineHandler(async (c) => {
  requireAdmin(c);
  return {
    rules: await db
      .select()
      .from(commissionRules)
      .orderBy(desc(commissionRules.active), desc(commissionRules.createdAt)),
  };
});

export const POST = defineHandler.withValidator({
  body: ruleInput,
})(async (c, { body }) => {
  requireAdmin(c);
  if (body.partnerId && !(await partnerById(body.partnerId)))
    throw new HTTPException(404, { message: "No such partner" });
  const [rule] = await db.insert(commissionRules).values(body).returning();
  return { rule };
});
