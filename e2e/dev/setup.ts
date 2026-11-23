// Global setup for `vp run test:dev`: both apps seeded with the demo fixtures and started, once
// for the whole run (../apps.ts). Every test file uses that pair (each-file.ts).
import type { TestProject } from "vite-plus/test/node";
import { startSystem, type System } from "../apps.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    /** The run's two apps. Not there in a suite that wasn't asked for. */
    system: System | null;
  }
}

export default async function setup(project: TestProject) {
  const { system, stop } = await startSystem();
  project.provide("system", system);
  return stop;
}
