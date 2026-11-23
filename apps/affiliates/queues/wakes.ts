// A wake from the shop's streams (routes/api/host/wake.ts): for each stream it says has something
// new, read on from what's acknowledged, deal with each event, then acknowledge up to there. If
// anything fails the message is tried again (Void's queue), and the events not yet acknowledged
// are read again, so dealing with an event twice has to be harmless.
import { acknowledge, readOn, type Wake } from "streams/subscriber";
import { runStep } from "activity/server";
import { defineQueue } from "../src/activity.ts";
import { SignedUp, SIGNUPS_STREAM } from "../src/host-contract.ts";
import { shopStreams, STREAMS } from "../src/hub.ts";
import { recordSignupReferral } from "../src/referrals.ts";

/** One event of a stream this service follows. */
async function handle(stream: string, raw: unknown, subscription: string) {
  if (stream !== SIGNUPS_STREAM) return;
  // A new user on the shop: theirs becomes the referring partner's, if a referral brought them.
  // (Recording it again changes nothing: src/referrals.ts.)
  const event = SignedUp.parse(raw);
  const work = () => recordSignupReferral(event.data.userId, event.data.ref);
  // In the control plane it's a step of the sign-up's own action, which the shop left waiting
  // under this name (apps/shop/src/published.ts).
  if (event.activity)
    await runStep(event.activity, `${event.id}:${subscription}`, "Sign-up recorded", work);
  else await work();
}

async function deal(wake: Wake) {
  const acks: { stream: string; offset: string }[] = [];
  for (const stream of wake.streams) {
    if (!stream.has_pending) continue;
    const { events, offset } = await readOn<unknown>(
      shopStreams,
      `${STREAMS}/${stream.path}`,
      stream.acked_offset,
    );
    for (const event of events) await handle(stream.path, event, wake.subscription_id);
    acks.push({ stream: stream.path, offset });
  }
  const outcome = await acknowledge(shopStreams, wake.callback_url, wake, acks);
  // Read further than the subscription has yet heard the stream goes (a write it's still being
  // told of): acknowledge what the wake itself showed; the rest comes with the next wake.
  if (outcome === "ahead")
    await acknowledge(
      shopStreams,
      wake.callback_url,
      wake,
      wake.streams
        .filter((stream) => stream.has_pending)
        .map((stream) => ({ stream: stream.path, offset: stream.tail_offset })),
    );
}

export default defineQueue<Wake>(
  async (batch) => {
    for (const msg of batch.messages) {
      await deal(msg.body);
      msg.ack();
    }
  },
  { step: () => "Wake: read and acknowledge" },
);
