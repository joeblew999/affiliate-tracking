// An event's page: what, when and where, and its tickets. A ticket is a one-off Stripe Checkout,
// made here: Better Auth's Stripe plugin only makes subscription checkouts. It has Managed
// Payments on, so Stripe is the seller and handles the tax. It carries what the affiliate service
// says to add (its checkout call): the partner who brought the buyer, and their discount. Stripe's
// checkout.session.completed then reaches the service through the shop's webhook (auth.ts), which
// records the sale.
import type Stripe from "stripe";
import { HTTPException } from "hono/http-exception";
import { defineHandler, defineHead, type CloudContext, type InferProps } from "void";
import { getUser } from "void/auth";
import { env } from "void/env";
import type { Href, PageParams } from "void/routes";
import { referralFrom } from "affiliates/client";
import { affiliatesService } from "../../src/affiliates.ts";
import { eventOf, price, when } from "../../src/events.ts";
import { stripeClient } from "../../src/stripe.ts";

/** The checkout metadata key that says which event a ticket is for. */
const EVENT_KEY = "shop_event";

/**
 * Stripe's tax category for an event's product, which Managed Payments needs: "General -
 * Electronically Supplied Services" (docs.stripe.com/payments/managed-payments/eligibility, read
 * 2026-11-23). Whether live online events qualify is Stripe's to confirm.
 */
const TAX_CODE = "txcd_10000000";

const stripe = () => stripeClient(env.STRIPE_SECRET_KEY ?? "");

function eventFor(c: CloudContext) {
  const { id } = c.req.param() as PageParams<"/events/[id]">;
  const event = eventOf(id);
  if (!event) throw new HTTPException(404, { message: "There's no such event" });
  return event;
}

/** Whether this Stripe customer has paid for a ticket to the event. */
async function hasTicket(customer: string, eventId: string): Promise<boolean> {
  for await (const session of stripe().checkout.sessions.list({ customer, status: "complete" }))
    if (session.metadata?.[EVENT_KEY] === eventId && session.payment_status === "paid") return true;
  return false;
}

/** The event's Stripe product, made the first time a ticket is sold. */
async function ensureProduct(event: NonNullable<ReturnType<typeof eventOf>>): Promise<void> {
  try {
    await stripe().products.retrieve(event.productId);
  } catch (err) {
    if ((err as Stripe.errors.StripeError).code !== "resource_missing") throw err;
    await stripe().products.create(
      {
        id: event.productId,
        name: event.name,
        description: event.description,
        tax_code: TAX_CODE,
      },
      { idempotencyKey: `shop_product_${event.productId}` },
    );
  }
}

export const loader = defineHandler(async (c) => {
  const event = eventFor(c);
  const user = getUser();
  const payments = Boolean(env.STRIPE_SECRET_KEY);
  const customer = user?.stripeCustomerId ?? null;
  return {
    event: {
      id: event.id,
      name: event.name,
      description: event.description,
      when: when(event),
      location: event.location,
      price: price(event.cents),
    },
    signedIn: Boolean(user),
    payments,
    hasTicket: payments && customer ? await hasTicket(customer, event.id) : false,
  };
});
export type Props = InferProps<typeof loader>;

export const head = defineHead<Props>((_c, { event }) => ({ title: event.name }));

export const actions = {
  // A ticket, on Stripe's Checkout. Back here after, paid or not.
  buy: defineHandler(async (c) => {
    const user = getUser();
    if (!user) throw new HTTPException(401, { message: "Sign in to buy a ticket" });
    if (!env.STRIPE_SECRET_KEY)
      throw new HTTPException(503, { message: "This shop isn't taking payments" });
    const event = eventFor(c);
    await ensureProduct(event);
    const attribution = await affiliatesService().checkout({
      userId: user.id,
      ref: referralFrom(c.req.header("cookie")),
      promoCode: null,
      ip: c.req.header("cf-connecting-ip") ?? null,
    });
    const here = new URL(c.req.url);
    here.search = "";
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      managed_payments: { enabled: true },
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email }),
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "usd", unit_amount: event.cents, product: event.productId },
        },
      ],
      metadata: { ...attribution.metadata, [EVENT_KEY]: event.id },
      ...(attribution.promotionCode
        ? { discounts: [{ promotion_code: attribution.promotionCode }] }
        : {}),
      success_url: here.toString(),
      cancel_url: here.toString(),
    });
    if (!session.url) throw new HTTPException(502, { message: "Stripe gave no checkout page" });
    return c.redirect(session.url as Href, 303);
  }),
};
