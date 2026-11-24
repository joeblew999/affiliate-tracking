// The shop's part in the control plane (packages/activity): its work reports itself, and each event
// is added to the stream of every viewer it concerns, in the hub (src/hub.ts). Where an action
// starts is marked, so a page can start from the latest actions. The shop's code uses the wrappers
// from here (queues, defineQueue, sendEmail), never Void's own.
import { setupActivity } from "activity/server";
import { hub } from "./hub.ts";

setupActivity({
  app: "shop",
  sink: async (event, viewers) => {
    await hub.append(viewers, event, event.type === "started");
  },
});

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
