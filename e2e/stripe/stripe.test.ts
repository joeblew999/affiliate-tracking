// What only real Stripe can show (test mode): a partner's promotion code made on approval and used
// at checkout; a sale paid in another currency paid out at the rate Stripe settled it at; a real
// refund. Stripe's webhooks can't reach a local dev server, so the tests send the service the same
// events, signed, about the real Stripe objects they made.
import Stripe from "stripe";
import { describe, expect, inject, test } from "vite-plus/test";
import {
  activePartner,
  eventually,
  shop,
  partnerMe,
  salesOf,
  act,
  payoutsOf,
  signInAdmin,
  stripeEvent,
} from "../dev/helpers";

const skip = inject("stripeSkip");

describe.skipIf(skip)(`Stripe end-to-end${skip ? ` (${skip})` : ""}`, () => {
  const stripe = () => new Stripe(inject("stripeKey"));

  /** A real card payment in Stripe test mode, settled. */
  async function pay(cents: number, currency: string): Promise<Stripe.PaymentIntent> {
    const intent = await stripe().paymentIntents.create({
      amount: cents,
      currency,
      payment_method: "pm_card_visa",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      confirm: true,
      expand: ["latest_charge.balance_transaction"],
    });
    expect(intent.status).toBe("succeeded");
    return intent;
  }

  /** The service hears about a paid checkout for the real payment (as Stripe's webhook would say). */
  async function sell(partnerId: string, intent: Stripe.PaymentIntent) {
    const res = await stripeEvent("checkout.session.completed", {
      id: `cs_test_${crypto.randomUUID().replaceAll("-", "")}`,
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      amount_total: intent.amount,
      currency: intent.currency,
      payment_intent: intent.id,
      customer: null,
      subscription: null,
      invoice: null,
      customer_details: { email: `${crypto.randomUUID()}@buyer.test`, address: null },
      discounts: [],
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      metadata: { affiliate_partner_id: partnerId },
    });
    expect(await res.json()).toMatchObject({ sale: { recorded: true } });
  }

  test("approving a partner makes their promotion code in Stripe; typing it at checkout makes the sale theirs", async () => {
    const nick = await activePartner("Nick Stripe");
    const me = await partnerMe(nick.cookie);
    const promo = me.promoCode;
    expect(promo).toBe(me.code.toUpperCase());
    const found = await stripe().promotionCodes.list({ code: promo ?? "", limit: 1 });
    expect(found.data[0]?.metadata).toMatchObject({ partner_id: nick.partnerId });

    const checkout = await shop().checkout({
      userId: null,
      ref: null,
      promoCode: promo?.toLowerCase() ?? null,
      ip: null,
    });
    expect(checkout).toEqual({
      metadata: expect.objectContaining({
        affiliate_partner_id: nick.partnerId,
        affiliate_source: "promo_code",
      }),
      promotionCode: found.data[0]?.id,
    });
  });

  test("a sale in another currency is paid out at the rate Stripe settled it at", async () => {
    const nick = await activePartner("Nick FX");
    const admin = await signInAdmin();
    const intent = await pay(5000, inject("saleCurrency"));
    const charge = intent.latest_charge;
    const txn = charge && typeof charge === "object" ? charge.balance_transaction : null;
    if (!charge || typeof charge !== "object" || !txn || typeof txn !== "object")
      throw new Error("no settled charge");
    expect(txn.currency).toBe(inject("payoutCurrency"));

    await sell(nick.partnerId, intent);
    const [sale] = await salesOf(nick.partnerId);
    await act(admin.cookie, "/admin?changeSale", { id: sale?.id ?? "", status: "approved" });
    await act(admin.cookie, "/admin?runPayouts", { partnerId: nick.partnerId });

    const expected = Math.round((1000 * txn.amount) / charge.amount); // 20% of 5000, converted
    await eventually(async () => {
      expect(await payoutsOf(nick.partnerId)).toEqual([
        expect.objectContaining({
          status: "manual",
          amountCents: expected,
          currency: inject("payoutCurrency"),
        }),
      ]);
    });
  });

  test("a real refund marks the sale refunded", async () => {
    const nick = await activePartner("Nick Refund");
    const intent = await pay(3000, inject("payoutCurrency"));
    await sell(nick.partnerId, intent);
    await stripe().refunds.create({ payment_intent: intent.id });
    const charge = await stripe().charges.retrieve(
      typeof intent.latest_charge === "string"
        ? intent.latest_charge
        : (intent.latest_charge?.id ?? ""),
    );
    await stripeEvent("charge.refunded", { ...charge });
    expect((await salesOf(nick.partnerId)).map((s) => s.status)).toEqual(["refunded"]);
  });
});
