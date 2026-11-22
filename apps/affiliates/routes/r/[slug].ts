// A referral link: /r/<partner code> or /r/<short link slug>. Records the click (at most one per
// visitor IP per partner per day), sets the referral cookie for the parent domain, and sends the
// visitor to the host's site, keeping their own query (utm_* and the like). Link previews and
// crawlers are sent on with nothing recorded. An unknown or inactive link goes to the host's home.
import { clicks, links, partners } from "@schema";
import { defineHandler } from "void";
import { and, db, eq, gt } from "void/db";
import { env } from "void/env";
import { referralCookie, type Referral } from "@/referral-cookie";
import { country, deviceClass, isAutomated, referrerHost, requestIpHash } from "@/visitor";

const DAY_MS = 24 * 60 * 60 * 1000;

async function resolve(slug: string): Promise<(Referral & { destination: string }) | null> {
  const [link] = await db
    .select({ partnerId: links.partnerId, linkId: links.id, destination: links.destination })
    .from(links)
    .innerJoin(partners, eq(partners.id, links.partnerId))
    .where(
      and(
        eq(links.slug, slug.toLowerCase()),
        eq(links.status, "active"),
        eq(partners.status, "active"),
      ),
    )
    .limit(1);
  if (link) return link;
  const [partner] = await db
    .select({ partnerId: partners.id })
    .from(partners)
    .where(and(eq(partners.code, slug.toLowerCase()), eq(partners.status, "active")))
    .limit(1);
  return partner ? { partnerId: partner.partnerId, linkId: null, destination: "/" } : null;
}

async function recordClick(request: Request, referral: Referral): Promise<void> {
  const ipHash = await requestIpHash(request);
  const since = Date.now() - DAY_MS;
  if (ipHash) {
    const [seen] = await db
      .select({ id: clicks.id })
      .from(clicks)
      .where(
        and(
          eq(clicks.partnerId, referral.partnerId),
          eq(clicks.ipHash, ipHash),
          gt(clicks.createdAt, since),
        ),
      )
      .limit(1);
    if (seen) return;
  }
  await db.insert(clicks).values({
    partnerId: referral.partnerId,
    linkId: referral.linkId,
    ipHash,
    country: country(request),
    device: deviceClass(request.headers.get("user-agent")),
    referrerHost: referrerHost(request),
  });
}

export const GET = defineHandler(async (c) => {
  const url = new URL(c.req.url);
  const found = await resolve(c.req.param("slug") ?? "");
  const target = new URL(found?.destination ?? "/", env.HOST_SITE_URL);
  for (const [key, value] of url.searchParams)
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  const headers = new Headers({
    location: target.toString(),
    "cache-control": "private, no-store",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  if (found && !isAutomated(c.req.raw)) {
    c.executionCtx.waitUntil(recordClick(c.req.raw, found));
    headers.append("set-cookie", referralCookie(found, url.protocol === "https:"));
  }
  return new Response(null, { status: 302, headers });
});
