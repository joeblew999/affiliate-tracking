import { defineHandler } from "void";
import { z } from "zod";

// The host tells the service a user signed up, with the referral cookie's value if the browser had
// one (client.ts: referralFrom). Recording the referral comes in step 2 of
// plans/2026-11-22-01-void-service.md.
export const POST = defineHandler.withValidator({
  body: z.object({ userId: z.string().min(1).max(255), ref: z.string().max(512).nullable() }),
})(async (_c, { body }) => ({ userId: body.userId, referred: false }));
