// Stripe events, passed on by the host's Better Auth Stripe plugin (onEvent in its auth.ts), which
// has already checked Stripe's signature. Sales (checkout.session.completed and
// async_payment_succeeded), renewals (invoice.paid), refunds and disputes (charge.refunded,
// charge.dispute.created and closed: src/refunds.ts). Others are ignored. A failure is an error, so
// the host's queue for Stripe's events tries it again.
import { defineHandler } from "void";
import { StripeEventInput, type StripeEventOutput } from "../../../src/host-contract.ts";
import { noteDispute, noteRefund } from "../../../src/refunds.ts";
import { recordRenewal } from "../../../src/renewals.ts";
import { disputedPaymentIntent, recordCheckoutSale } from "../../../src/sales.ts";
import { idOf } from "../../../src/stripe.ts";

export const POST = defineHandler.withValidator({ body: StripeEventInput })(async (
  _c,
  { body },
) => {
  const event = body;
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
  return { received: true } satisfies StripeEventOutput;
});
