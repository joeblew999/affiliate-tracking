// A payout run on the seeded program (apps/affiliates/demo.ts): each partner is paid exactly their
// approved sales and bonuses (clawbacks netted off), through the queue, once. No browser: the
// payouts made are read from the admin's state stream (bus.ts).
import { expect, test } from "vite-plus/test";
import { adminBus, written } from "./bus.ts";
import { seededPartnerId, seededReadyCents } from "./helpers.ts";

test("a payout run pays each partner what's ready, and a second run pays nothing more", async () => {
  const admin = await adminBus();
  await admin.act("/admin", "bonus", {
    partnerId: seededPartnerId("ana"),
    commissionCents: 2500,
    bonusNote: "Spring push",
  });
  await admin.act("/admin", "runPayouts");

  // No Stripe Connect account: manual payouts, for an admin to pay.
  const expected = {
    maya: seededReadyCents("maya"),
    leo: seededReadyCents("leo"),
    ana: seededReadyCents("ana") + 2500,
  };
  const codes = [...Object.keys(expected), "priya"];
  /** Each of these partners' payouts made in the run, as "status cents". */
  const paid = async () => {
    const made = (await written()).payouts();
    return Object.fromEntries(
      codes.map((code) => [
        code,
        made
          .filter((p) => p.partnerId === seededPartnerId(code))
          .map((p) => `${p.status} ${p.amountCents}`),
      ]),
    );
  };
  // One each, and none for a partner with nothing ready (Priya). (Organisers and venues' contacts
  // owed something are paid in the same run.)
  const once = {
    ...Object.fromEntries(
      Object.entries(expected).map(([code, cents]) => [code, [`manual ${cents}`]]),
    ),
    priya: [],
  };
  expect(await paid()).toEqual(once);
  const made = (await written()).payouts().length;
  // Nothing ready left for them.
  expect(
    (await written())
      .sales()
      .filter((s) => s.partnerId === seededPartnerId("ana") && s.status === "approved"),
  ).toEqual([]);

  // Again: nobody is paid anything more.
  await admin.act("/admin", "runPayouts");
  expect(await paid()).toEqual(once);
  expect((await written()).payouts()).toHaveLength(made);
});
