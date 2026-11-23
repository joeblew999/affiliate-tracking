// A payout run on the seeded program (apps/affiliates/demo.ts): each partner is paid exactly their
// approved sales and bonuses (clawbacks netted off), through the queue, once.
import { expect, test } from "vite-plus/test";
import {
  addBonus,
  demoPartner,
  payoutsOf,
  runPayouts,
  salesOf,
  seededPayoutCount,
  seededReadyCents,
} from "./helpers.ts";

test("a payout run pays each partner what's ready, and a second run pays nothing more", async () => {
  await addBonus(demoPartner("ana").name, "25", "Spring push");
  await runPayouts();

  // No Stripe Connect account: manual payouts, for an admin to pay. Newest first.
  const expected = {
    maya: seededReadyCents("maya"),
    leo: seededReadyCents("leo"),
    ana: seededReadyCents("ana") + 2500,
  };
  for (const [code, cents] of Object.entries(expected)) {
    const payouts = await payoutsOf(demoPartner(code).name);
    expect(payouts).toHaveLength(seededPayoutCount(code) + 1);
    expect(payouts[0]).toMatchObject({ status: "manual", amountCents: cents });
  }
  // Nothing ready left for them, and nothing for partners who had nothing ready.
  expect((await salesOf(demoPartner("ana").name)).filter((s) => s.status === "approved")).toEqual(
    [],
  );
  expect(await payoutsOf(demoPartner("priya").name)).toHaveLength(seededPayoutCount("priya"));

  // Again: nobody is paid anything more.
  await runPayouts();
  for (const code of Object.keys(expected))
    expect(await payoutsOf(demoPartner(code).name)).toHaveLength(seededPayoutCount(code) + 1);
});
