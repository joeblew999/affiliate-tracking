// The demo seed, as the README describes it and as people see it: every run starts from it
// (../apps.ts), so it can't drift from the code. Its people come from apps/affiliates/demo.ts, the
// same file both apps' seeds read. Only what the other tests don't change is checked here: who is
// who and their status, not amounts, which payout runs elsewhere change.
import { expect, test } from "vite-plus/test";
import { demoPeople } from "../../apps/affiliates/demo.ts";
import { admin, AFFILIATES, open, partnerPage, signInAs } from "./helpers.ts";

const partners = demoPeople.filter((p) => p.partner);

test("every demo person signs in, and sees their own partner page", async () => {
  for (const person of demoPeople.filter((p) => p.role === "user")) {
    const me = await partnerPage(await signInAs(person.email));
    expect({ email: person.email, status: me.status }).toEqual({
      email: person.email,
      status: person.partner?.status ?? "none",
    });
    if (me.status === "active") expect(me.link).toBe(`${AFFILIATES}/r/${person.partner?.code}`);
  }
});

test("the admin sees every partner with the status, code and review the seed gave them", async () => {
  const { page } = await admin();
  await open(page, `${AFFILIATES}/admin`);
  for (const person of partners) {
    const row = page.getByRole("row").filter({ hasText: person.email });
    const cells = (await row.getByRole("cell").allInnerTexts()).join("\n");
    expect(cells).toContain(person.partner?.status);
    expect(cells).toContain(person.partner?.code);
    expect(cells.includes("every sale reviewed")).toBe(person.partner?.reviewRequired ?? false);
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
  const byClicks = [...clicks].sort((a, b) => b.clicks - a.clicks);
  expect(byClicks.map((p) => p.name)).toEqual(byReach.map((p) => p.name));
  expect(clicks.every((p) => p.clicks > 0)).toBe(true);
});
