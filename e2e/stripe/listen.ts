// Stripe's own webhook delivery to this test file's shop: the Stripe CLI's `stripe listen`
// (docs.stripe.com/cli/listen; the local testing Better Auth's Stripe plugin documents), forwarding
// the events the shop's webhook takes, signed by Stripe with the secret the shop runs with
// (setup.ts). Nothing is sent but what Stripe sends.
import { spawn, type ChildProcess } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

/** What the shop's webhook needs (README, "Add it to your app", step 5). */
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
];

/** Start forwarding; ready once the CLI says so. Stop it with `kill()`. */
export function listen(key: string, shop: string): Promise<ChildProcess> {
  const child = spawn(
    "vp",
    [
      "exec",
      "stripe",
      "listen",
      "--api-key",
      key,
      // Events in the latest API version, which the installed Stripe SDK (23.2.0) is on, as the
      // dev tests' events say they are (Stripe.API_VERSION); without it, the account's default.
      "--latest",
      "--skip-update", // its version is the one in package.json
      "--events",
      EVENTS.join(","),
      "--forward-to",
      `${shop}/api/auth/stripe/webhook`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = stripVTControlCharacters(chunk.toString());
      log += text;
      // Each forwarded event, and what the shop answered, in the test's output.
      process.stdout.write(`[stripe listen] ${text}`);
      if (log.includes("Ready!")) resolve(child);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => reject(new Error(`stripe listen stopped (${code}):\n${log}`)));
  });
}
