// Once a day: each subscriber is woken if a stream it follows has gone past what it has
// acknowledged (a write and telling the subscribers of it are two steps; if the Worker stopped
// between them, this is what tells them), and streams past their expiry are removed.
import { defineScheduled } from "void";
import { recheckAll, sweep } from "../src/streams.ts";

export const cron = "23 3 * * *";

export default defineScheduled(async () => {
  await recheckAll();
  await sweep();
});
