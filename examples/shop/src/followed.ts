// What the shop follows of the affiliate service's, over the hub (src/hub.ts), and what it does
// with each event. The hub wakes it at routes/api/hub/wake.ts, and queues/wakes.ts reads on and
// acknowledges (hub/bus).
import { carried } from "activity/server";
import { follower, follows } from "cloudflare-durable-streams/bus";
import { DEMO_RESET_STREAM, DemoReset, ON_SALE_STREAM, OnSale } from "affiliates/client";
import { env } from "void/env";
import { queues } from "./activity.ts";
import { resetDemo } from "./demo-reset.ts";
import { hub } from "./hub.ts";

export const followed = follower({
  hub,
  wakeUrl: new URL("/api/hub/wake", env.SHOP_SITE_URL).href,
  // Each event's part is a step of the action it came from.
  carry: carried,
  subscriptions: {
    "shop-on-sale": follows({
      stream: ON_SALE_STREAM,
      data: OnSale,
      title: "Users told",
      description: "The shop, told of each event going on sale",
      // Every user is emailed about it, through a queue (queues/event-emails.ts), a batch at a
      // time.
      work: async ({ event }) => {
        await queues["event-emails"].send({ event, siteUrl: env.SHOP_SITE_URL, after: null });
      },
    }),
    "shop-demo-reset": follows({
      stream: DEMO_RESET_STREAM,
      data: DemoReset,
      title: "Shop's demo put back",
      description: "The shop, told the demo was put back",
      work: resetDemo,
    }),
  },
});
