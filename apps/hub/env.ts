import { defineEnv, string } from "void/env";

export default defineEnv({
  // Sent by every worker that calls the hub (middleware/01.workers.ts checks it). The same value
  // is in each of those workers' env.
  HUB_TOKEN: string(),
});
