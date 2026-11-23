// What the protocol's own subscription tests (conformance.test.ts) don't try, and a subscription
// has to get right all the same (PROTOCOL.md, section 7): a lease running out, a delivery that
// fails, a subscription deleted mid-wake, following a stream from where it ends, a pattern that
// could cover any stream, and the app stopping with a wake still to send. Against the package's
// Void app under `vp dev`, with a real HTTP server as the subscriber.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { emptyApp, startApp, type App } from "./app.ts";

let app: App;
beforeAll(async () => {
  emptyApp();
  app = await startApp();
});
afterAll(() => app.stop());

const stream = (path: string) => `${app.url}/v1/stream/${path}`;
const subscriptionUrl = (id: string) => stream(`__ds/subscriptions/${id}`);
const JSON_TYPE = { "content-type": "application/json" };
let count = 0;
/** A name no other test, or run, has used. */
const unique = (prefix: string) => `${prefix}-${Date.now()}-${count++}`;

interface Wake {
  subscription_id: string;
  wake_id: string;
  generation: number;
  callback_url: string;
  callback_token: string;
  streams: { path: string; acked_offset: string; tail_offset: string; has_pending: boolean }[];
}

/**
 * A subscriber: an HTTP server the wakes are sent to. It answers each with the next of `answers`
 * (a status and a body), then with 200 and an empty object.
 */
async function subscriber(answers: { status: number; body?: unknown }[] = [], port = 0) {
  const wakes: Wake[] = [];
  let heard: (() => void) | undefined;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      wakes.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Wake);
      const reply = answers.shift() ?? { status: 200, body: {} };
      response.writeHead(reply.status, JSON_TYPE);
      response.end(JSON.stringify(reply.body ?? {}));
      heard?.();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const at = (server.address() as AddressInfo).port;
  return {
    port: at,
    url: `http://127.0.0.1:${at}/wake`,
    wakes,
    /** The nth wake to arrive (from 1), once it has. The test's own timeout ends the wait. */
    async wake(n: number): Promise<Wake> {
      while (wakes.length < n) await new Promise<void>((resolve) => (heard = resolve));
      return wakes[n - 1] as Wake;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const put = (url: string, body: unknown) =>
  fetch(url, { method: "PUT", headers: JSON_TYPE, body: JSON.stringify(body) });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { ...JSON_TYPE, ...headers }, body: JSON.stringify(body) });

/** Acknowledge a wake through its callback. */
const callback = (wake: Wake, body: Record<string, unknown>) =>
  post(
    wake.callback_url,
    { wake_id: wake.wake_id, generation: wake.generation, ...body },
    { authorization: `Bearer ${wake.callback_token}` },
  );

async function read(id: string) {
  const response = await fetch(subscriptionUrl(id));
  return (await response.json()) as {
    status: string;
    streams: { path: string; link_type: string; acked_offset: string }[];
  };
}

test("a wake nobody acknowledges is sent again when its lease runs out, as a new wake", async () => {
  const to = await subscriber();
  const id = unique("lease");
  const path = `${unique("lease")}/a`;
  try {
    const made = await put(subscriptionUrl(id), {
      type: "webhook",
      pattern: `${path.split("/")[0]}/*`,
      webhook: { url: to.url },
      lease_ttl_ms: 1000,
    });
    expect(made.status).toBe(201);
    await put(stream(path), { n: 1 });

    const first = await to.wake(1);
    const second = await to.wake(2);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.wake_id).not.toBe(first.wake_id);
    expect(second.streams.find((s) => s.path === path)?.has_pending).toBe(true);

    // The first wake is over: acknowledging it now is refused, the current one is taken.
    const tail = second.streams.find((s) => s.path === path)?.tail_offset;
    const acks = { acks: [{ stream: path, offset: tail }], done: true };
    const late = await callback(first, acks);
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: { code: string } }).error.code).toBe("FENCED");
    // (The lease may have run out again meanwhile; whichever wake is current is the one to answer.)
    const current = to.wakes.at(-1) as Wake;
    const done = await callback(current, acks);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, next_wake: false });
    expect((await read(id)).streams.find((s) => s.path === path)?.acked_offset).toBe(tail);
  } finally {
    await fetch(subscriptionUrl(id), { method: "DELETE" });
    await to.close();
  }
});

