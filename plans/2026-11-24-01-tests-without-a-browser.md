# plans/2026-11-24-01-tests-without-a-browser.md

Most tests stop using a browser. The apps still run for real, as `vp dev` runs them, and a test
still waits on the control plane's events. Follows `plans/2026-11-23-06-streams.md`.

## Why (2026-11-24)

- Void's own way of testing (`vp test`, in Node, its guide `guide/testing.md`) was tried and
  dropped. Under `vp test`, `void/db` is Void's plain module: no schema, none of the app's column
  naming, no bindings. Void's plugin adds those only inside the running Worker, which is why its
  guide mocks them. Keeping it real meant rebuilding that wiring by hand in test code (Miniflare,
  the migrations, a Drizzle of our own, two more packages). Three layers in, it still didn't
  pass. Nothing of it is kept.
- So the apps stay running for the tests. What can go is the browser. Today every test, even one
  that only checks a commission amount, opens Chromium, signs in, opens the admin page, and reads
  numbers out of table cells.

## Measured first

One file as it is now, `e2e/dev/money.test.ts` (4 tests), run alone on 2026-11-24 with
`vp test run --project dev e2e/dev/money.test.ts`: **98 seconds**. Its 4 tests took 30 of them
(11.0, 7.4, 9.0 and 2.2). The other 68 were before the first test: copying, migrating, seeding
and starting both apps (`e2e/apps.ts`), opening Chromium, and the admin pressing Reset demo
(`e2e/dev/each-file.ts`). How those 68 split isn't measured yet.

So there are two costs, and the browser is only one of them:

- **Before the first test:** 68 seconds for one file. Taking the browser out of the tests doesn't
  touch most of this. It has to be split and measured before anything is changed.
- **In the tests:** 2 to 11 seconds each, for tests that send a few requests. This is where the
  browser goes.

Still to measure: the 68 seconds split into its parts, and the same file without a browser. If
that isn't clearly faster, this plan stops there and says so.

## What a test does instead

1. **Signs in** through the shop's Better Auth client, as `signInAs` already does
   (`e2e/dev/helpers.ts`), and keeps the cookie. No browser to put it in.
2. **Acts** by sending what the page's button sends: the page action's form post, with the
   cookie. Stripe's events and the daily job are already plain requests (`stripeEvent`,
   `runCron`).
3. **Waits** on the viewer's stream, read with the Durable Streams client the pane uses
   (`@durable-streams/client`, `live: "sse"`), for that action to read done or failed. Failed ends
   the test at once with its steps, as now. No waiting and looking again.
4. **Reads the result** from the service, as data. To be decided by the proof: either the page's
   own loader data, or a small admin-only route that returns the same thing the loader does, from
   one function they both call, read with Void's typed fetch (`void/client`) so the types come
   from the handler.

## What keeps a browser

Only the tests that are about pages: `pages.test.ts` (landing, View as, phone width),
`activity.test.ts` (the pane itself), `streams.test.ts` (the pane's stream in a tab), and one
sign-up through the form. The rest (`money`, `flows`, `events`, `hold`, `payouts`, `refunds`,
`demo`, `skeleton`) lose it.

## Order

1. Proof: `money.test.ts` without a browser, measured against itself with one.
2. If it holds: the helpers (`e2e/dev/helpers.ts`) split in two, one file for the browser and one
   without, and the other files moved over, one at a time.
3. Remove what's left unused in the helpers. README's "Check and test" brought up to date.

## Not in this plan

Many workers (the hub as its own app, the delay between a write and the service being woken, a
kit for a new worker): still to be planned, after this.
