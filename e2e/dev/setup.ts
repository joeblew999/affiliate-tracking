// Global setup for `vp run test:dev`: both apps migrated and seeded with the demo fixtures once
// (../apps.ts); each test file then starts its own copy of them (each-file.ts).
import type { TestProject } from "vite-plus/test/node";
import { prepareApps, removeApps, type Template } from "../apps.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    template: Template;
    /** More settings for both apps, for every file (the Stripe tests' key, say). */
    appEnv: Record<string, string>;
  }
}

export default async function setup(project: TestProject) {
  const template = await prepareApps();
  project.provide("template", template);
  project.provide("appEnv", {});
  return () => removeApps(template);
}