test("a delivery the subscriber refuses is tried again, until it's taken", async () => {
  const to = await subscriber([{ status: 500 }, { status: 200, body: { done: true } }]);
  const id = unique("retry");
  const path = `${unique("retry")}/a`;
  try {
    await put(subscriptionUrl(id), {
      type: "webhook",
      streams: [path],
      webhook: { url: to.url },
      lease_ttl_ms: 60_000,
    });
    await put(stream(path), { n: 1 });
    const refused = await to.wake(1);
    const taken = await to.wake(2);
    // The same wake, sent again: a long lease, so it's the retry that brought it, not a new wake.
    expect(taken.wake_id).toBe(refused.wake_id);
    const tail = taken.streams.find((s) => s.path === path)?.tail_offset;
    // "done" in the answer acknowledges everything the wake showed.
    await expect
      .poll(async () => (await read(id)).streams.find((s) => s.path === path)?.acked_offset)
      .toBe(tail);
    expect((await read(id)).status).toBe("active");
  } finally {
    await fetch(subscriptionUrl(id), { method: "DELETE" });
    await to.close();
  }
});

test("a stream followed by name is followed from where it ends: only what comes after wakes", async () => {
  const to = await subscriber();
  const id = unique("named");
  const path = `${unique("named")}/a`;
  try {
    const before = await put(stream(path), { n: 1 });
    const start = before.headers.get("stream-next-offset");
    await put(subscriptionUrl(id), {
      type: "webhook",
      streams: [path],
      webhook: { url: to.url },
      lease_ttl_ms: 60_000,
    });
    expect((await read(id)).streams).toEqual([
      { path, link_type: "explicit", acked_offset: start },
    ]);
    await post(stream(path), { n: 2 });
    const wake = await to.wake(1);
    const told = wake.streams.find((s) => s.path === path);
    expect(told?.acked_offset).toBe(start);
    expect(told?.has_pending).toBe(true);
  } finally {
    await fetch(subscriptionUrl(id), { method: "DELETE" });
    await to.close();
  }
});

test("a pattern that could cover any stream still hears of a new one", async () => {
  const to = await subscriber([{ status: 200, body: { done: true } }]);
  const id = unique("any");
  const last = unique("leaf");
  const path = `${unique("anywhere")}/${last}`;
  try {
    await put(subscriptionUrl(id), {
      type: "webhook",
      pattern: `*/${last}`,
      webhook: { url: to.url },
      lease_ttl_ms: 60_000,
    });
    await put(stream(path), { n: 1 });
    const wake = await to.wake(1);
    expect(wake.streams.map((s) => s.path)).toEqual([path]);
  } finally {
    await fetch(subscriptionUrl(id), { method: "DELETE" });
    await to.close();
  }
});

test("a deleted subscription is over: its wake can't be acknowledged, and it's told of nothing more", async () => {
  const to = await subscriber();
  const id = unique("gone");
  const path = `${unique("gone")}/a`;
  try {
    await put(subscriptionUrl(id), {
      type: "webhook",
      streams: [path],
      webhook: { url: to.url },
      lease_ttl_ms: 60_000,
    });
    await put(stream(path), { n: 1 });
    const wake = await to.wake(1);
    expect((await fetch(subscriptionUrl(id), { method: "DELETE" })).status).toBe(204);
    expect((await fetch(subscriptionUrl(id))).status).toBe(404);
    const late = await callback(wake, { done: true });
    expect(late.status).toBe(404);

    // A write after it's gone, then a new subscription on the same stream: the new one's wake is
    // the next thing the subscriber hears, so the deleted one sent nothing in between.
    await post(stream(path), { n: 2 });
    const again = unique("after");
    await put(subscriptionUrl(again), {
      type: "webhook",
      streams: [path],
      webhook: { url: to.url },
      lease_ttl_ms: 60_000,
    });
    await post(stream(path), { n: 3 });
    expect((await to.wake(2)).subscription_id).toBe(again);
    await fetch(subscriptionUrl(again), { method: "DELETE" });
  } finally {
    await to.close();
  }
});

test("a wake still to send is sent after the app stops and starts again", async () => {
  // A subscriber that's down: its address is known, nothing is listening there yet.
  const down = await subscriber();
  const { port, url } = down;
  await down.close();
  const id = unique("restart");
  const path = `${unique("restart")}/a`;
  await put(subscriptionUrl(id), {
    type: "webhook",
    streams: [path],
    webhook: { url },
    lease_ttl_ms: 60_000,
  });
  await put(stream(path), { n: 1 });
  // The first try has failed (nobody there) once the subscription says so.
  await expect.poll(async () => (await read(id)).status).toBe("failed");

  const at = Number(new URL(app.url).port);
  await app.stop();
  const to = await subscriber([{ status: 200, body: { done: true } }], port);
  app = await startApp(at);
  try {
    const wake = await to.wake(1);
    expect(wake.subscription_id).toBe(id);
    expect(wake.streams.find((s) => s.path === path)?.has_pending).toBe(true);
    await expect.poll(async () => (await read(id)).status).toBe("active");
  } finally {
    await fetch(subscriptionUrl(id), { method: "DELETE" });
    await to.close();
  }
});
