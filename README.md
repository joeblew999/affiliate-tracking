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
  through Stripe Connect; the partner's and the admin's pages. Laid out the Void way:
  - each table in its own `db/schema/<table>.ts` (as `void gen model` lays them out), with the
    request validators derived from it (`void/drizzle-zod`);
  - the two pages read through their `loader` and change data through their named `actions`
    (`pages/index.server.ts`, `pages/admin/index.server.ts`), called with Void's `action()`; Void
    re-runs the loader after each. There's no API for the pages;
  - the only routes are what other things call: the shop's `/api/host/*` (through the binding), the
    shop's Better Auth at `/api/auth`, and referral links at `/r/<code>`;
  - custom SQL in its own `void gen migration`.

- `apps/shop`: an example host. Void's Better Auth with its admin and Stripe plugins, wired to the
  service. It shows what a real host does, and the tests run against it.
- `e2e/`: the tests, against both apps running for real.
- `scripts/setup.ts`: each app's local `.env`.
- `.claude/skills/void`: Void's own skill for coding agents, linked from the installed `void`
  package (as `void init` links it), so it matches the Void version after every `vp install`.

## How it fits together

- **Sign-in is the host's alone,** as Void's own dashboard does with its API. The service has no
  users, passwords or sessions. A middleware (`apps/affiliates/middleware/01.user.ts`) asks the
  host's Better Auth who the session cookie belongs to, through the service binding, and sends
  anyone signed out to the host's sign-in, which brings them back. The service's `/api/auth` is the
  host's Better Auth through the same binding, so its pages use Better Auth's client as if it were
  their own: admins are the host's admin role, and "View as" is its admin plugin. A partner is a
  host user who applied.
- **Two addresses, one domain.** The host at e.g. `shop.example.com`, the service at
  `affiliates.shop.example.com`. The host's session cookie is set for the parent domain so the
  service receives it, and so is the service's referral cookie, so the host receives that.
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
   service: "affiliates" }]`. The service binds back to you as `HOST` (its `void.config.ts`).
2. Give both apps the same `AFFILIATES_HOST_TOKEN` (`void secret put AFFILIATES_HOST_TOKEN` in each).
3. In your `auth.ts` (see `apps/shop/auth.ts`):
   - the `admin` plugin; the service's address in `trustedOrigins`; and your session cookie for
     the parent domain (`advanced.crossSubDomainCookies`, from `AUTH_COOKIE_DOMAIN`);
   - a new-user hook that queues the sign-up for the service with the referral cookie's value
     (`referralFrom` in the client; `apps/shop/queues/affiliate-signups.ts`);
   - with Better Auth's Stripe plugin, `getCheckoutSessionParams` asking the service's `checkout`
     for the metadata and discount to add, and `onEvent` passing each event to `stripeEvent`
     (`apps/shop/src/affiliates.ts`).
4. Set the service's `HOST_SITE_URL` to your site, and its `AFFILIATES_COOKIE_DOMAIN` to the
   parent domain.
5. In Stripe, your Better Auth Stripe webhook (`https://shop.example.com/api/auth/stripe/webhook`)
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
run one with `vp run <task>`. `vp check` formats, lints and type-checks each file; `vp run typecheck` checks each TypeScript
project whole (both apps, the tests, the root scripts), which catches what only shows up in one of
them.

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

- `vp run test:dev`: the flows, the money and the pages in a browser (`e2e/dev/`). They type-check
  against the service (`e2e/tsconfig.json`): they read the pages' loaders and call their actions the
  way Void's own client does, typed from them (`e2e/dev/helpers.ts`). Uses your
  `vp run dev` if it's running, else starts one. Needs Chromium once: `vp run install:browser`.
  Cached by Vite+: with no file it reads changed, it replays the last result at once. While working
  on one thing, run just its file: `vp test run --project dev e2e/dev/money.test.ts`.
- `vp run test:stripe`: what only real Stripe can show, in test mode (`e2e/stripe/`): partners'
  promotion codes, a sale in another currency paid out at Stripe's settled rate, a real refund. Needs
  `STRIPE_TEST_SECRET_KEY` (a test-mode key) in the shell, with `vp run dev` stopped. On GitHub:
  Actions → "Stripe end-to-end" → Run workflow, with that key as a repository secret.

CI (`.github/workflows/ci.yml`) runs `vp check`, `vp run typecheck` and `vp run test:dev`, as above.

## Deploy

Deployed (2026-11-22) to Cloudflare account `7384af54e33b8a54ff240371ea368440`:

- the shop at https://shop.ubuntusoftware.net (`apps/shop/void.config.ts`, `routes`);
- the service at https://affiliates.shop.ubuntusoftware.net (`apps/affiliates/void.config.ts`).

The service is on a subdomain of the shop's. The shop sets its sign-in cookie for
`shop.ubuntusoftware.net` (`AUTH_COOKIE_DOMAIN`), so the service receives it, and the service sets
its referral cookie for the same domain (`AFFILIATES_COOKIE_DOMAIN`), so the shop receives that. Each app deploys
with Void's own commands, run in its folder (`apps/affiliates`, `apps/shop`):

```sh
void cloudflare login                      # once per machine
void secret sync <file>                    # the production values its env.ts declares
void deploy --platform cloudflare
```

`void.lock.json` in each app records its database and other resource IDs: commit it after a
deploy. Not set yet: Stripe (the `STRIPE_*` values, and the shop's webhook in Stripe, step 5 of
"Using it from your app").

## License

MIT, as the project it was rebuilt from (`LICENSE`).
