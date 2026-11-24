// What the other workers ask of the hub, beyond the streams' own protocol at /streams: each call
// defined once, for the hub's routes (routes/api/) to check against and its client (client.ts) to
// take its types from.
import { z } from "zod";

/** A stream's name: its path under /streams, like "orders/paid". */
const Stream = z
  .string()
  .min(1)
  .regex(/^[^/?#]+(\/[^/?#]+)*$/, "a path like orders/paid")
  .refine((path) => !path.startsWith("__ds"), "__ds is the streams' own");

/**
 * Add one event to the end of each of these streams, made if they aren't there. Nobody is told:
 * for streams that are read, not followed. `mark`: note the place, for Recent.
 */
export const AppendInput = z.object({
  streams: z.array(Stream).min(1),
  event: z.unknown(),
  mark: z.boolean().default(false),
});
export const AppendOutput = z.object({ appended: z.literal(true) });

/** A stream from its oldest mark kept (its start if it has none) to where it ends now. */
export const RecentInput = z.object({ stream: Stream });
export const RecentOutput = z.object({ events: z.array(z.unknown()), offset: z.string() });

/**
 * Add one event to a stream others follow, made if it isn't there, and tell its subscribers.
 * Answers with where the stream now ends and the subscriptions told.
 */
export const PublishInput = z.object({ stream: Stream, event: z.unknown() });
export const PublishOutput = z.object({ offset: z.string(), subscribers: z.array(z.string()) });
