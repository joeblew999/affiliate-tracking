// Both apps, run as a developer runs them (`vp run dev`), for the test suites' global setups.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

export const SHOP = "http://localhost:5173";
export const AFFILIATES = "http://localhost:5174";

/** Whether something serves url. Nothing there refuses at once; a dev server's first page can be slow. */
export async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * `vp run dev`, with extra environment if given (it beats the apps' .env); resolves once both print
 * their address. Its output goes to this process's stderr, so a failing run shows what the apps said.
 */
export function startDev(env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn("vp", ["run", "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, ...env },
  });
  const waiting = new Set(["5173", "5174"]);
  let log = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      process.stderr.write(chunk);
      // Without its colours: with CI set (as on GitHub), Vite colours the address mid-line.
      log += stripVTControlCharacters(chunk.toString());
      for (const port of waiting) {
        if (new RegExp(String.raw`Local:\s+http://localhost:${port}/`).test(log))
          waiting.delete(port);
      }
      if (waiting.size === 0) resolve(child);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vp run dev exited (${code}):\n${log}`)));
  });
}

/**
 * Ready means the service can ask the shop who's signed in (its /api/auth, through the binding),
 * not just two printed addresses: on its first requests Vite pre-bundles dependencies and reloads,
 * which drops calls in flight (seen 2026-11-22). The test runner's hook timeout ends the wait.
 */
export async function untilReady(): Promise<void> {
  for (;;) {
    try {
      const res = await fetch(`${AFFILIATES}/api/auth/get-session`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** A value from an app's local .env (written by `vp run setup`). */
export function appEnv(app: "affiliates" | "shop", key: string): string {
  const env = readFileSync(`apps/${app}/.env`, "utf8");
  const found = env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1];
  if (!found) throw new Error(`apps/${app}/.env has no ${key}: run \`vp run setup\``);
  return found;
}

export function stop(child: ChildProcess | undefined): void {
  if (child?.pid) process.kill(-child.pid, "SIGTERM");
}
