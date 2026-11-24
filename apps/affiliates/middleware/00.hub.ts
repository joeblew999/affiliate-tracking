// Before anything else: the hub is told what this service follows (src/hub.ts), once in each run
// of the Worker. If the hub can't be reached the request goes on regardless, and the next one
// tries again.
import { defineMiddleware } from "void";
import { following } from "../src/hub.ts";

export default defineMiddleware(async (_c, next) => {
  await following().catch((error: unknown) => console.error("hub: couldn't subscribe", error));
  return next();
});
