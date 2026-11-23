// The shop's part in the control plane (packages/activity): its work reports itself, and its events
// go straight to the viewers' rooms (routes/activity/[viewer].ws.ts). The shop's code uses the
// wrappers from here (queues, defineQueue, sendEmail), never Void's own.
import { getRoom } from "void/ws/server";
import { setupActivity } from "activity/server";

setupActivity({
  app: "shop",
  sink: async (event, viewers) => {
    for (const viewer of viewers)
      await getRoom("/activity/[viewer]", { params: { viewer } }).actions.record(event);
  },
});

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
