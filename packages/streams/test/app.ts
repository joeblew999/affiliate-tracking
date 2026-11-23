// The package's Void app (../app) under `vp dev`, for the tests: started, stopped, and started
// again with what it had saved.
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const APP = join(import.meta.dirname, "..", "app");

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Forget what earlier runs saved: Void's local state (the streams and subscriptions). */
export function emptyApp(): void {
  rmSync(join(APP, ".void", "v3"), { recursive: true, force: true });
}

export interface App {
  url: string;
  stop: () => Promise<void>;
}

/** Start the app; ready once it says where it's listening. `port`: the same address as before. */
export async function startApp(port?: number): Promise<App> {
  const at = port ?? (await freePort());
  const url = `http://127.0.0.1:${at}`;
  const child: ChildProcess = spawn(
    "vp",
    ["dev", "--host", "127.0.0.1", "--port", String(at), "--strictPort"],
    {
      cwd: APP,
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
    child.once("exit", (code) => reject(new Error(`the app stopped (${code}):\n${log}`)));
  });
  return {
    url,
    // The app and everything it started (it leads its own process group), and wait for it to go.
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || !child.pid) return resolve();
        child.once("exit", () => resolve());
        process.kill(-child.pid, "SIGTERM");
      }),
  };
}
