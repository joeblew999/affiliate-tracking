# Affiliates

An affiliate program you can add to any app on Cloudflare. Partners share links. When a link brings a
sale, the partner earns commission, and they're paid through Stripe.

It's an app of its own (the **service**). Your app (the **host**) keeps its users, sign-in and
Stripe, and calls the service. This repo has both: the service, and an example shop as the host.

Live demo: **https://shop.ubuntusoftware.net** (the shop) and
**https://affiliates.shop.ubuntusoftware.net** (the service).

Built with [Void](https://void.cloud) and [Vite+](https://viteplus.dev): Cloudflare Workers, D1,
Drizzle and Better Auth, with React and [shadcn](https://ui.shadcn.com) for the pages. Rebuilt
from [HolotypePteLtd/affiliate-tracking](https://github.com/HolotypePteLtd/affiliate-tracking).

## Try the demo

The shop sells tickets to 3 online events. Open it and press **Sign in as the admin**. You land
on the service's admin page.

- **Partners tab:** approve, suspend and set commission. To see the program as a partner, open a
  partner's menu and choose **View as**. Press **Back to admin** in the bar at the top to return.
- **Who's who:** Maya is the busiest partner, then Leo, Priya, Tom (every sale of his is reviewed)
  and Ana. Ken is suspended. Sam and Lena are waiting for approval.
- **Signing in as anyone:** every demo account uses the password `demo-password-2026` (public, for
  the demo only): `admin@demo.test`, `maya@demo.test` and so on, and `chris@demo.test` for a
  customer who never applied.

The demo is written out in one file, `apps/affiliates/demo.ts`: its people, its 3 events, and
every ticket sale, refund, bonus, payout and rule of the program, with exact amounts. Times are days before
one instant. Both apps' seeds load it (`vp run demo`) and the tests check against it, so the demo
can't drift from the code. Only the clicks behind the charts are generated, from a fixed seed.

## How it works

- **Sign-in is the host's.** The service has no users or passwords. On each request it asks the
  host's Better Auth who is signed in. Admins are the host's admins. A partner is a host user who
  applied.
- **One domain, two addresses.** The shop is `shop.ubuntusoftware.net` and the service is
  `affiliates.shop.ubuntusoftware.net`. Both set their cookies for the shop's domain, so each app
  sees the other's: the service sees who is signed in, and the shop sees the referral cookie.
- **Referral links belong to the service.** `/r/<partner code or short link>` counts the click,
  sets the referral cookie, and sends the visitor on to the shop.
- **The host calls the service through a Cloudflare service binding,** using the client in
  `apps/affiliates/client.ts`. It calls at sign-up, at checkout, and for every Stripe event. Each
  call is defined once, in `apps/affiliates/src/host-contract.ts`. Calls carry a shared secret,
  `AFFILIATES_HOST_TOKEN`.
- **A ticket is a Stripe Checkout, made by the host.** A signed-in user presses **Buy ticket** on
  an event's page (`apps/shop/pages/events/[id].server.ts`). The shop asks the service what to add
  to the checkout: the partner who brought the buyer, and their discount. It then makes a one-off
  Stripe Checkout with it. The shop's Better Auth Stripe plugin makes each user's Stripe customer
  at sign-up, receives Stripe's webhook, and passes every event on. The service turns them into
  sales, refunds and disputes (and renewals, for a host that sells subscriptions).
- **Stripe handles all the tax, on two Stripe accounts of one business.** Stripe won't allow
  Managed Payments (Stripe as the seller, handling the tax) on an account that pays partners
  through Stripe Connect. So:
  - the **selling account** (the host's) has Managed Payments on, and takes the ticket money;
  - the **payouts account** is the Connect platform. It holds no sales. Before each payout, the
    service adds the money for it from the business's bank (a Stripe top-up), then transfers it
    to the partner's Stripe account.
    Commission is on the price, not the tax Stripe adds. A partner without a Stripe account gets a
    manual payout, for the admin to pay by hand.
- **Slow work goes through queues.** Sign-ups reach the service through a queue. Payouts are queued
  one partner at a time. A daily job approves sales once their hold period is over, and queues any
  payout that didn't finish, so a crash can't leave one half done.

## Where things are

| Folder                   | What's in it                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/affiliates`        | The service.                                                                                  |
| `apps/affiliates/db`     | Its database: one file per table in `schema/`, the migrations, and the demo seed.             |
| `apps/affiliates/pages`  | Its two pages: the partner page (`index`) and the admin page (`admin/`).                      |
| `apps/affiliates/routes` | What the host calls (`api/host/`), the host's sign-in passed through (`api/auth/`), and `r/`. |
| `apps/affiliates/src`    | The program's logic: commission, sales, refunds, payouts, stats.                              |
| `apps/shop`              | The example host: sign-in, Stripe, and its calls to the service.                              |
| `e2e`                    | The tests, run against both apps.                                                             |
| `scripts`                | Local setup, putting the demo on the live site, and screenshots.                              |
| `plans`                  | The plans this was built to, by date.                                                         |

Each app's settings, each with a line saying what it's for, are in its `env.ts`.

## Develop

Once per machine, install Vite+ (`vp`):

```sh
curl -fsSL https://vite.plus | bash
```

Then, in the repo:

```sh
vp env on          # use the Node version in .node-version
vp install
vp run setup       # each app's local settings and database
vp run dev         # the shop on http://localhost:5173, the service on http://localhost:5174
```

`vp run demo` loads the demo into the local databases, replacing what's there. Or sign up on the
local shop: `admin@example.test` becomes an admin, and anyone else can apply as a partner.

All the repo's tasks are in `vite.config.ts`, each with a line saying what it does. Run one with
`vp run <task>`.

Code follows Void's own examples: imports are relative and include the file extension, and types
come from the database schema and the pages' loaders and actions.

## Check and test

- `vp check` formats, lints and type-checks.
- `vp run check:types` type-checks each project as a whole (both apps, the tests, the scripts), as
  Void's own repo does.
- `vp run test:dev` runs the tests in `e2e/dev`. The first time, run `vp run install:browser` to
  get Chromium.
- `vp run test:stripe` runs the tests in `e2e/stripe` against Stripe's test mode. Buyers buy
  tickets on Stripe's own Checkout page with Stripe's test card, and refunds are real ones in
  Stripe. Stripe's webhooks reach the shop through the Stripe CLI's `stripe listen` (the
  `@stripe/cli` package). It needs the test-mode keys of two Stripe test accounts:
  `STRIPE_TEST_SECRET_KEY` (selling, with Managed Payments turned on) and
  `STRIPE_TEST_PAYOUTS_KEY` (payouts). On GitHub, it runs from Actions → **Stripe end-to-end** →
  Run workflow (`.github/workflows/stripe.yml`), with those keys saved as repository secrets.

The tests work as Void's own do (`e2e/apps.ts`). Once per run, both apps are copied, migrated and
seeded with the demo fixtures. Each test file then gets its own copy of that seeded state, on free
ports, so every file starts from exactly the fixtures and nothing it changes reaches another file,
your local data or your `vp run dev`. The service's clock is pinned to the fixtures' instant
(`DEMO_NOW`, by `AFFILIATES_NOW`; `apps/affiliates/src/clock.ts`), so "on hold", "ready to pay" and
"the last 30 days" come out the same on every run, and the tests check exact amounts from
`demo.ts`. People are real browsers on the real pages, and the demo's people sign in through the
shop's Better Auth with the demo password. The shop's calls to the service go through its
own client. Without Stripe, the dev tests send Stripe's events to the shop's webhook, signed as
Stripe signs them. In the Stripe tests, Stripe sends them itself. There are no fakes or mocks.

CI (`.github/workflows/ci.yml`) runs the first three on every push.

## Deploy

Both apps run on Cloudflare account `7384af54e33b8a54ff240371ea368440`. Their addresses are set in
each app's `void.config.ts`.

To deploy an app, in its folder (`apps/affiliates` or `apps/shop`):

```sh
void cloudflare login                # once per machine
void secret sync <file>              # its production settings
void deploy --platform cloudflare
```

Commit each app's `void.lock.json` after deploying: it records the app's database and other
Cloudflare resources.

`vp run demo:production` replaces the live databases with the demo. Use it only on the demo site.

Not set up yet: Stripe on the live site (the `STRIPE_*` settings, and both webhooks in Stripe).

## Add it to your app

The example shop (`apps/shop`) does all of this:

1. **Bind the service** in your `void.config.ts`:
   `cloudflare.services: [{ binding: "AFFILIATES", service: "affiliates" }]`.
2. **Share a secret:** set the same `AFFILIATES_HOST_TOKEN` in both apps
   (`void secret put AFFILIATES_HOST_TOKEN`).
3. **In your `auth.ts`** (see `apps/shop/auth.ts`):
   - add Better Auth's `admin` plugin;
   - add the service's address to `trustedOrigins`;
   - set your sign-in cookie for the parent domain (`AUTH_COOKIE_DOMAIN`);
   - when a user is created, queue their sign-up for the service with the referral cookie
     (`apps/shop/queues/affiliate-signups.ts`);
   - in Better Auth's Stripe plugin, pass every Stripe event on (`apps/shop/src/affiliates.ts`).
   - At your checkout, ask the service what to add to it (`checkout()` in
     `apps/affiliates/client.ts`), as the shop's event page does.
4. **Point the service at your site:** set its `HOST_SITE_URL` to your site, and its
   `AFFILIATES_COOKIE_DOMAIN` to the parent domain. Give it the two Stripe accounts' keys:
   `STRIPE_SALES_KEY` (selling) and `STRIPE_PAYOUTS_KEY` (payouts).
5. **In Stripe:**
   - the selling account's webhook (`https://<your site>/api/auth/stripe/webhook`), for the
     service to count sales, refunds and disputes: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created` and
     `charge.dispute.closed`. If you sell subscriptions, add `invoice.paid` for renewals, and
     Better Auth's plugin needs `customer.subscription.created`, `.updated` and `.deleted`.
   - the payouts account's webhook (`https://<the service>/api/stripe/payouts`), for when money
     added for a payout has arrived: `topup.succeeded`. Its signing secret is the service's
     `STRIPE_PAYOUTS_WEBHOOK_SECRET`.

## License

MIT, as the project it was rebuilt from (`LICENSE`).
