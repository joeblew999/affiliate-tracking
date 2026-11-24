# plans/2026-11-24-03-cloudflare-durable-streams.md

The repo becomes `cloudflare-durable-streams`: the hub is the project, and the shop and the
affiliate service are its example. At the owner's word (2026-11-24).

## Why

The hub is what any developer can use: deploy it to their Cloudflare account, and have their
Workers, local or deployed, write to its streams and follow them. Workers choreograph each other
through it: each publishes what happened and follows what it cares about, so the workflow is made
at runtime by the Workers themselves, with no conductor. The affiliate program was where it was
built, and stays as the example of it.

## The layout, as a Void project

- **The repo's root is the hub**, a Void app like any other: `void.config.ts`, `vite.config.ts`,
  `routes/`, `src/`, `db/`, `durable-objects/`, `middleware/`, `crons/`, `env.ts`. Its package is
  `cloudflare-durable-streams`, exporting `./client` and `./bus` for Workers.
- **The stream server library** (`packages/streams`) is the hub's own now, in `src/server/`: the
  D1 server in `src/server/d1/`, the subscriptions beside it.
- **The protocol at its reference path,** `/v1/stream` (was `/streams`), which is also where the
  protocol's conformance suite looks.
- **Conformance runs against the hub itself** (`test/`, `vp run test:conformance`), not a separate
  test app (`packages/streams/app` is gone), and not against the example: the example is a work in
  progress, with its own tests.
- **The Worker is `durable-streams`,** with a `workers.dev` address of its own: Workers that aren't
  on the same account, or aren't deployed, reach it over HTTPS with `HUB_TOKEN`. On the same
  account, a service binding (`{ binding: "HUB", service: "durable-streams" }`). Its client takes
  either.
- **The example is `examples/`:** `affiliates`, `shop`, `activity` (its control plane), `e2e` (its
  tests), `scripts`, and its README (the repo's README before this).

## The GitHub repo

Renamed from `affiliate-tracking` with `gh repo rename`; its description and topics set with `gh
repo edit`. GitHub forwards the old address.

## Not done yet (tests after the restructure, at the owner's word)

- The conformance suite against the hub in its new place, and the example's suite, run again.
  Both passed before the move (344 and 31).
- The Deploy to Cloudflare button: Cloudflare's button deploys from a Wrangler config in the
  repo; a Void app writes its own at build time. To find out how Void and the button meet.
- The client on npm.
- Timing the hub from around the world with
  [cloudflare-ping](https://github.com/joeblew999/cloudflare-ping).
- Deploying the hub, then the example against it.
