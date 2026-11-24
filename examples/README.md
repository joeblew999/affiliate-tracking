# The example: affiliates for a shop, choreographed over Durable Streams

An affiliate program you can add to any app on Cloudflare. Partners share links. When a link brings a
sale, the partner earns commission, and they're paid through Stripe.

It's an app of its own (the **service**). Your app (the **host**) keeps its users, sign-in and
Stripe, and calls the service. This repo has both: the service, and an example shop as the host.
A third worker, the **hub**, holds the streams they both write to and follow.

Not deployed at the moment (its earlier deployment was removed on 2026-11-24, before the hub
moved to D1): run it locally (Develop, below).

Built with [Void](https://void.cloud) and [Vite+](https://viteplus.dev): Cloudflare Workers, D1,
Drizzle and Better Auth, with React and [shadcn](https://ui.shadcn.com) for the pages. Rebuilt
from [HolotypePteLtd/affiliate-tracking](https://github.com/HolotypePteLtd/affiliate-tracking).

## Try the demo

The shop sells tickets to 3 online events. Open it and press **Sign in as the admin**. You land
on the service's admin page.

- **Events tab:** each event's tickets sold, the money in, what the venue, the organiser and the
  affiliates were paid, the profit, and how many more tickets it takes to break even. Book a new
  event here, and add organisers and venues.
- **Partners tab:** approve, suspend and set commission. To see the program as a partner, open a
  partner's menu and choose **View as**. Press **Back to admin** in the bar at the top to return.
- **Who's who:** Maya is the busiest partner, then Leo, Priya, Tom (every sale of his is reviewed)
  and Ana. Ken is suspended. Sam and Lena are waiting for approval. Olivia and Raj are organisers.
  Nina, Hugo and Mei are the contacts the 3 venues are paid through.
- **Signing in as anyone:** every demo account uses the password `demo-password-2026` (public, for
  the demo only): `admin@demo.test`, `maya@demo.test` and so on, and `chris@demo.test` for a
  customer who never applied.

The demo is written out in one file, `examples/affiliates/demo.ts`: its people, its 3 venues and 3 events, and
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
  `examples/affiliates/client.ts`. It calls at sign-up, at checkout, and for every Stripe event. Each
  call is defined once, in `examples/affiliates/src/host-contract.ts`. Calls carry a shared secret,
  `AFFILIATES_HOST_TOKEN`.
- **A ticket is a Stripe Checkout, made by the host.** A signed-in user presses **Buy ticket** on
  an event's page (`examples/shop/pages/events/[id].server.ts`). The shop asks the service what to add
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
- **Events, venues and organisers.** An admin books an event at a venue, with an organiser. The
  venue is paid its price at once, through Stripe like any payout. Once it's paid, the event goes on
  sale, and the shop emails every user who hasn't unsubscribed. Each ticket pays the event's
  organiser their percent of the price, and the affiliate who brought the buyer (if any) their
  commission. An organiser or a venue's contact can't also be an affiliate.
- **Slow work goes through queues.** Payouts are queued one partner at a time. The on-sale emails go out in batches, each batch queuing the next. A daily
  job approves sales once their hold period is over, and queues any payout that didn't finish, so a
  crash can't leave one half done.
- **The control plane: what the system is doing, on every page.** Every page of both apps has an
  **Activity** pane. It shows the actions you started (a button pressed, a sign-up) and each step
  they caused, in either app: the request, each queued message, each email. Each action is shown
  running, done, or failed in red with the step and its error. Admins see everyone's actions,
  Stripe's webhooks and the daily job too.
  - The steps report themselves. Each app's code uses the wrappers in `examples/activity` (its
    `queues`, `defineQueue`, `defineScheduled`, `sendEmail`, and one middleware) rather than
    Void's own, so nothing in the apps announces anything by hand.
  - The control plane itself is a stream of events per viewer, in the hub (below). A page starts
    with its viewer's actions so far, then stays connected for each new event, at its own app's
    `/streams/<viewer>`. That app knows who is signed in, decides who may read which
    (`mayRead` in `examples/activity`), and passes the read on to the hub.
  - When an action finishes, the page reloads its data, so what it shows is what's saved.
- **The hub** is this repo's main project, at its root: Durable Streams on Cloudflare, with
  subscriptions, on D1 read replicas. See the [README](../README.md) there. The example's two
  workers write to its streams and follow them; neither calls the other for any of it.
- **A new user is the first thing done this way.** The shop doesn't call the service at sign-up.
  It publishes "signed-up" to a stream (`examples/shop/src/published.ts`). The service follows that
  stream (`examples/affiliates/src/followed.ts`), is woken (`examples/affiliates/routes/api/hub/wake.ts`),
  reads on, records the referral, and acknowledges (`examples/affiliates/queues/wakes.ts`). In the
  Activity pane it's still one action, "Sign up", with the service's part as a step of it.
  - The plan, and what's still to do: `plans/2026-11-24-02-hub.md`.

## Where things are

| Folder                       | What's in it                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `examples/affiliates`        | The service.                                                                                   |
| `examples/affiliates/db`     | Its database: one file per table in `schema/`, the migrations, and the demo seed.              |
| `examples/affiliates/pages`  | Its two pages: the partner page (`index`) and the admin page (`admin/`).                       |
| `examples/affiliates/routes` | What the host calls (`api/host/`), the host's sign-in passed through (`api/auth/`), and `r/`.  |
| `examples/affiliates/src`    | The program's logic: commission, sales, refunds, payouts, stats.                               |
| `examples/shop`              | The example host: sign-in, Stripe, and its calls to the service.                               |
| `examples/activity`          | The control plane: the Activity pane, and the wrappers that make the apps' work report itself. |
| `examples/e2e`               | The tests, run against the three apps (the hub, the service and the shop).                     |
| `examples/scripts`           | Local setup, putting the demo on the live site, and screenshots.                               |
| the repo's root              | The hub (README there).                                                                        |

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
vp run dev:example # the shop on http://localhost:5173, the service on http://localhost:5174
                   # (and the hub on 5175, which nobody opens)
```

`vp run demo` loads the demo into the local databases, replacing what's there. Or sign up on the
local shop: `admin@example.test` becomes an admin, and anyone else can apply as a partner.

All the repo's tasks are in `vite.config.ts`, each with a line saying what it does. Run one with
`vp run <task>`.

Code follows Void's own examples: imports are relative and include the file extension, and types
come from the database schema and the pages' loaders and actions.

## Check and test

The example is a work in progress, and its tests are its own: the hub is checked by the
protocol's conformance suite (the repo's README), not by these.

- `vp check` formats, lints and type-checks.
- `vp run check:types` type-checks each project as a whole (both apps, the tests, the scripts), as
  Void's own repo does.
- `vp run test:dev` runs the tests in `examples/e2e/dev`. The first time, run `vp run install:browser` to
  get Chromium.
- `vp run test:stripe` runs the tests in `examples/e2e/stripe` against Stripe's test mode. Buyers buy
  tickets on Stripe's own Checkout page with Stripe's test card, and refunds are real ones in
  Stripe. Stripe's webhooks reach the shop through the Stripe CLI's `stripe listen` (the
  `@stripe/cli` package). It needs the test-mode keys of two Stripe test accounts:
  `STRIPE_TEST_SECRET_KEY` (selling, with Managed Payments turned on) and
  `STRIPE_TEST_PAYOUTS_KEY` (payouts). On GitHub, it runs from Actions → **Stripe end-to-end** →
  Run workflow (`.github/workflows/stripe.yml`), with those keys saved as repository secrets.

The tests run against the three apps, started once for the whole run (`examples/e2e/apps.ts`), from a copy of
them with the demo fixtures, on free ports, so nothing reaches your local data or your
`vp run dev`. The copy is kept in `.e2e/` between runs and brought up to date with your source
at the start of each, so only the first run pays for copying, migrating and seeding. Before each
test file the demo is put back as it was, by the admin pressing
**Reset demo** (a demo site's button: `examples/affiliates/src/demo-reset.ts`), so every file starts
from exactly the fixtures without the apps starting again. The service's clock is pinned to the
fixtures' instant (`DEMO_NOW`, by `AFFILIATES_NOW`; `examples/affiliates/src/clock.ts`), so "on
hold", "ready to pay" and "the last 30 days" come out the same on every run, and the tests check
exact amounts from `demo.ts`. The demo's people sign in through the shop's Better Auth with the
demo password. The shop's calls to the service go through its own client. Without Stripe, the dev
tests send Stripe's events to the shop's webhook, signed as Stripe signs them. In the Stripe
tests, Stripe sends them itself. There are no fakes or mocks.

Most tests use no browser. A test is one more reader of the streams (`examples/e2e/dev/bus.ts`): it sends
what a page's button sends, or a Stripe event, waits on the stream in the hub for that action to
read done, and reads what the action did from the state stream (Durable State: the sale, the
payout, the partner, as saved; `examples/affiliates/src/outcomes.ts`). A seeded row nothing wrote
is as the fixtures have it. Nothing waits and looks again, and an action that fails ends the test
at once, with its steps and the error.

A browser is for what a page shows: `pages`, `activity`, `streams` and `demo` in `examples/e2e/dev`, and
the Stripe tests, which buy on Stripe's own page. There a test watches the Activity pane, as a
person would: it presses the button, waits for that action to read done and the page to have
reloaded its data (`activity()` in `examples/e2e/dev/helpers.ts`), and reads the page it's already on. A
server error on any page ends the test. A failed test also shows what the apps printed.

Files run one after another, not side by side: the program is one program, and a payout run or
the daily job touches everyone in it. A deployment is one program, so that's how it stays.

CI (`.github/workflows/ci.yml`) runs the checks, the hub's conformance tests and `test:dev` on
every push.

## Deploy

Nothing of the example is deployed now. Each app's address is set in its `void.config.ts`
(`shop.ubuntusoftware.net` and `affiliates.shop.ubuntusoftware.net`: put your own there); the
hub gets a `workers.dev` address of its own.

To deploy an app, in its folder (the hub, at the repo's root, first, then `examples/affiliates`
or `examples/shop`):

```sh
void cloudflare login                # once per machine
void secret sync <file>              # its production settings
void deploy --platform cloudflare
```

Commit each app's `void.lock.json` after deploying: it records the app's database and other
Cloudflare resources. (The example's apps have none in the repo now: a first deploy writes them.)

`vp run demo:production` replaces the live databases with the demo. Use it only on the demo site.
On a demo site, set the service's `AFFILIATES_DEMO` (to anything): its admins then get a **Reset
demo** button that does the same from the admin page.

The shop's emails are from the address in its `void.config.ts` (`email.from`). Deploying sets up
sending from that domain on the Cloudflare account.

Not set up yet: Stripe on the live site (the `STRIPE_*` settings, and both webhooks in Stripe).

## Add it to your app

The example shop (`examples/shop`) does all of this:

1. **Bind the service** in your `void.config.ts`:
   `cloudflare.services: [{ binding: "AFFILIATES", service: "affiliates" }]`.
2. **Share a secret:** set the same `AFFILIATES_HOST_TOKEN` in both apps
   (`void secret put AFFILIATES_HOST_TOKEN`).
3. **In your `auth.ts`** (see `examples/shop/auth.ts`):
   - add Better Auth's `admin` plugin;
   - add the service's address to `trustedOrigins`;
   - set your sign-in cookie for the parent domain (`AUTH_COOKIE_DOMAIN`);
   - when a user is created, publish it with the referral cookie (`examples/shop/src/published.ts`);
     the service follows new users and is woken for each;
   - in Better Auth's Stripe plugin, publish every Stripe event (`examples/shop/src/published.ts`);
     the service follows them. It goes through a queue, so Stripe gets its answer at once.
   - At your checkout, ask the service what to add to it (`checkout()` in
     `examples/affiliates/client.ts`), as the shop's event page does.
4. **Give your app the control plane** (see `examples/shop`): deploy the hub (the repo's root) and bind
   it (`{ binding: "HUB", service: "hub" }`), with the same `HUB_TOKEN` in the hub, the service
   and your app. Add `activity` (`examples/activity`) and `cloudflare-durable-streams` as dependencies; the hub's client
   and what you publish (`src/hub.ts`); what you follow (`src/followed.ts`), woken at
   `routes/api/hub/wake.ts` and dealt with in `queues/wakes.ts`; the control plane's setup and wrappers (`src/activity.ts`), used in place of
   Void's `queues`, `defineQueue` and `sendEmail`; its middleware (`middleware/00.activity.ts`);
   where your pages read their stream (`routes/streams/[...path].ts`); and the `ActivityPane` in
   your layout.
5. **Point the service at your site:** set its `HOST_SITE_URL` to your site, its
   `AFFILIATES_SITE_URL` to its own address (where the hub wakes it), and its
   `AFFILIATES_COOKIE_DOMAIN` to the parent domain. Give it the two Stripe accounts' keys:
   `STRIPE_SALES_KEY` (selling) and `STRIPE_PAYOUTS_KEY` (payouts).
6. **In Stripe:**
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
