// Once a day: each subscriber is woken if a stream it follows has gone past what it has
// acknowledged (src/streams.ts). A write and telling the subscribers of it are two steps; if the
// Worker stopped between them, this is what tells them. An action in the control plane, for admins.
import { defineScheduled } from "../src/activity.ts";
import { subscriptionIds } from "../src/published.ts";
import { recheck } from "../src/streams.ts";

export const cron = "23 3 * * *";

export default defineScheduled("Daily check", async () => {
  for (const id of subscriptionIds()) await recheck(id);
});
