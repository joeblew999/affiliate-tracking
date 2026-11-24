import { defineEnv, string } from "void/env";

export default defineEnv({
  // Who runs this hub: their emails, comma-separated. Only they can make an account on it
  // (auth.ts); they make its organizations and its keys.
  ADMIN_EMAILS: string(),
});
