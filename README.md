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

- **Sign-in is the host's alone.** The service has no users, passwords or sessions. It asks the host
  who a session cookie belongs to (Better Auth's `get-session`, through a Cloudflare service
  binding). Admins are the host's admin role (Better Auth's admin plugin). A partner is a host user
  who applied.
- **Two addresses, one domain.** The host at e.g. `shop.example.com`, the service at
  `affiliates.example.com`. The host's session cookie is set for the parent domain so the service
  receives it, and so is the service's referral cookie, so the host receives that.
- **The host calls the service like a function,** through the service binding and
  `apps/affiliates/client.ts`. Each call's input and output are defined once, in
  `apps/affiliates/src/host-contract.ts`; the service's routes check against it and the client takes
  its types from it. Host calls carry a shared secret (`AFFILIATES_HOST_TOKEN`), since the service
  also has a public address.
- **Referral links are the service's:** `affiliates.example.com/r/<partner code or short link>`
  counts the click, sets the referral cookie, and sends the visitor on to the host's site.
- **Stripe is split.** The host keeps customers and subscriptions (Better Auth's Stripe plugin). The
  service has its own Stripe webhook endpoint for sales, renewals, refunds and disputes, and pays
  partners with Stripe Connect transfers.
- **Long-running work goes through queues:** sign-ups reach the service through the host's queue,
  and payouts run one partner per queue message. A daily cron approves sales past the hold period
  and queues again any payout left unfinished, so a crash never leaves one half done.

## Using it from your app

What the example shop does, in `apps/shop`:

1. Bind the service, in your `void.config.ts`: `cloudflare.services: [{ binding: "AFFILIATES",
   service: "affiliates" }]`. The service binds back to you as `HOST` (its `void.config.ts`).
2. Give both apps the same `AFFILIATES_HOST_TOKEN` (`void secret put AFFILIATES_HOST_TOKEN` in each).
3. In your `auth.ts`: the admin plugin; a new-user hook that queues the sign-up for the service with
   the referral cookie's value (`referralFrom` in the client); and, with Better Auth's Stripe plugin,
   `getCheckoutSessionParams` asking the service's `checkout` for the metadata and discount to add.
   See `apps/shop/auth.ts`, `apps/shop/queues/affiliate-signups.ts` and `apps/shop/src/affiliates.ts`.
4. Set your session cookie for the parent domain (Better Auth's `advanced.crossSubDomainCookies`),
   and the service's `AFFILIATES_COOKIE_DOMAIN` to the same domain.
5. In Stripe, add a webhook endpoint for the service, `https://affiliates.example.com/api/stripe/webhook`,
   for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`; its signing secret is the service's
   `STRIPE_WEBHOOK_SECRET`.

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

Sign up on the shop as `admin@example.test` to be an admin (`ADMIN_EMAILS` in `apps/shop/.env`), or
as anyone else to apply as a partner at http://localhost:5174. For demo data on the service's pages:
`vp run affiliates#db:seed` (it resets the service's local database).

The repo's tasks, each with a comment saying what it does, are in `vite.config.ts` (`run.tasks`);
run one with `vp run <task>`. `vp check` formats, lints and type-checks.

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

The service is on a subdomain of the shop's, and the shop sets its sign-in cookie for
`shop.ubuntusoftware.net` (`AUTH_COOKIE_DOMAIN`), so the service receives it. Each app deploys
with Void's own commands, run in its folder (`apps/affiliates`, `apps/shop`):

```sh
void cloudflare login                      # once per machine
void secret sync <file>                    # the production values its env.ts declares
void deploy --platform cloudflare
```

`void.lock.json` in each app records its database and other resource IDs: commit it after a
deploy. Not set yet: Stripe (each app's `STRIPE_*` values, and the service's webhook endpoint in
Stripe, step 5 of "Using it from your app"). Until then the service's `STRIPE_WEBHOOK_SECRET` is
a random placeholder, so its webhook accepts nothing.

## License

MIT, as the project it was rebuilt from (`LICENSE`).
