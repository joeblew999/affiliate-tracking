# Affiliates

An affiliate program for any app on Cloudflare: partners share links, the sales those links bring
earn them commission, and they're paid through Stripe. It is its own app, a backend with its own
pages, that another app (the **host**) plugs into. The host keeps its users and sign-in; this app
keeps the affiliate program.

Built with [Void](https://void.cloud) (Vite, Cloudflare Workers, D1, Drizzle, Better Auth) and
[Vite+](https://viteplus.dev). Pages are React with [shadcn](https://ui.shadcn.com). Rebuilt from
[HolotypePteLtd/affiliate-tracking](https://github.com/HolotypePteLtd/affiliate-tracking) (MIT); the
plan is `plans/2026-11-22-01-void-service.md`.

## What's here

- `apps/affiliates`: the affiliate service. Partners apply, admins approve; referral links and short
  links; clicks, signups and sales; commission rules and bonuses; renewals; the hold period; payouts
  through Stripe Connect; the partner's and the admin's pages.
- `apps/shop`: an example host. Void's Better Auth with its admin and Stripe plugins, wired to the
  service. It shows what a real host does, and the tests run against it.
- `e2e/`: the tests, against both apps running for real.
- `scripts/setup.ts`: each app's local `.env`.

## How it fits together

- **Sign-in is the host's.** Each app runs its own Better Auth (Void's). The host is an OAuth
  provider (Better Auth's `oauthProvider` plugin) and the service is its one client, trusted, so
  there's no consent screen: "Sign in with the shop" on the service (Better Auth's `genericOAuth`)
  goes to the host's sign-in and comes back signed in. The service has no passwords of its own.
  The host's admins are admins on the service (the `role` claim in the host's ID token, copied on
  every sign-in, `apps/affiliates/auth.ts`), and "View as" is the service's own Better Auth admin
  plugin. A partner is a host user who applied.
- **Two addresses, one domain.** The host at e.g. `shop.example.com`, the service at
  `affiliates.example.com`. The service's referral cookie is set for the parent domain, so the host
  receives it.
- **The host calls the service like a function,** through the service binding and
  `apps/affiliates/client.ts`. Each call's input and output are defined once, in
  `apps/affiliates/src/host-contract.ts`; the service's routes check against it and the client takes
  its types from it. Host calls carry a shared secret (`AFFILIATES_HOST_TOKEN`), since the service
  also has a public address.
- **Referral links are the service's:** `affiliates.example.com/r/<partner code or short link>`
  counts the click, sets the referral cookie, and sends the visitor on to the host's site.
- **Stripe is the host's.** The host keeps customers and subscriptions, and the Stripe webhook
  (Better Auth's Stripe plugin). Its `onEvent` hands every event to the service (`stripeEvent` in
  the client), which records sales, renewals, refunds and disputes, and pays partners with Stripe
  Connect transfers.
- **Long-running work goes through queues:** sign-ups reach the service through the host's queue,
  and payouts run one partner per queue message. A daily cron approves sales past the hold period
  and queues again any payout left unfinished, so a crash never leaves one half done.

## Using it from your app

What the example shop does, in `apps/shop`:

1. Bind the service, in your `void.config.ts`: `cloudflare.services: [{ binding: "AFFILIATES",
   service: "affiliates" }]`.
2. Give both apps the same `AFFILIATES_HOST_TOKEN` (`void secret put AFFILIATES_HOST_TOKEN` in each).
3. In your `auth.ts` (see `apps/shop/auth.ts`):
   - the `admin` and `jwt` plugins, and `oauthProvider` with the service as a trusted client
     (`cachedTrustedClients`) and the user's role as a claim (`customIdTokenClaims`);
   - a new-user hook that queues the sign-up for the service with the referral cookie's value
     (`referralFrom` in the client; `apps/shop/queues/affiliate-signups.ts`);
   - with Better Auth's Stripe plugin, `getCheckoutSessionParams` asking the service's `checkout`
     for the metadata and discount to add, and `onEvent` passing each event to `stripeEvent`
     (`apps/shop/src/affiliates.ts`).
4. Register the service as your OAuth client: `scripts/oauth-client.ts` (locally `vp run setup`
   does it; for production, `AFFILIATES_OAUTH_SECRET=<the service's secret> vpx
   scripts/oauth-client.ts --remote --service https://affiliates.example.com`).
5. Set the service's `HOST_SITE_URL` to your site, and its `AFFILIATES_COOKIE_DOMAIN` to the
   parent domain.
6. In Stripe, your Better Auth Stripe webhook (`https://shop.example.com/api/auth/stripe/webhook`)
   needs `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` too.

The service's settings, each with a line saying what it does, are in `apps/affiliates/env.ts`; the
shop's in `apps/shop/env.ts`.

## Develop

```sh
curl -fsSL https://vite.plus | bash   # Vite+'s vp, once per machine; open a new terminal after it
vp env on                             # the Node in .node-version for everything
vp install                            # the packages
vp run setup                          # each app's local .env, and the service's local database
vp run dev                            # the shop on http://localhost:5173, the service on :5174
```

`vp run demo` fills both apps' local databases with the demo (below; it resets them). Or sign up on
the shop yourself: as `admin@example.test` to be an admin (`ADMIN_EMAILS` in `apps/shop/.env`), or
as anyone else to apply as a partner at http://localhost:5174.

The repo's tasks, each with a comment saying what it does, are in `vite.config.ts` (`run.tasks`);
run one with `vp run <task>`. `vp check` formats, lints and type-checks.

## Demo data

90 days of a believable program, the same locally and on the demo deployment: partners in every
state, their short links, about 2,000 clicks from several countries, devices and sites, signups,
sales of three products (renewals, refunds in full and in part, flagged ones), monthly payouts, a
clawback, commission rules and bonuses. The people are in `apps/affiliates/demo.ts`, shared by
both apps' seeds (`apps/shop/db/seed.ts` makes them shop accounts, `apps/affiliates/db/seed.ts`
makes the program), and dates count back from the day it's run.

