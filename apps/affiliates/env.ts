import { defineEnv, string } from "void/env";

export default defineEnv({
  // The secret the host app sends with every call to /api/host/* (src/host-api.ts). The same value
  // is in the host's own env. Locally `vp run setup` writes it into both apps' .env.
  AFFILIATES_HOST_TOKEN: string(),
});
