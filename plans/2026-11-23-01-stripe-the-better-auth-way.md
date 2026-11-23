# 2026-11-23-01-stripe-the-better-auth-way.md

What reading Better Auth's Stripe plugin in full (better-auth.com/docs/plugins/stripe, and the
installed `@better-auth/stripe` 1.7.27 source, checked 2026-11-23) shows is missing or wrong here,
and the one change that fixes it.

## What's wrong now

1. **Nobody can buy anything in the shop.** `apps/shop/auth.ts` sets up the plugin with a "pro"
   plan, but no page calls the plugin's `upgrade`. So the shop's checkout, and the affiliate
   attribution it carries (`getCheckoutSessionParams`), have never run for real. Every sale so
   far is a fixture or a test event.
2. **The README's webhook events leave out the plugin's own.** Step 5 of "Add it to your app"
   lists only the events the affiliate service needs. The plugin itself needs
   `customer.subscription.created`, `customer.subscription.updated` and
   `customer.subscription.deleted` to keep a subscription's status right. Without them, a
   cancelled subscription stays active in the shop.
3. **The test events claim an API version Stripe doesn't send.** `stripeEvent` in
   `e2e/dev/helpers.ts` hard-codes `api_version: "2026-10-28"`. The installed `stripe` 23.2.0 is on
   `2026-11-18.endive`. The fix is to use `Stripe.API_VERSION`, from the SDK itself.
4. **The Stripe tests make up their webhooks.** `e2e/stripe/stripe.test.ts` creates real Stripe
   objects, then signs and sends its own events about them. Stripe's documented way to test
   locally is the Stripe CLI: `stripe listen --forward-to <site>/api/auth/stripe/webhook`. It
   delivers Stripe's real events, signed by Stripe.

5. **Found while building it: a subscription's sale had no payment.** A subscription's Checkout
   Session has no `payment_intent`; its payment is its first invoice's. The service took a sale's
   payment intent from the session only. So for the shop's real sales, all subscriptions, refunds,
   disputes and other-currency payouts would never have found the sale. The service
   (`src/sales.ts`) now takes it from the invoice too (`invoicePaymentIntent`, `src/stripe.ts`,
   shared with renewals).

## The change

### Shop

- **A "Subscribe to Pro" button** for a signed-in user: a page action calling
  `auth.api.upgradeSubscription` with the session's headers (`plan: "pro"`, success and cancel
  URLs, `disableRedirect: true`), then a redirect to Stripe Checkout. The partner a buyer came
  through rides along, as it already does, through `getCheckoutSessionParams`.
- **The plan's status** from `auth.api.listActiveSubscriptions`. No billing portal: managing a
  subscription is the shop's business, not the affiliate program's.
- **Without a Stripe key,** the button isn't shown, and the page says the shop has no payments.
  That's the dev tests' case.

### README

- Step 5 lists the plugin's three subscription events too, saying which side needs each.

### Tests

- `stripeEvent` uses `Stripe.API_VERSION`.
- **`test:stripe` becomes real end to end, with no events of our own:**
  - The official Stripe CLI (`@stripe/cli` on npm, from github.com/stripe/stripe-cli) is a root
    devDependency.
  - Setup makes a test-mode product and price for `STRIPE_PRO_PRICE_ID`.
  - The test file runs `stripe listen --api-key <test key> --forward-to <its shop>`. The webhook
    signing secret comes from `stripe listen --print-secret`.
  - **A sale:** a buyer follows Tom's link, signs up, presses Subscribe, and pays on Stripe's
    own Checkout page with card 4242. Stripe's real `checkout.session.completed` makes the sale
    Tom's, with his commission from `demo.ts`. Tom has nothing else ready to pay, so the payout
    that follows is that one sale's.
  - **A promotion code:** approving Sam makes his code. A buyer through Sam's link gets his
    discount at Checkout.
  - **A renewal:** each buyer's Stripe customer, made by the plugin at sign-up, is put on a Stripe
    test clock of its own (`testClocks.create` with `customer`, Stripe's 2026-05-27 dahlia API).
    Advancing the clock a month makes Stripe renew the subscription and send a real
    `invoice.paid`, and the renewal is the partner's. Deleting the clocks afterwards deletes the
    customers. No test-only code goes in the shop's `auth.ts`.
  - **A refund:** `refunds.create` on the renewal's payment. Stripe's real `charge.refunded`
    refunds that sale.
  - **Another currency:** Pro's price is in a currency other than the account's, so the payout is
    at the rate Stripe settled the sale at.
- The dev tests keep sending signed events, because they run without Stripe, as now.

## Who can run what

- **Here, in a Claude session:** everything except `test:stripe`. That needs a test-mode key, and
  keys don't go into Claude.
- **On the Mac:** run `vp run test:stripe` with `STRIPE_TEST_SECRET_KEY` set.
- **On GitHub:** run Actions → **Stripe end-to-end**, which already has the key as a secret.

The change is done when the dev tests pass here, and a Stripe run passes on the Mac or on GitHub.
