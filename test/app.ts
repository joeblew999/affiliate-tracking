// The hub (the Void app at the repo's root) under `vp dev`, for its tests: started, stopped, and
// started again with what it had saved (scripts/hub-dev.ts). Every request the tests make to it
// carries an API key, as a Worker's does (the hub refuses any other): one made for the run, by
// the hub's local admin, through its Better Auth (scripts/key.ts). Run `vp run setup` once first.
import { localAdmin, startHub } from "../scripts/hub-dev.ts";
import { hubKey } from "../scripts/key.ts";

/**
 * Every request to the hub's streams at `base` carries the key, unless it has an authorization of
 * its own (a subscriber's answer to a wake carries the wake's). The protocol's tests make their
 * requests with the global fetch, and take no headers of their own.
 */
function authorize(base: string, key: string): void {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${base}/v1/stream`)) return original(input, init);
    const headers = new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${key}`);
    return original(input, { ...init, headers });
  };
}

export interface App {
  url: string;
  stop: () => Promise<void>;
}

let key: string | undefined;

/** Start the hub. `port`: the same address as before (the key made the first time still holds). */
export async function startApp(port?: number): Promise<App> {
  const hub = await startHub(port);
  key ??= await hubKey({ url: hub.url, ...localAdmin(), name: "tests", organization: "tests" });
  authorize(hub.url, key);
  return hub;
}
