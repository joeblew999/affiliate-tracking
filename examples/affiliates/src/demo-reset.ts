// Putting the demo back, on a demo site (AFFILIATES_DEMO set): everything in the program deleted
// and the demo's rows loaded again (db/seed.ts), then that published for the host, which follows
// it and does the same with its users (src/hub.ts).
// For a public demo that visitors have changed, and for the tests, which put it back before each
// file. An admin's button (pages/admin), so it's an action in the control plane like any other.
import { db } from "void/db";
import { env } from "void/env";
import * as schema from "../db/schema.ts";
import { loadDemo } from "../db/seed.ts";
import { publishDemoReset } from "./hub.ts";

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
  await publishDemoReset({});
}
