// Global setup for the dev-server tests (`vp run test:dev`): both apps running as a developer runs
// them, with Void's real local D1, queues, Better Auth and the service bindings. No fakes. Uses your
// own `vp run dev` if both apps answer; else starts one and stops it at the end.
import type { TestProject } from "vite-plus/test/node";
import { AFFILIATES, answers, SHOP, serviceEnv, startDev, stop, untilReady } from "../servers";

export { AFFILIATES, SHOP };

declare module "vite-plus/test" {
  interface ProvidedContext {
    hostToken: string;
    webhookSecret: string;
  }
}

export default async function setup(project: TestProject) {
  const running = (await answers(SHOP)) && (await answers(AFFILIATES));
  const ours = running ? undefined : await startDev();
  await untilReady();
  project.provide("hostToken", serviceEnv("AFFILIATES_HOST_TOKEN"));
  project.provide("webhookSecret", serviceEnv("STRIPE_WEBHOOK_SECRET"));
  return () => stop(ours);
}
