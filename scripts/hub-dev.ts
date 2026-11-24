// The hub under `vp dev`, for scripts and tests that need it running: its database migrated
// (Void applies migrations by hand in development), started on a free port (or a given one), and
// stopped again. And its local admin, from its .env (`vp run setup` writes it), for making keys.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

/** The hub: the repo's root. */
export const HUB = join(import.meta.dirname, "..");

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The hub's local admin: the first of its ADMIN_EMAILS, and the password setup made for it. */
export function localAdmin(hub = HUB): { email: string; password: string } {
  const file = join(hub, ".env");
  const env = existsSync(file) ? readFileSync(file, "utf8") : "";
  const email = env.match(/^ADMIN_EMAILS=([^,\n]+)/m)?.[1]?.trim();
  const password = env.match(/^HUB_ADMIN_PASSWORD=(.+)$/m)?.[1]?.trim();
  if (!email || !password)
    throw new Error(
      "The hub's .env has no ADMIN_EMAILS and HUB_ADMIN_PASSWORD: run `vp run setup`",
    );
  return { email, password };
}

export interface RunningHub {
  url: string;
  stop: () => Promise<void>;
}

/** Start the hub; ready once it says where it's listening. `port`: the same address as before. */
export async function startHub(port?: number, hub = HUB): Promise<RunningHub> {
  const migrated = spawnSync("vp", ["exec", "void", "db", "migrate"], {
    cwd: hub,
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
      cwd: hub,
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
