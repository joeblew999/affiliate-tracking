// `vp run demo` (both apps) or `vp run shop#db:seed`: resets the shop's local database and makes the
// demo's people (affiliates/demo, shared with the affiliate service's seed) shop accounts that sign
// in with email and DEMO_PASSWORD, through Better Auth as usual. The admin among them runs the
// affiliate program.
import { hashPassword } from "better-auth/crypto";
import { defineSeed } from "void/seed";
import { DEMO_PASSWORD, demoPeople } from "affiliates/demo";
import { accountTable, userTable } from "../.void/better-auth-schema.ts";

export default defineSeed<typeof import("../.void/better-auth-schema.ts")>(async ({ db }) => {
  const password = await hashPassword(DEMO_PASSWORD);
  for (const person of demoPeople) {
    const createdAt = new Date(Date.now() - (person.partner?.joinedDaysAgo ?? 150) * 86_400_000);
    await db.insert(userTable).values({
      id: person.userId,
      name: person.name,
      email: person.email,
      emailVerified: true,
      role: person.role,
      createdAt,
      updatedAt: createdAt,
    });
    await db.insert(accountTable).values({
      id: `${person.userId}-credential`,
      accountId: person.userId,
      providerId: "credential",
      userId: person.userId,
      password,
      createdAt,
      updatedAt: createdAt,
    });
  }
  console.log(`demo: ${demoPeople.length} shop accounts, password ${DEMO_PASSWORD}`);
});
