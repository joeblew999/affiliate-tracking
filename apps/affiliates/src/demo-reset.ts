// Putting the demo back, on a demo site (AFFILIATES_DEMO set): everything in the program deleted
// and the demo's rows loaded again (db/seed.ts), then the shop told to do the same with its users.
// For a public demo that visitors have changed, and for the tests, which put it back before each
// file. An admin's button (pages/admin), so it's an action in the control plane like any other.
import { env as bindings } from "cloudflare:workers";
import { db } from "void/db";
import { env } from "void/env";
import * as schema from "../db/schema.ts";
import { loadDemo } from "../db/seed.ts";
import { activityHeaders } from "./activity.ts";

/** Whether this is a demo site. */
export const isDemo = () => Boolean(env.AFFILIATES_DEMO);

export async function resetDemo(): Promise<void> {
  if (!isDemo()) throw new Error("Not a demo site");
  // Rows that point at others go first.
  for (const table of [
    schema.clicks,
    schema.sales,
    schema.referrals,
    schema.payouts,
    schema.refundedPayments,
    schema.commissionRules,
    schema.partnerIpHashes,
    schema.links,
    schema.events,
    schema.venues,
    schema.partners,
  ])
    await db.delete(table);
  // Dated from the pinned instant when the clock is pinned (tests), as the seed dates them.
  await loadDemo(
    { db: db as never, schema },
    env.AFFILIATES_NOW ? Date.parse(env.AFFILIATES_NOW) : Date.now(),
  );
  const res = await bindings.HOST.fetch(
    new Request(new URL("/api/affiliates/reset-demo", env.HOST_SITE_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${env.AFFILIATES_HOST_TOKEN}`, ...activityHeaders() },
    }),
  );
  if (!res.ok) throw new Error(`host reset-demo: ${res.status} ${await res.text()}`);
}
