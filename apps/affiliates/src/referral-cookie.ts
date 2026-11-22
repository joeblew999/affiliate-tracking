// The referral cookie's value: which partner (and which of their links) sent the visitor. Set by
// the referral links (routes/r/[slug].ts); the host passes it on at signup and checkout
// (client.ts: referralFrom).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Referral {
  partnerId: string;
  linkId: string | null;
}

/** The referral cookie's value: the partner, and the link when it was one of theirs. */
export function referralValue(referral: Referral): string {
  return referral.linkId ? `${referral.partnerId}.${referral.linkId}` : referral.partnerId;
}

/** The cookie's value as the host passed it on; null when absent or not one this service set. */
export function parseReferral(value: string | null | undefined): Referral | null {
  if (!value) return null;
  const [partnerId, linkId, extra] = value.split(".");
  if (extra !== undefined || !partnerId || !UUID.test(partnerId)) return null;
  if (linkId !== undefined && !UUID.test(linkId)) return null;
  return { partnerId, linkId: linkId ?? null };
}
