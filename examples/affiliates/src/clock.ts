// The service's clock: every "now" it uses comes from here. In production, the real time. With
// AFFILIATES_NOW set (tests, and the local demo), it reads that instant at AFFILIATES_NOW_FROM (a
// real time, in ms) and runs on from there: the same pinned day on every run, while keeping the
// order of things done within it. The demo fixtures (demo.ts) are dated from the same instant.
import { env } from "void/env";

export function now(): number {
  if (!env.AFFILIATES_NOW) return Date.now();
  const from = env.AFFILIATES_NOW_FROM ?? Date.now();
  return Date.parse(env.AFFILIATES_NOW) + (Date.now() - from);
}
