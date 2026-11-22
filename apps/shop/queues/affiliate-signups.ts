// New users, passed to the affiliate service (auth.ts sends them). Retried when the call fails.
import { defineQueue } from "void";
import { env as vars } from "void/env";
import { affiliates } from "affiliates/client";

interface Signup {
  userId: string;
  /** The referral cookie's value at sign-up, or null. */
  ref: string | null;
}

export default defineQueue<Signup>(async (batch, env) => {
  const service = affiliates(env.AFFILIATES, vars.AFFILIATES_HOST_TOKEN);
  for (const msg of batch.messages) {
    await service.signup(msg.body);
    msg.ack();
  }
});
