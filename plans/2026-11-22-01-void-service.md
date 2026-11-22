# 2026-11-22-01-void-service.md

Status: approved 2026-11-22 ("get busy"). Steps 1 to 6 done, on Void 1.11.0 (released 2026-11-19);
the example shop is the host for now, deployed with the service on ubuntusoftware.net. What's left is under
"Follow-ups" at the end.

## What we're building

The affiliate program as a Void app of its own: a **service** with its own database, API and
pages, which other apps plug into. It has no users of its own: the app it serves (the **host**)
signs people in with its own Better Auth, and the service asks the host who someone is.

Everything the fork does today carries over: referral links and short links, signup referrals,
attribution at checkout, conversions, renewals, refunds, hold period, fraud checks, commission
rules and bonuses, payout currencies, Stripe Connect payouts, analytics.

## Proven in the trial (`spike/`, 2026-11-22, Void 1.8.0, Vite+ 1.6.0, local dev)

Two Void apps, `spike/apps/service` and `spike/apps/host`, each with its own `vp dev`.

1. **The host calls the service through a Cloudflare service binding, typed end to end.**
   - The host's `void.config.ts` has `cloudflare.services: [{ binding: "AFFILIATES", service:
     "affiliates" }]`; Void generates the binding's type (`.void/bindings.d.ts`).
   - `spike/apps/service/client.ts` is the service's client for other apps. Its input and output
     types come from the route handlers themselves (`__validators` and `__output`, which every
     `defineHandler` carries). Nothing is written twice.
   - A wrong field type or an unknown output field fails `tsc` in the host (both tried).
2. **The service's pages are React with shadcn components** (`spike/apps/service/pages/affiliates/`),
   added with the shadcn CLI as in void-fbtee (`components.json`, `@/ui`, `cn`). Loaded and clicked
   in Chrome with no errors.
3. **Sign-in stays the host's alone.** The service's `src/user.ts` sends the request's cookie to the
   host's Better Auth (`/api/auth/get-session`) through a `HOST` binding. Signed in: the service
   sees the user. Signed out or a made-up cookie: no one.

Found on the way (Void 1.8.0, read in `node_modules/void/dist`):

- A Void app's Worker is one generated `WorkerEntrypoint` (`fetch`, `scheduled`, `queue`,
  `email`); an app can't add callable methods of its own. So other apps call the service's
  routes through the binding's `fetch`, as in (1).
- Void's typed `fetch` client only knows the calling app's own routes, and its
  `createRouteFetch` isn't public. Hence the service's own small client.
- Void can't serve an app under a sub-path: Vite's `base` is ignored by the dev server's script
  tags, and a build still puts files at `/assets/`. So the service gets its own address (below),
  not `host.com/affiliates/`.
- The host's auth must be switched on by a root `auth.ts` (Void turns auth on when it sees one).
  It's also where the Better Auth Stripe plugin goes.

## Design

- **Two apps in one repo,** a pnpm workspace laid out the Vite+ way like void-fbtee:
  - `apps/service`: the affiliate service.
  - `apps/host`: an example host, the service's docs and proving ground. A tiny shop: Void's
    Better Auth, the Better Auth Stripe plugin, a checkout, wired to the service.
- **Sign-in:** the host's alone, as Void's own dashboard asks its API (Void repo,
  `platform/packages/dashboard/middleware/01.auth.ts`). A middleware asks the host's Better Auth
  who the session cookie belongs to, through the `HOST` binding; the service's `/api/auth` is the
  host's Better Auth through the same binding. (2026-11-22: an OAuth-provider design with a second
  Better Auth in the service was tried and removed: it copied users and roles into the service
  and needed client registration and a secret.)
- **Partners and admins:** a partner is a host user the service has approved. An admin is a role
  in the host's Better Auth (its `admin()` plugin).
- **The service's address:** its own subdomain of the host's, e.g. `affiliates.shop.example.com`.
  The host's session cookie is set for the parent domain (`advanced.crossSubDomainCookies`), so
  the service receives it; the referral cookie likewise reaches the host.
- **Host → service:** the service binding and `client.ts`, for: a user signed up (with the
  referral cookie), add attribution to a checkout, and whatever else a host needs.
- **Stripe:**
  - The host keeps customers and subscriptions with the Better Auth Stripe plugin.
  - The host's Better Auth Stripe webhook passes every event to the service (the plugin's
    `onEvent`, through the binding), which records sales, renewals, refunds and disputes, and
    sends partner payouts through Stripe Connect. (Changed 2026-11-22: the service had its own
    webhook endpoint.)
  - The host's only jobs: add the service's attribution when it creates a checkout, and tell the
    service when a user signs up (Better Auth's new-user hook).
- **Database:** D1 through Drizzle (`void/db`). The fork's 14 SQL migrations become one Drizzle
  schema, which Void turns into migrations. UUID keys throughout. Row types and validators come
  from the schema (`drizzle-zod`), so the API, the client and the pages share them.
- **Pages:** React + shadcn, the fork's screens rebuilt: partners, links, conversions, payouts,
  rules and bonuses, performance; and the partner's own dashboard, links and stats.
- **Seeds:** `void db seed` with `defineSeed` (`void/seed`): demo partners, links, clicks, sales,
  for local dev and the tests.
- **Long-running work:** the hold period, payouts and currency settling go through Void's
  queues and crons (`queues/`, `crons/`), one step triggering the next. No timed waits.

## Tests

No fakes: Void's own testing guide (`guide/testing.md`) runs unit tests in Node with bindings
replaced by mocks, so we don't rely on those.

- **Dev-server tests:** both apps run with real local D1, the binding and Better Auth; tests sign
  up, click links, check out, and read the results through the real routes.
- **Stripe end-to-end** (repo root `e2e/`, as now): real Stripe test mode. Run on demand.
- **Browser tests:** the pages in Chrome, as in today's dashboard checks.

## Steps

1. **Skeleton:** the workspace, both apps, the binding both ways, sign-in through the host, one
   typed call and one shadcn page, from the trial. Old code stays until step 5.
2. **Schema and core flows:** Drizzle schema with seeds; referral links and short links, signup
   referrals, checkout attribution, sales and refunds from Stripe's webhook.
3. **Money:** commission rules and bonuses, renewals, hold period, fraud checks, payout currencies,
   Connect payouts, through queues and crons.
4. **Pages:** admin and partner screens in shadcn; analytics.
5. **Switch over:** README rewritten for the new layout; the old `src/`, `functions/`,
   `migrations/`, `types/`, `tests/`, `examples/`, `wrangler.toml` and their CI removed in the same
   change. CI runs the same `vp` commands as locally.
6. **Deploy:** `void deploy --platform cloudflare` for both apps, on a real domain's subdomains.

Each step ends with its tests passing locally; pushed when you say.

## Open questions for you

- Which domain for the deployed pair (e.g. `shop.ubuntusoftware.net` and
  `affiliates.ubuntusoftware.net`)?
- Is this the real product's host, or is the example host enough for now?

## Follow-ups (found while building, not done yet)

- **Done 2026-11-22: refunds** (`apps/affiliates/src/refunds.ts`). A partial refund takes its share
  of the commission, not all of it; a refund after a sale is paid out is a clawback the partner's
  next payout nets off; a won dispute gives the commission back. The old library had none of this.
  Not covered by a test: a refund landing between a payout's claim and its transfer (the payout is
  sent back), since the queue runs a payout too quickly for a test to land one in between.
- **Void: `void cloudflare login` can't sign in on a headless Linux machine** (Void 1.11.0, seen
  2026-11-22 in a Claude cloud session): it always sets `CLOUDFLARE_AUTH_USE_KEYRING=true`
  (`dist/cloudflare-auth-*.mjs`, `cloudflareAuthEnvironment`), and on Linux that needs `secret-tool`
  and a running keyring service, which servers and containers don't have. The only other route is
  `CLOUDFLARE_API_TOKEN`. Worth reporting to Void: allow storing the sign-in in a file there, as `cf
  auth login --no-use-keyring` does.
- **Dev queue delivery** (seen 2026-11-22, not yet explained): in one `vp run dev` session that had
  reloaded after Vite re-bundled its dependencies, every real `payouts` queue message failed in about
  5 ms before the handler ran, while the same message sent through `/__void/queue` worked. A fresh
  `vp run dev` was fine. To find out: whether Void's local queue consumer keeps the module from before
  the reload; if so, report it to Void with the steps.
- **Connect transfers** have no end-to-end test: Stripe test mode needs an onboarded Connect account,
  which `vp run test:stripe` doesn't make yet. Manual payouts and currency conversion are covered.
- **The Stripe end-to-end suite hasn't run yet**: it needs `STRIPE_TEST_SECRET_KEY`, which this
  cloud session doesn't have. Run it on GitHub (Actions → "Stripe end-to-end") or locally.
- **Void:** `vp run dev` starting two Void apps at once sometimes crashed one of them on the
  debugger port (EADDRINUSE 9229) instead of moving to another; each app now sets its own
  (`VOID_INSPECTOR_PORT`, read by Void 1.11.0 but not in its docs). Worth reporting to Void, with
  the steps to see it.
- **Done 2026-11-22: deploy (step 6)**, at https://shop.ubuntusoftware.net and
  https://affiliates.shop.ubuntusoftware.net (README, "Deploy"). Checked live: a sign-up on the
  shop is seen by the service through its cookie and the binding. Left: Stripe (the apps' keys
  and the service's webhook endpoint in Stripe); and one test user, smoke-1795349659@example.test,
  in the shop's database (the Cloudflare connector may read it but not delete from it).
