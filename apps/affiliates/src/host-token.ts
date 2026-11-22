/** The header the host app's calls carry AFFILIATES_HOST_TOKEN in (client.ts, middleware/01.host-api.ts). */
export const HOST_TOKEN_HEADER = "x-affiliates-host-token";

/**
 * The referral cookie: set by this service's referral links for the parent domain, so the host app
 * receives it too and passes its value on at signup and checkout.
 */
export const REF_COOKIE = "affiliate_ref";
