import { defineHandler } from "void";
import { SignupInput, type SignupOutput } from "@/host-contract";
import { recordSignupReferral } from "@/referrals";

// The host tells the service a user signed up, with the referral cookie's value if the browser had
// one (client.ts: referralFrom). The user becomes the referring partner's for later purchases.
export const POST = defineHandler.withValidator({ body: SignupInput })(
  async (_c, { body }) =>
    ({
      userId: body.userId,
      referred: await recordSignupReferral(body.userId, body.ref),
    }) satisfies SignupOutput,
);
