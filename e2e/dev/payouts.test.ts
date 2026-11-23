// A payout run on the seeded program (apps/affiliates/demo.ts): each partner is paid exactly their
// approved sales and bonuses (clawbacks netted off), through the queue, once.
import { expect, test } from "vite-plus/test";
import { demoPayouts, demoPeople, demoSales } from "../../apps/affiliates/demo.ts";
import { addBonus, eventually, payoutsOf, runPayouts, salesOf } from "./helpers.ts";

const name = (code: string) => demoPeople.find((p) => p.partner?.code === code)?.name ?? "";
/** What's ready to pay for this partner in the fixtures. */
const ready = (code: string) =>
  demoSales
    .filter((s) => s.partner === code && s.status === "approved")
    .reduce((sum, s) => sum + s.commissionCents, 0);
const seededPayouts = (code: string) => demoPayouts.filter((p) => p.partner === code).length;

test("a payout run pays each partner what's ready, and a second run pays nothing more", async () => {
  await addBonus(name("ana"), "25", "Spring push");
  await runPayouts();

  // No Stripe Connect account: manual payouts, for an admin to pay. Newest first.
  const expected = { maya: ready("maya"), leo: ready("leo"), ana: ready("ana") + 2500 };
  for (const [code, cents] of Object.entries(expected)) {
    await eventually(async () => {
      const payouts = await payoutsOf(name(code));
      expect(payouts).toHaveLength(seededPayouts(code) + 1);
      expect(payouts[0]).toMatchObject({ status: "manual", amountCents: cents });
    });
  }
  // Nothing ready left for them, and nothing for partners who had nothing ready.
  expect((await salesOf(name("ana"))).filter((s) => s.status === "approved")).toEqual([]);
  expect(await payoutsOf(name("priya"))).toHaveLength(seededPayouts("priya"));

  await runPayouts();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const code of Object.keys(expected))
    expect(await payoutsOf(name(code))).toHaveLength(seededPayouts(code) + 1);
});
