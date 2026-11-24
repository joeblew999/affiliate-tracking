// The hub (the Void app at the repo's root) under `vp dev`, for its tests: started, stopped, and
// started again with what it had saved. Its database is migrated first (Void applies migrations by
// hand in development). Every request the tests make to it carries its HUB_TOKEN, as a worker's
// do (the hub refuses any other), read from its .env: run `vp run setup` once first.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const HUB = join(import.meta.dirname, "..");

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The hub's token, from its .env. */
function hubToken(): string {
  const file = join(HUB, ".env");
  const token = existsSync(file)
    ? readFileSync(file, "utf8").match(/^HUB_TOKEN=(.*)$/m)?.[1]
    : undefined;
  if (!token) throw new Error("The hub's .env has no HUB_TOKEN: run `vp run setup` first");
  return token;
}

/**
 * Every request to the hub at `base` carries the token, unless it has an authorization of its own
 * (a subscriber's answer to a wake carries the wake's). The protocol's tests make their requests
 * with the global fetch, and take no headers of their own.
 */
function authorize(base: string, token: string): void {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base)) return original(input, init);
    const headers = new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return original(input, { ...init, headers });
  };
}

export interface App {
  url: string;
  stop: () => Promise<void>;
}

/** Start the hub; ready once it says where it's listening. `port`: the same address as before. */
export async function startApp(port?: number): Promise<App> {
  const token = hubToken();
  const migrated = spawnSync("vp", ["exec", "void", "db", "migrate"], {
    cwd: HUB,
    encoding: "utf8",
  });
  if (migrated.status !== 0)
    throw new Error(`the hub's migrations failed:\n${migrated.stdout}${migrated.stderr}`);
  const at = port ?? (await freePort());
  const url = `http://127.0.0.1:${at}`;
  const child: ChildProcess = spawn(
    "vp",
    ["dev", "--host", "127.0.0.1", "--port", String(at), "--strictPort"],
    {
      cwd: HUB,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, VOID_INSPECTOR_PORT: "false" },
    },
  );
  await new Promise<void>((resolve, reject) => {
    let log = "";
    const heard = (chunk: Buffer) => {
      log += stripVTControlCharacters(chunk.toString());
      if (log.includes(`${url}/`)) resolve();
    };
    child.stdout?.on("data", heard);
    child.stderr?.on("data", heard);
    child.once("exit", (code) => reject(new Error(`the hub stopped (${code}):\n${log}`)));
  });
  authorize(url, token);
  return {
    url,
    // The hub and everything it started (it leads its own process group), and wait for it to go.
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || !child.pid) return resolve();
        child.once("exit", () => resolve());
        process.kill(-child.pid, "SIGTERM");
      }),
  };
}
