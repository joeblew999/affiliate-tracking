// The control plane's streams, which the hub holds (apps/hub): what the apps' work is written to,
// read in a browser at an app's own /streams (its routes/streams/[...path].ts decides who may,
// and passes the read on to the hub).
import { expect, test } from "vite-plus/test";
import {
  activity,
  addBonus,
  admin,
  AFFILIATES,
  demoPartner,
  open,
  SHOP,
  signInAs,
} from "./helpers.ts";

test("an admin reads the admins' stream: what's there, then what's added, live", async () => {
  const { page } = await admin();
  await open(page, `${AFFILIATES}/admin`);
  const pane = await activity(page);
  await addBonus(demoPartner("ana").name, "10", "First");
  await pane.finished("Bonus");

  // Read from the admin's own page, on the service's address: its /streams passes on to the shop.
  const sofar = await page.evaluate(async () => {
    const response = await fetch("/streams/admins?offset=-1");
    return {
      status: response.status,
      next: response.headers.get("stream-next-offset"),
      events: (await response.json()) as { type: string; title?: string }[],
    };
  });
  expect(sofar.status).toBe(200);
  expect(sofar.events.map((e) => e.title)).toContain("Bonus");

  // From where that read ended, live: the next action started arrives by itself.
  const before = await pane.seen();
  const arrived = page.evaluate(
    (offset) =>
      new Promise<string>((resolve) => {
        const source = new EventSource(`/streams/admins?offset=${offset}&live=sse`);
        source.addEventListener("data", (message) => {
          if (!message.data.includes('"started"')) return;
          source.close();
          resolve(message.data);
        });
      }),
    sofar.next,
  );
  await addBonus(demoPartner("ana").name, "20", "Second");
  expect(await arrived).toContain("Bonus");
  await pane.finished("Bonus", { after: before });
});

test("someone who isn't an admin can't read the admins' stream", async () => {
  const { page } = await signInAs("chris@demo.test");
  await open(page, SHOP);
  expect(await page.evaluate(async () => (await fetch("/streams/admins?offset=-1")).status)).toBe(
    403,
  );
});
