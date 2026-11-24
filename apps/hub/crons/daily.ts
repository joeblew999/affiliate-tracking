// Once a day: each subscriber is woken if a stream it follows has gone past what it has
// acknowledged (src/streams.ts). A write and telling the subscribers of it are two steps; if the
// Worker stopped between them, this is what tells them.
import { defineScheduled } from "void";
import { recheckAll } from "../src/streams.ts";

export const cron = "23 3 * * *";

export default defineScheduled(() => recheckAll());
