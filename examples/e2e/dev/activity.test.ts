// The control plane (examples/activity): what each person's Activity pane shows, live, of the
// work they and others start, in both apps.
import { expect, test } from "vite-plus/test";
import { activity, addBonus, admin, AFFILIATES, demoPartner, open } from "./helpers.ts";

test("an admin's pane on the service's pages shows the actions they take there, done", async () => {
  const { page } = await admin();
  await open(page, `${AFFILIATES}/admin`);
  const pane = await activity(page);
  const before = await pane.seen();
  await addBonus(demoPartner("ana").name, "10", "Thanks");
  // The page action is the admin page's "bonus" (pages/admin/index.server.ts).
  const done = await pane.finished("Bonus", { after: before });
  expect(await done.getAttribute("data-by")).toBe("Dana Reyes");
});
