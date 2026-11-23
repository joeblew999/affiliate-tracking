// The affiliate service: an event's venue is paid and it's on sale. Every user is emailed about it,
// through a queue (queues/event-emails.ts), a batch at a time.
import { defineHandler } from "void";
import { OnSaleInput, type OnSaleOutput } from "affiliates/client";
import { queues } from "../../../src/activity.ts";

export const POST = defineHandler.withValidator({ body: OnSaleInput })(async (c, { body }) => {
  await queues["event-emails"].send({
    event: body.event,
    siteUrl: new URL(c.req.url).origin,
    after: null,
  });
  return { queued: true } satisfies OnSaleOutput;
});
