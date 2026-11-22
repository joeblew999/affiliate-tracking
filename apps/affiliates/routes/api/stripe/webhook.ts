// This service's own Stripe webhook endpoint. Events: checkout.session.completed and
// checkout.session.async_payment_succeeded (sales), invoice.paid (renewals), charge.refunded and
// charge.dispute.created.
// Anything not signed with STRIPE_WEBHOOK_SECRET gets 400; a failure gets 500 so Stripe retries.
import { defineHandler } from "void";
import { recordRenewal } from "@/renewals";
import { recordCheckoutSale, recordRefund, refundedPaymentIntent } from "@/sales";
import { verifiedEvent } from "@/stripe";

export const POST = defineHandler(async (c) => {
  const event = await verifiedEvent(await c.req.text(), c.req.header("stripe-signature") ?? null);
  if (!event) return c.json({ error: "bad signature" }, 400);
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return c.json({ received: true, sale: await recordCheckoutSale(event.data.object, event) });
    case "invoice.paid":
      return c.json({ received: true, renewal: await recordRenewal(event.data.object, event) });
    case "charge.refunded":
    case "charge.dispute.created": {
      const paymentIntent = await refundedPaymentIntent(event);
      return c.json({
        received: true,
        refunded: paymentIntent ? await recordRefund(paymentIntent) : 0,
      });
    }
    default:
      return c.json({ received: true, ignored: event.type });
  }
});
