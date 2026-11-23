// The shop template's seed in a test run (prepareApps in ./apps.ts, as `void db seed --file`, in the
// template's shop): the shop's own seed (apps/shop/db/seed.ts), then a session for each of the
// demo's people, made by Better Auth's test utils (better-auth.com/docs/plugins/test-utils) on a
// test-only Better Auth over the same database, signed with the run's BETTER_AUTH_SECRET (the one
// every test file's shop runs with). Their cookies go to E2E_SESSIONS, for signInAs (dev/helpers.ts)
// to put in a browser. Every file's shop is copied from this template, so has the same sessions.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, testUtils } from "better-auth/plugins";
import { defineSeed } from "void/seed";
import { demoPeople } from "../apps/affiliates/demo.ts";

export interface Sessions {
  /** By email: the cookies Better Auth's test utils made for that person's session. */
  [email: string]: { name: string; value: string }[];
}

export default defineSeed(async (context) => {
  // This copy's own seed and Better Auth schema (Void generates the schema in each copy).
  const shop = (path: string) => import(join(process.cwd(), path));
  const { default: seed } = await shop("db/seed.ts");
  await seed(context);
  const { schema } = await shop(".void/better-auth-schema.ts");

  const auth = betterAuth({
    baseURL: "http://127.0.0.1",
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(context.db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true },
    plugins: [admin(), testUtils()],
    telemetry: { enabled: false },
  });
  const { test } = await auth.$context;
  const sessions: Sessions = {};
  for (const person of demoPeople) {
    const cookies = await test.getCookies({ userId: person.userId, domain: "127.0.0.1" });
    sessions[person.email] = cookies.map(({ name, value }) => ({ name, value }));
  }
  writeFileSync(process.env.E2E_SESSIONS ?? "", JSON.stringify(sessions));
});
