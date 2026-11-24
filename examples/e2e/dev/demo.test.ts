// The demo seed loads and the pages show it: one person of each kind, checked against the fixtures
// (examples/affiliates/demo.ts). The seed is there for people to look at and play with; the other
// tests start from it and check what the system does.
import { expect, test } from "vite-plus/test";
import { demoSales } from "../../affiliates/demo.ts";
import { adminTab, AFFILIATES, partnerPage, signInAs, signInOnForm } from "./helpers.ts";

/** The commission of Maya's fixture sales in this status. */
const maya = (status: string) =>
  demoSales
    .filter((s) => s.partner === "maya" && s.status === status)
    .reduce((sum, s) => sum + s.commissionCents, 0);

test("the seeded demo: a partner's money, each other kind of person, and the admin's view", async () => {
  // Maya signs in on the real form, with the seeded password; the others through Better Auth's sign-in.
  expect(await partnerPage(await signInOnForm("maya@demo.test"))).toMatchObject({
    status: "active",
    link: `${AFFILIATES}/r/maya`,
    onHoldCents: maya("pending"),
    readyCents: maya("approved"),
    paidCents: maya("paid"),
  });
  expect((await partnerPage(await signInAs("ken@demo.test"))).status).toBe("suspended");
  expect((await partnerPage(await signInAs("sam@demo.test"))).status).toBe("pending");
  expect((await partnerPage(await signInAs("chris@demo.test"))).status).toBe("none");

  const tom = (await adminTab(/^Partners/)).getByRole("row").filter({ hasText: "tom@demo.test" });
  expect(await tom.getByText("every sale reviewed").count()).toBe(1);
});
