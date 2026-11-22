// Global setup for `vp run test:dev`: both apps started fresh (../apps.ts), with Void's real local
// D1, queues, the shop's Better Auth and the service binding, and stopped after. No fakes.
import type { TestProject } from "vite-plus/test/node";
import { startApps } from "../apps.ts";

declare module "vite-plus/test" {
  interface ProvidedContext {
    shop: string;
    affiliates: string;
    hostToken: string;
    webhookSecret: string;
    cronToken: string;
  }
}

export default async function setup(project: TestProject) {
  const apps = await startApps();
  project.provide("shop", apps.shop);
  project.provide("affiliates", apps.affiliates);
  project.provide("hostToken", apps.hostToken);
  project.provide("webhookSecret", apps.webhookSecret);
  project.provide("cronToken", apps.cronToken());
  return apps.stop;
}
