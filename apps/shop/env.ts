import { defineEnv, string } from "void/env";

export default defineEnv({
  // Sent with every call to the affiliate service (its middleware/01.host-api.ts checks it). The
  // same value is in that app's env. Locally `vp run setup` writes it into both apps' .env.
  AFFILIATES_HOST_TOKEN: string(),
});
