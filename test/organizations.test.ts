// What the hub adds to the protocol, which the protocol's own tests can't know: organizations kept
// apart (a key reaches only its organization's streams and subscriptions, whatever they're
// called), and delivery by one route (the hub sends a Worker each batch of events; its answer
// acknowledges). Against the hub itself under `vp dev`, with keys made through its Better Auth.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { localAdmin } from "../scripts/hub-dev.ts";
import { hubKey } from "../scripts/key.ts";
import { startApp, type App } from "./app.ts";

let app: App;
let one: string;
let other: string;
const run = Date.now();
const JSON_TYPE = { "content-type": "application/json" };

beforeAll(async () => {
  app = await startApp();
  const admin = localAdmin();
  one = await hubKey({ url: app.url, ...admin, name: "one", organization: `one-${run}` });
  other = await hubKey({ url: app.url, ...admin, name: "other", organization: `other-${run}` });
});
afterAll(() => app.stop());

const as = (key: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${key}`,
  ...extra,
});
const stream = (name: string) => `${app.url}/v1/stream/${name}`;

test("a stream of one organization isn't there for another, and the same name is another stream", async () => {
  const name = `orders/paid-${run}`;
  await fetch(stream(name), { method: "PUT", headers: as(one, JSON_TYPE) });
  await fetch(stream(name), { method: "POST", headers: as(one, JSON_TYPE), body: '{"of":"one"}' });

  expect((await fetch(`${stream(name)}?offset=-1`, { headers: as(other) })).status).toBe(404);
  expect(
    (await fetch(stream(name), { method: "POST", headers: as(other, JSON_TYPE), body: "{}" }))
      .status,
  ).toBe(404);
  expect((await fetch(stream(name), { method: "DELETE", headers: as(other) })).status).toBe(404);

  await fetch(stream(name), { method: "PUT", headers: as(other, JSON_TYPE) });
  await fetch(stream(name), {
    method: "POST",
    headers: as(other, JSON_TYPE),
    body: '{"of":"other"}',
  });
  const read = async (key: string) =>
    (await fetch(`${stream(name)}?offset=-1`, { headers: as(key) })).json();
  expect(await read(one)).toEqual([{ of: "one" }]);
  expect(await read(other)).toEqual([{ of: "other" }]);
});

test("a subscription of one organization isn't there for another, and isn't told of its writes", async () => {
  const id = `follower-${run}`;
  const name = `events/${run}`;
  const subscription = `${app.url}/v1/stream/__ds/subscriptions/${id}`;
  const made = await fetch(subscription, {
    method: "PUT",
    headers: as(one, JSON_TYPE),
    body: JSON.stringify({ type: "pull-wake", streams: [name], wake_stream: `wakes/${run}` }),
  });
  expect(made.status).toBe(201);
  expect((await fetch(subscription, { headers: as(other) })).status).toBe(404);
  // The other organization writes a stream of the same name: nobody of the first is told.
  await fetch(stream(name), { method: "PUT", headers: as(other, JSON_TYPE) });
  const written = await fetch(stream(name), {
    method: "POST",
    headers: as(other, JSON_TYPE),
    body: "{}",
  });
  expect(written.headers.get("stream-subscriptions")).toBeNull();
});

test("a key doesn't open another organization's streams at their inside address", async () => {
  const inside = `${app.url}/v1/o/not-this-keys-organization/stream/anything`;
  expect((await fetch(inside, { headers: as(one) })).status).toBe(403);
  expect((await fetch(inside)).status).toBe(401);
});

/** A Worker's route for deliveries: answers each with the next of `answers`, then 200. */
async function receiver(answers: number[] = []) {
  const got: { secret: string | undefined; body: { stream: string; events: unknown[] } }[] = [];
  let heard: (() => void) | undefined;
  const server: Server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk));
    request.on("end", () => {
      got.push({
        secret: request.headers["x-hub-secret"] as string | undefined,
        body: JSON.parse(text) as { stream: string; events: unknown[] },
      });
      response.statusCode = answers.shift() ?? 200;
      response.end("{}");
      heard?.();
    });
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`,
    got,
    /** Until `count` deliveries have come. */
    async until(count: number) {
      while (got.length < count) await new Promise<void>((resolve) => (heard = resolve));
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("delivery by one route: the hub sends the events, a 200 acknowledges, anything else is sent again", async () => {
  const name = `deliveries/${run}`;
  const worker = await receiver([500]);
  try {
    const asked = await fetch(`${app.url}/v1/push/receipts-${run}`, {
      method: "PUT",
      headers: as(one, JSON_TYPE),
      body: JSON.stringify({ streams: [name], url: worker.url }),
    });
    expect(asked.status).toBe(200);
    const { secret } = (await asked.json()) as { secret: string };

    await fetch(stream(name), { method: "PUT", headers: as(one, JSON_TYPE) });
    await fetch(stream(name), { method: "POST", headers: as(one, JSON_TYPE), body: '{"n":1}' });
    // Refused the first time (500): sent again, the same events.
    await worker.until(2);
    expect(worker.got.map((d) => d.body.events)).toEqual([[{ n: 1 }], [{ n: 1 }]]);
    expect(worker.got.every((d) => d.secret === secret)).toBe(true);
    expect(worker.got[0]?.body.stream).toBe(name);

    // Acknowledged: the next delivery has only what's new.
    await fetch(stream(name), { method: "POST", headers: as(one, JSON_TYPE), body: '{"n":2}' });
    await worker.until(3);
    expect(worker.got[2]?.body.events).toEqual([{ n: 2 }]);
  } finally {
    await fetch(`${app.url}/v1/push/receipts-${run}`, { method: "DELETE", headers: as(one) });
    await worker.close();
  }
});
