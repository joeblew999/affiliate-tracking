// The payouts account's Stripe webhook (STRIPE_PAYOUTS_WEBHOOK_SECRET signs it): topup.succeeded,
// the money added for a payout has arrived, so that partner's payout is queued again and its
// transfer goes (src/payouts.ts). Other events are ignored. The daily job queues waiting payouts
// too, in case this one's missed.
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { defineHandler } from "void";
import { env } from "void/env";
import { queuePayouts } from "../../../src/payouts.ts";

export const POST = defineHandler(async (c) => {
  const secret = env.STRIPE_PAYOUTS_WEBHOOK_SECRET;
  if (!secret) throw new HTTPException(503, { message: "STRIPE_PAYOUTS_WEBHOOK_SECRET isn't set" });
  const payload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(
      payload,
      c.req.header("stripe-signature") ?? "",
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    throw new HTTPException(400, { message: "Not signed by Stripe for this webhook" });
  }
  if (event.type === "topup.succeeded") {
    const partnerId = event.data.object.metadata?.partner_id;
    if (partnerId) await queuePayouts([partnerId]);
  }
  return c.json({ received: true });
});
