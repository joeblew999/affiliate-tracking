// The service's part in the control plane (packages/activity): its work reports itself, and each
// event goes to the shop, which holds the viewers' streams (apps/shop/src/streams.ts),
// over the binding it already uses to tell the shop things. The service's code uses the wrappers
// from here (queues, defineQueue, defineScheduled), never Void's own.
import { env as bindings } from "cloudflare:workers";
import { env } from "void/env";
import { setupActivity } from "activity/server";

setupActivity({
  app: "affiliates",
  sink: async (event, viewers) => {
    const res = await bindings.HOST.fetch(
      new Request(new URL("/api/affiliates/activity", env.HOST_SITE_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.AFFILIATES_HOST_TOKEN}`,
        },
        body: JSON.stringify({ event, viewers }),
      }),
    );
    if (!res.ok) throw new Error(`shop activity: ${res.status} ${await res.text()}`);
  },
});

export { activityHeaders, defineQueue, defineScheduled, queues, sendEmail } from "activity/server";
