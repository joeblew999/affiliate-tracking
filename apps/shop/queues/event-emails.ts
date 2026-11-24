// The emails saying an event is on sale (routes/api/affiliates/on-sale.ts): a batch of users per
// message, in user id order, each batch queuing the next from where it stopped, so a big list
// never stops halfway and a crash starts again from the last batch. Users who unsubscribed are
// left out. Each batch, and each email, is a step in the control plane
// (src/activity.ts). Sent with Void's email (sendEmail): to Cloudflare in production, to Void's dev inbox
// in development.
import { and, asc, db, eq, gt, isNull } from "void/db";
import type { Event } from "affiliates/client";
import { userTable } from "../.void/better-auth-schema.ts";
import { emailOptOuts } from "../db/schema.ts";
import { price, when } from "../src/events.ts";
import { unsubscribeUrl } from "../src/email-links.ts";
import { defineQueue, queues, sendEmail } from "../src/activity.ts";

/** One batch: the event, the shop's address for its links, and the last user id already done. */
type Message = {
  event: Event;
  siteUrl: string;
  /** The last user id already emailed. */
  after: string | null;
};

const BATCH = 50;

// Handed over as soon as it's sent. Unset, a queue waits up to 5 seconds for more messages to
// make a batch (Void's default, guide/queues.md), and every step through it is that much later.
export const maxBatchTimeout = 0;

export default defineQueue<Message>(async (batch) => {
  for (const msg of batch.messages) {
    const { event, siteUrl, after } = msg.body;
    const users = await db
      .select({ id: userTable.id, email: userTable.email, name: userTable.name })
      .from(userTable)
      .leftJoin(emailOptOuts, eq(emailOptOuts.userId, userTable.id))
      .where(and(isNull(emailOptOuts.userId), after ? gt(userTable.id, after) : undefined))
      .orderBy(asc(userTable.id))
      .limit(BATCH);
    const page = new URL(`/events/${event.id}`, siteUrl).toString();
    for (const user of users) {
      const result = await sendEmail({
        to: user.email,
        subject: `On sale now: ${event.name}`,
        text: [
          `Hi ${user.name || "there"},`,
          "",
          `Tickets for ${event.name} are on sale.`,
          "",
          event.description,
          "",
          `When: ${when(event)}`,
          `Where: ${event.location}`,
          `Ticket: ${price(event.priceCents, event.currency)}`,
          "",
          `Get your ticket: ${page}`,
          "",
          `No more event emails: ${await unsubscribeUrl(siteUrl, user.id)}`,
        ].join("\n"),
      });
      // A request that failed outright is retried by the queue, the whole batch again. A single
      // address refused shows as a failed email step, and the rest still go.
      if (!result.ok && "error" in result)
        throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const last = users.at(-1);
    if (users.length === BATCH && last)
      await queues["event-emails"].send({ event, siteUrl, after: last.id });
    msg.ack();
  }
});
