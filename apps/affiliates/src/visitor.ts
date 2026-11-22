// What the service records about a visitor: a salted hash of the IP (never the IP), the country
// Cloudflare saw, a device class and the referring site's host (never the full URL). And whether the
// request is a link preview or crawler rather than a person: those record nothing.
import { env } from "void/env";

type DeviceClass = "tablet" | "mobile" | "desktop";

const encoder = new TextEncoder();

export async function hashIp(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip + env.AFFILIATES_IP_SALT));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function requestIpHash(request: Request): Promise<string | null> {
  return hashIp(request.headers.get("cf-connecting-ip"));
}

export function deviceClass(userAgent: string | null | undefined): DeviceClass | null {
  if (!userAgent) return null;
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)) return "mobile";
  return "desktop";
}

export function referrerHost(request: Request): string | null {
  const referrer = request.headers.get("referer");
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host && host !== new URL(request.url).hostname.toLowerCase() ? host.slice(0, 253) : null;
  } catch {
    return null;
  }
}

/** Cloudflare's two-letter country for the request, when it gave one. */
export function country(request: Request): string | null {
  const value = request.cf?.country;
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
}

// Link previews (chat apps, social sites) and crawlers fetch a URL without a person clicking it.
const AUTOMATED =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|embedly|whatsapp|telegrambot|discordbot|slackbot|twitterbot|linkedinbot|skypeuripreview|pinterest|redditbot|applebot|bingpreview|googleother|vkshare|w3c_validator|headlesschrome|lighthouse|curl\/|wget\/|python-requests|go-http-client|node-fetch|axios\//i;

export function isAutomated(request: Request): boolean {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  if (cf?.botManagement?.verifiedBot) return true;
  return AUTOMATED.test(request.headers.get("user-agent") ?? "");
}
