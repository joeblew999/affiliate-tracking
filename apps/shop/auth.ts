// The shop's sign-in: Void's Better Auth. The affiliate service keeps no users; it asks this app who
// a session cookie belongs to. Deployed, the cookie is set for the parent domain so the service's
// subdomain receives it (crossSubDomainCookies, step 6 of the plan); on localhost cookies are already
// shared across ports.
import { defineAuth } from "void/auth";
import { queues } from "void/queues";
import { referralFrom } from "affiliates/client";

export default defineAuth(({ defaults }) => ({
  ...defaults,
  databaseHooks: {
    user: {
      create: {
        // Tell the affiliate service, through a queue (queues/affiliate-signups.ts): a sign-up never
        // waits on it or fails because of it, and a failed call is retried.
        after: async (user, ctx) => {
          await queues["affiliate-signups"].send({
            userId: user.id,
            ref: referralFrom(ctx?.headers?.get("cookie")),
          });
        },
      },
    },
  },
}));
