import { partners } from "@schema";
import { HTTPException } from "hono/http-exception";
import { defineHandler } from "void";
import { db, eq } from "void/db";
import { requirePartner } from "@/access";
import { hasStripe, stripe } from "@/stripe";

// A partner sets up getting paid: a Stripe Connect Express account (made the first time) and the
// link to Stripe's own onboarding, which comes back to the dashboard. Payouts go to that account;
// until then an admin pays the partner by hand.
export const POST = defineHandler(async (c) => {
  const { partner } = await requirePartner(c);
  if (!hasStripe())
    throw new HTTPException(503, { message: "Payments aren't set up on this service" });
  let account = partner.stripeAccountId;
  if (!account) {
    const made = await stripe().accounts.create(
      { type: "express", email: partner.email, metadata: { partner_id: partner.id } },
      { idempotencyKey: `affiliates_account_${partner.id}` },
    );
    account = made.id;
    await db.update(partners).set({ stripeAccountId: account }).where(eq(partners.id, partner.id));
  }
  const back = new URL("/", c.req.url).toString();
  const link = await stripe().accountLinks.create({
    account,
    type: "account_onboarding",
    refresh_url: back,
    return_url: back,
  });
  return { url: link.url };
});
