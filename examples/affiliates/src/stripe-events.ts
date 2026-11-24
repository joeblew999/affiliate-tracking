// Stripe's events, which the host publishes as its Better Auth Stripe plugin receives them (it has
// already checked Stripe's signature), and this service follows (src/hub.ts). Sales
// (checkout.session.completed and async_payment_succeeded), renewals (invoice.paid), refunds and
// disputes (charge.refunded, charge.dispute.created and closed: src/refunds.ts). Others are
// ignored. Each Stripe event is recorded once, so one read again changes nothing.
import type Stripe from "stripe";
import { noteDispute, noteRefund } from "./refunds.ts";
import { recordRenewal } from "./renewals.ts";
import { disputedPaymentIntent, recordCheckoutSale } from "./sales.ts";
import { idOf } from "./stripe.ts";

export async function stripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await recordCheckoutSale(event.data.object, event);
      break;
    case "invoice.paid":
      await recordRenewal(event.data.object, event);
      break;
    case "charge.refunded": {
      const charge = event.data.object;
      const paymentIntent = idOf(charge.payment_intent);
      if (paymentIntent) await noteRefund(paymentIntent, charge.amount_refunded);
      break;
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
      if (paymentIntent) await noteDispute(paymentIntent, dispute.amount, status);
      break;
    }
  }
}
