// The shop's part in the control plane (packages/activity): its work reports itself, and each event
// is added to the stream of every viewer it concerns (src/streams.ts). The shop's code uses the
// wrappers from here (queues, defineQueue, sendEmail), never Void's own.
import type { ActivityEvent } from "activity";
import { setupActivity } from "activity/server";
import { append } from "./streams.ts";

/** One event of the shop's work or the service's, for each viewer it concerns. */
export async function record(event: ActivityEvent, viewers: string[]) {
  for (const viewer of viewers) await append(viewer, event);
}

setupActivity({ app: "shop", sink: record });

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
