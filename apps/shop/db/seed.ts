// `vp run demo` (both apps) or `vp run shop#db:seed`: resets the shop's local database and makes the
// demo's people (affiliates/demo, shared with the affiliate service's seed) shop accounts that sign
// in with email and DEMO_PASSWORD. Made through Better Auth's own admin API (createUser, called on
// the server), on the seed's database, so the password, the account and the role are Better Auth's.
// Their ids are the demo's own, which the affiliate service's seed links its partners to.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { defineSeed } from "void/seed";
import { DEMO_PASSWORD, demoPeople } from "affiliates/demo";
import { schema } from "../.void/better-auth-schema.ts";

export default defineSeed<typeof import("../.void/better-auth-schema.ts")>(async ({ db }) => {
  let userId = "";
  const auth = betterAuth({
    // Only for making accounts here: nothing is signed with it, so any random one does.
    baseURL: "http://localhost",
    secret: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true },
    plugins: [admin()],
    advanced: {
      database: { generateId: ({ model }) => (model === "user" ? userId : `${userId}-${model}`) },
    },
    telemetry: { enabled: false },
  });
  for (const person of demoPeople) {
    userId = person.userId;
    const createdAt = new Date(Date.now() - (person.partner?.joinedDaysAgo ?? 150) * 86_400_000);
    await auth.api.createUser({
      body: {
        email: person.email,
        password: DEMO_PASSWORD,
        name: person.name,
        role: person.role,
        data: { emailVerified: true, createdAt, updatedAt: createdAt },
      },
    });
  }
  console.log(`demo: ${demoPeople.length} shop accounts, password ${DEMO_PASSWORD}`);
});
