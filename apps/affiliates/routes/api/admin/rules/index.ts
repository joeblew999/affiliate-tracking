import { commissionRules } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, desc } from "void/db";
import { z } from "zod";
import { requireAdmin } from "@/access";
import { partnerById } from "@/partners";

// The commission rules (src/commission.ts): all of them, newest first; and adding one.
export const GET = defineHandler(async (c) => {
  await requireAdmin(c);
  return {
    rules: await db
      .select()
      .from(commissionRules)
      .orderBy(desc(commissionRules.active), desc(commissionRules.createdAt)),
  };
});

const common = {
  partnerId: z.uuid().nullable().default(null),
  productId: z
    .string()
    .regex(/^(prod|price)_[A-Za-z0-9]+$/, "a Stripe prod_… or price_… id")
    .nullable()
    .default(null),
  minMonthlySales: z.int().min(0).default(0),
  capPerCustomerCents: z.int().min(0).nullable().default(null),
};

export const POST = defineHandler.withValidator({
  body: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("percent"), percent: z.number().min(0).max(100), ...common }),
    z.object({
      kind: z.literal("fixed"),
      fixedCents: z.int().min(0),
      currency: z.string().regex(/^[a-z]{3}$/),
      ...common,
    }),
  ]),
})(async (c, { body }) => {
  await requireAdmin(c);
  if (body.partnerId && !(await partnerById(body.partnerId)))
    throw new HTTPException(404, { message: "No such partner" });
  const [rule] = await db.insert(commissionRules).values(body).returning();
  return { rule };
});
