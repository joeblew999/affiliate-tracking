// A sale looks like a partner buying through their own referral when the buyer's email is the
// partner's, or the buyer checked out from an IP the partner used this service from. Flagged sales
// stay pending for an admin; the hold period never approves them.
import { partnerIpHashes } from "@schema";
import { db, eq } from "void/db";

export type FraudReason = "self_email" | "self_ip";

export async function selfReferralReason(
  partner: { id: string; email: string },
  buyer: {
    email: string | null;
    ipHash: string | null;
  },
): Promise<FraudReason | null> {
  const normal = (value: string | null) => value?.trim().toLowerCase() ?? "";
  if (normal(buyer.email) && normal(buyer.email) === normal(partner.email)) return "self_email";
  if (!buyer.ipHash) return null;
  const used = await db
    .select({ ipHash: partnerIpHashes.ipHash })
    .from(partnerIpHashes)
    .where(eq(partnerIpHashes.partnerId, partner.id));
  return used.some((row) => row.ipHash === buyer.ipHash) ? "self_ip" : null;
}

/** Remember an IP (hashed) the partner used this service from. */
export async function notePartnerIp(partnerId: string, ipHash: string | null): Promise<void> {
  if (!ipHash) return;
  await db
    .insert(partnerIpHashes)
    .values({ partnerId, ipHash, lastSeenAt: Date.now() })
    .onConflictDoUpdate({
      target: [partnerIpHashes.partnerId, partnerIpHashes.ipHash],
      set: { lastSeenAt: Date.now() },
    });
}