To show it: sign in on the shop as `admin@demo.test`, password `demo-password-2026` (public, for
demos only), and press Admin. To see the program as one of the partners, choose "View as" in their
menu on the Partners tab, and "Back to admin" in the bar at the top when done. That's the service's
Better Auth admin plugin impersonating them. Who's who: Maya is the busiest partner (then Leo, Priya, Tom, who has every sale
reviewed, and Ana); Ken is suspended; Sam and Lena are waiting for approval. Every demo account
also signs in on its own with that password (`maya@demo.test` and so on, `chris@demo.test` for a
customer who hasn't applied).

`vp run demo` puts it in the local databases (`void db seed` in each app). `vp run
demo:production` replaces everything in the deployed databases with it (`void db export`, then
`void db execute --remote`; `scripts/demo-production.ts`). It's for the demo deployment only.
`vp run screens` takes screenshots of every page, desktop and phone, signed in as these people.

## Tests

No fakes: the tests run against both apps with their real local database, queues and sign-in.

- `vp run test:dev`: the flows, the money and the pages in a browser (`e2e/dev/`). Uses your
  `vp run dev` if it's running, else starts one. Needs Chromium once: `vp run install:browser`.
- `vp run test:stripe`: what only real Stripe can show, in test mode (`e2e/stripe/`): partners'
  promotion codes, a sale in another currency paid out at Stripe's settled rate, a real refund. Needs
  `STRIPE_TEST_SECRET_KEY` (a test-mode key) in the shell, with `vp run dev` stopped. On GitHub:
  Actions → "Stripe end-to-end" → Run workflow, with that key as a repository secret.

CI (`.github/workflows/ci.yml`) runs `vp check` and `vp run test:dev`, as above.

## Deploy

Deployed (2026-11-22) to Cloudflare account `7384af54e33b8a54ff240371ea368440`:

- the shop at https://shop.ubuntusoftware.net (`apps/shop/void.config.ts`, `routes`);
- the service at https://affiliates.shop.ubuntusoftware.net (`apps/affiliates/void.config.ts`).

The service is on a subdomain of the shop's, and sets its referral cookie for
`shop.ubuntusoftware.net` (`AFFILIATES_COOKIE_DOMAIN`), so the shop receives it. Each app deploys
with Void's own commands, run in its folder (`apps/affiliates`, `apps/shop`):

```sh
void cloudflare login                      # once per machine
void secret sync <file>                    # the production values its env.ts declares
void deploy --platform cloudflare
```

`void.lock.json` in each app records its database and other resource IDs: commit it after a
deploy. The service is registered with the shop as its OAuth client (step 4 of "Using it from your
app"), with the secret in the service's `AFFILIATES_OAUTH_SECRET`. Not set yet: Stripe (the
`STRIPE_*` values, and the shop's webhook in Stripe, step 6).

## License

MIT, as the project it was rebuilt from (`LICENSE`).
