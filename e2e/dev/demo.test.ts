// The demo, as people see it, against its fixtures (apps/affiliates/demo.ts): the same file both
// apps' seeds load. Every file starts from exactly those fixtures, with the service's clock at
// DEMO_NOW, so the amounts are exact. Only the clicks are generated: checked by their order.
import { expect, test } from "vite-plus/test";
import { demoPayouts, demoPeople, demoSales } from "../../apps/affiliates/demo.ts";
import { admin, AFFILIATES, open, partnerPage, payoutsOf, salesOf, signInAs } from "./helpers.ts";

const partners = demoPeople.filter((p) => p.partner);
const salesOfFixture = (code: string) => demoSales.filter((s) => s.partner === code);
const total = (code: string, statuses: string[]) =>
  salesOfFixture(code)
    .filter((s) => statuses.includes(s.status))
    .reduce((sum, s) => sum + s.commissionCents, 0);

test("each demo person signs in and sees their own page: status, link and money, to the cent", async () => {
  for (const person of demoPeople.filter((p) => p.role === "user")) {
    const me = await partnerPage(await signInAs(person.email));
    const p = person.partner;
    expect({ email: person.email, status: me.status }).toEqual({
      email: person.email,
      status: p?.status ?? "none",
    });
    if (me.status !== "active" || !p) continue;
    // The last 30 days: sales made then that weren't refunded (clicks come from the generator).
    const recent = salesOfFixture(p.code).filter(
      (s) =>
        (s.kind === "checkout" || s.kind === "renewal") &&
        s.status !== "refunded" &&
        s.daysAgo < 30,
    );
    expect({
      email: person.email,
      link: me.link,
      onHoldCents: me.onHoldCents,
      readyCents: me.readyCents,
      paidCents: me.paidCents,
      sales: me.sales,
    }).toEqual({
      email: person.email,
      link: `${AFFILIATES}/r/${p.code}`,
      onHoldCents: total(p.code, ["pending"]),
      readyCents: total(p.code, ["approved"]),
      paidCents: total(p.code, ["paid"]),
      sales: recent.length,
    });
  }
});

test("the admin sees every partner with the status, code and review the fixtures give them", async () => {
  const { page } = await admin();
  await open(page, `${AFFILIATES}/admin`);
  for (const person of partners) {
    const cells = (
      await page
        .getByRole("row")
        .filter({ hasText: person.email })
        .getByRole("cell")
        .allInnerTexts()
    ).join("\n");
    expect(cells).toContain(person.partner?.status);
    expect(cells).toContain(person.partner?.code);
    expect(cells.includes("every sale reviewed")).toBe(person.partner?.reviewRequired ?? false);
  }
});

test("the admin sees every partner's sales and payouts as the fixtures have them", async () => {
  for (const person of partners) {
    const code = person.partner?.code ?? "";
    const shown = (await salesOf(person.name)).map((s) => `${s.status} ${s.commissionCents}`);
    const fixture = salesOfFixture(code).map((s) => `${s.status} ${s.commissionCents}`);
    expect({ code, sales: shown.sort() }).toEqual({ code, sales: fixture.sort() });
    const payouts = (await payoutsOf(person.name)).map((p) => `${p.status} ${p.amountCents}`);
    const expected = demoPayouts
      .filter((p) => p.partner === code)
      .map((p) => `manual ${p.amountCents}`);
    expect({ code, payouts: payouts.sort() }).toEqual({ code, payouts: expected.sort() });
  }
});

test("partners are as busy as the demo says: more reach, more clicks", async () => {
  const active = partners.filter((p) => p.partner?.status === "active");
  const clicks = [];
  for (const person of active) {
    const me = await partnerPage(await signInAs(person.email));
    if (me.status === "active") clicks.push({ name: person.name, clicks: me.clicks });
  }
  const byReach = [...active].sort((a, b) => (b.partner?.reach ?? 0) - (a.partner?.reach ?? 0));
  expect([...clicks].sort((a, b) => b.clicks - a.clicks).map((p) => p.name)).toEqual(
    byReach.map((p) => p.name),
  );
});
