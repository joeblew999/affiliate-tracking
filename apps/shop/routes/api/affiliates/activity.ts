// The affiliate service's work, reported into the control plane over its binding
// (apps/affiliates/src/activity.ts): one event, for the viewers it concerns.
import { defineHandler } from "void";
import { z } from "zod";
import { ActivityEvent } from "activity";
import { record } from "../../../src/activity.ts";

const Recorded = z.object({ event: ActivityEvent, viewers: z.array(z.string()) });

export const POST = defineHandler.withValidator({ body: Recorded })(async (_c, { body }) => {
  await record(body.event, body.viewers);
  return { recorded: true };
});
