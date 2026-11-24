// The service's part in the control plane (packages/activity): its work reports itself, and each
// event is added to the stream of every viewer it concerns, in the hub (src/hub.ts). Where an
// action starts is marked, so a page can start from the latest actions. The service's code uses
// the wrappers from here (queues, defineQueue, defineScheduled), never Void's own.
import { stateStreamOf } from "activity";
import { setupActivity } from "activity/server";
import { hub } from "./hub.ts";

setupActivity({
  app: "affiliates",
  sink: async (event, viewers) => {
    await hub.append(viewers, [event], event.type === "started");
  },
  // What a step did (src/outcomes.ts), on the same viewers' state streams.
  state: async (changes, viewers) => {
    await hub.append(viewers.map(stateStreamOf), changes);
  },
});

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
