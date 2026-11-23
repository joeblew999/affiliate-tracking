// The shop's part in the control plane (packages/activity): its work reports itself, and its events
// go straight to the viewers' rooms (routes/activity/[viewer].ws.ts). The shop's code uses the
// wrappers from here (queues, defineQueue, sendEmail), never Void's own.
import type { ActivityEvent } from "activity";
import { getRoom } from "void/ws/server";
import { setupActivity } from "activity/server";
import { append } from "./streams.ts";

/** One event of the shop's work or the service's, for each viewer it concerns. */
export async function record(event: ActivityEvent, viewers: string[]) {
  for (const viewer of viewers) {
    await getRoom("/activity/[viewer]", { params: { viewer } }).actions.record(event);
    await append(viewer, event);
  }
}

setupActivity({ app: "shop", sink: record });

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
