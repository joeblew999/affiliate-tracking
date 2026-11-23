// The shop's Stripe: the selling account, with Managed Payments (Stripe sells the tickets and
// handles their tax). Used by Better Auth's Stripe plugin (auth.ts) and the ticket checkout
// (pages/events/[id].server.ts). Without a key, every Stripe call fails saying so.
import Stripe from "stripe";

export function stripeClient(key: string): Stripe {
  const httpClient = Stripe.createFetchHttpClient();
  if (key) return new Stripe(key, { httpClient });
  return new Stripe("", {
    httpClient,
    authenticator: async () => {
      throw new Error("STRIPE_SECRET_KEY isn't set: the shop has no payments");
    },
  });
}
