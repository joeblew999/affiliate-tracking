// Before anything else: the hub is told what this service follows (src/followed.ts), once in each run
// of the Worker.
import { defineMiddleware } from "void";
import { followed } from "../src/followed.ts";

export default defineMiddleware(async (_c, next) => {
  await followed.following();
  return next();
});
