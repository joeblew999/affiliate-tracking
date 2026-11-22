// The referral cookie: which partner (and which of their links) sent the visitor. Set by the
// service's referral links for the parent domain (AFFILIATES_COOKIE_DOMAIN) so the host's site gets
// it too; the host passes its value on at signup and checkout (client.ts: referralFrom). 30 days.
import { env } from "void/env";
import { REF_COOKIE } from "./host-contract";

const MAX_AGE = 60 * 60 * 24 * 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Referral {
  partnerId: string;
  linkId: string | null;
}

export function referralCookie(referral: Referral, secure: boolean): string {
  const value = referral.linkId ? `${referral.partnerId}.${referral.linkId}` : referral.partnerId;
  const parts = [
    `${REF_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${MAX_AGE}`,
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (env.AFFILIATES_COOKIE_DOMAIN) parts.push(`Domain=${env.AFFILIATES_COOKIE_DOMAIN}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** The cookie's value as the host passed it on; null when absent or not one this service set. */
export function parseReferral(value: string | null | undefined): Referral | null {
  if (!value) return null;
  const [partnerId, linkId, extra] = value.split(".");
  if (extra !== undefined || !partnerId || !UUID.test(partnerId)) return null;
  if (linkId !== undefined && !UUID.test(linkId)) return null;
  return { partnerId, linkId: linkId ?? null };
}
