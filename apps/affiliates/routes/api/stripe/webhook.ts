// This service's own Stripe webhook endpoint. Events: checkout.session.completed and
// checkout.session.async_payment_succeeded (sales), invoice.paid (renewals), charge.refunded,
// charge.dispute.created and charge.dispute.closed (what refunds and disputes take: src/refunds.ts).
// Anything not signed with STRIPE_WEBHOOK_SECRET gets 400; a failure gets 500 so Stripe retries.
import { defineHandler } from "void";
import { noteDispute, noteRefund } from "@/refunds";
import { recordRenewal } from "@/renewals";
import { disputedPaymentIntent, recordCheckoutSale } from "@/sales";
import { idOf, verifiedEvent } from "@/stripe";

export const POST = defineHandler(async (c) => {
  const event = await verifiedEvent(await c.req.text(), c.req.header("stripe-signature") ?? null);
  if (!event) return c.json({ error: "bad signature" }, 400);
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return c.json({ received: true, sale: await recordCheckoutSale(event.data.object, event) });
    case "invoice.paid":
      return c.json({ received: true, renewal: await recordRenewal(event.data.object, event) });
    case "charge.refunded": {
      const charge = event.data.object;
      const paymentIntent = idOf(charge.payment_intent);
      return c.json({
        received: true,
        changed: paymentIntent ? await noteRefund(paymentIntent, charge.amount_refunded) : 0,
      });
    }
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const dispute = event.data.object;
      const paymentIntent = await disputedPaymentIntent(dispute);
      // Closed: lost takes the money; won, an inquiry closed, or prevented doesn't.
      const status =
        event.type === "charge.dispute.created"
          ? "open"
          : dispute.status === "lost"
            ? "lost"
            : "won";
      return c.json({
        received: true,
        changed: paymentIntent ? await noteDispute(paymentIntent, dispute.amount, status) : 0,
      });
    }
    default:
      return c.json({ received: true, ignored: event.type });
  }
});
