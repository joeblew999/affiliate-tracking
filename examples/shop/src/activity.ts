// The shop's part in the control plane (examples/activity): its work reports itself, and each event
// is added to the stream of every viewer it concerns, in the hub (src/hub.ts). The shop's code
// uses the wrappers from here (queues, defineQueue, sendEmail), never Void's own.
import { setupActivity } from "activity/server";
import { hub } from "./hub.ts";

setupActivity({
  app: "shop",
  sink: async (event, viewers) => {
    await Promise.all(viewers.map((viewer) => hub.append(viewer, [event])));
  },
});

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
