// The control plane's streams (durable-objects/streams.ts): one per viewer (a person's user id, or
// "admins"), holding the events of the work that concerns them, in order. The shop's code adds to
// them here. Browsers read them through routes/streams/[...path].ts.
import type { ActivityEvent } from "activity";
import { Streams } from "../durable-objects/streams.ts";

const JSON_TYPE = { "content-type": "application/json" };

/** A stream nobody has read or written for this long is removed (30 days). */
const UNUSED_SECONDS = 30 * 24 * 60 * 60;

/** A viewer's stream: its path, which is also where it's read, and the object that holds it. */
export function streamOf(viewer: string) {
  const path = `/streams/${viewer}`;
  const url = `https://shop${path}`;
  const object = Streams.get(path);
  return {
    /** Make the stream, if it isn't there yet. */
    create: () =>
      object.fetch(url, {
        method: "PUT",
        headers: { ...JSON_TYPE, "stream-ttl": String(UNUSED_SECONDS) },
      }),
    add: (event: ActivityEvent) =>
      object.fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify(event) }),
  };
}

/** One event, added to the end of a viewer's stream; the stream is made by its first event. */
export async function append(viewer: string, event: ActivityEvent) {
  const stream = streamOf(viewer);
  let added = await stream.add(event);
  if (added.status === 404) {
    await stream.create();
    added = await stream.add(event);
  }
  if (!added.ok) throw new Error(`Stream of ${viewer}: ${added.status} ${await added.text()}`);
}
