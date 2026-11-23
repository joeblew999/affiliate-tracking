// Writing to the control plane's streams (durable-objects/streams.ts): one event, added to the
// end of a viewer's stream. The stream is made the first time it's written to.
import type { ActivityEvent } from "activity";
import { Streams } from "../durable-objects/streams.ts";

const JSON_TYPE = { "content-type": "application/json" };

export async function append(viewer: string, event: ActivityEvent) {
  // The same path the route reads it at (routes/streams/[...path].ts).
  const path = `/streams/${viewer}`;
  const url = `https://shop${path}`;
  const stream = Streams.get(path);
  const add = () =>
    stream.fetch(url, { method: "POST", headers: JSON_TYPE, body: JSON.stringify(event) });
  let added = await add();
  if (added.status === 404) {
    await stream.fetch(url, { method: "PUT", headers: JSON_TYPE });
    added = await add();
  }
  if (!added.ok) throw new Error(`Stream ${path}: ${added.status} ${await added.text()}`);
}
