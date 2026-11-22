// Global setup for the dev-server tests (`vp run test:dev`): both apps running as a developer runs
// them, with Void's real local D1, queues, both apps' Better Auth and the service binding. No fakes. Uses your
// own `vp run dev` if both apps answer; else starts one and stops it at the end.
import type { TestProject } from "vite-plus/test/node";
import { AFFILIATES, answers, appEnv, SHOP, startDev, stop, untilReady } from "../servers.ts";

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
  project.provide("hostToken", appEnv("affiliates", "AFFILIATES_HOST_TOKEN"));
  // Stripe events go to the shop's Better Auth Stripe webhook, signed with its secret.
  project.provide("webhookSecret", appEnv("shop", "STRIPE_WEBHOOK_SECRET"));
  return () => stop(ours);
}
