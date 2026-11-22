// Global setup for the dev-server tests (`vp run test:dev`): both apps running as a developer runs
// them (`vp run dev`), with Void's real local D1, queues, Better Auth and the service bindings. No
// fakes. Uses your own `vp run dev` if both apps answer; else starts one, waits until both print
// their address, and stops it at the end.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import type { TestProject } from "vite-plus/test/node";

export const SHOP = "http://localhost:5173";
export const AFFILIATES = "http://localhost:5174";

declare module "vite-plus/test" {
  interface ProvidedContext {
    hostToken: string;
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function startDev(): Promise<ChildProcess> {
  const child = spawn("vp", ["run", "dev"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const waiting = new Set(["5173", "5174"]);
  let log = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vp run dev didn't start:\n${log}`)), 180_000);
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      for (const port of waiting)
        if (new RegExp(String.raw`Local:\s+http://localhost:${port}/`).test(log))
          waiting.delete(port);
      if (waiting.size === 0) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`vp run dev exited (${code}):\n${log}`)));
  });
}

/**
 * Ready means a request through both apps works, not just two printed addresses: on its first
 * requests Vite pre-bundles dependencies and reloads, which drops calls in flight (seen
 * 2026-11-22). /api/me with a cookie makes the service ask the shop through the binding.
 */
async function untilReady(): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const res = await fetch(`${AFFILIATES}/api/me`, {
        headers: { cookie: "better-auth.session_token=warm-up" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok && (await res.json()).user === null) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("the apps didn't become ready within 3 minutes");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export default async function setup(project: TestProject) {
  const running = (await answers(SHOP)) && (await answers(AFFILIATES));
  const ours = running ? undefined : await startDev();
  await untilReady();
  const env = readFileSync("apps/affiliates/.env", "utf8");
  const token = env.match(/^AFFILIATES_HOST_TOKEN=(.+)$/m)?.[1];
  if (!token)
    throw new Error("apps/affiliates/.env has no AFFILIATES_HOST_TOKEN: run `vp run setup`");
  project.provide("hostToken", token);
  return () => {
    if (ours?.pid) process.kill(-ours.pid, "SIGTERM");
  };
}
