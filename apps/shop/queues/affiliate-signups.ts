// New users, passed to the affiliate service (auth.ts sends them). Each is a step of its sign-up in
// the control plane (src/activity.ts): done, or failed with the error, which Void then tries again.
import { env as vars } from "void/env";
import { affiliates, type Signup } from "affiliates/client";
import { defineQueue } from "../src/activity.ts";

/** A new user: the affiliate service's sign-up call, as its contract defines it. */
type Message = Signup;

export default defineQueue<Message>(async (batch, env) => {
  const service = affiliates(env.AFFILIATES, vars.AFFILIATES_HOST_TOKEN);
  for (const msg of batch.messages) {
    await service.signup(msg.body);
    msg.ack();
  }
});
