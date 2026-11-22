import { defineHandler, type InferProps } from "void";
import { env } from "void/env";
import { notePartnerIp } from "@/fraud";
import { linksOf } from "@/links";
import { partnerForUser } from "@/partners";
import { stats } from "@/stats";
import { currentUser } from "@/user";
import { requestIpHash } from "@/visitor";

// The partner's page: who's signed in (through the host), their partner record, and for an active
// partner their links and the last 30 days.
export const loader = defineHandler(async (c) => {
  const user = await currentUser(c);
  const shopUrl = env.HOST_SITE_URL;
  if (!user) return { user: null, shopUrl, partner: null, links: [], stats: null };
  const record = await partnerForUser(user.id);
  const active = record?.status === "active";
  if (record && active) await notePartnerIp(record.id, await requestIpHash(c.req.raw));
  const origin = new URL(c.req.url).origin;
  return {
    user: { email: user.email, name: user.name, isAdmin: user.role === "admin" },
    shopUrl,
    partner: record
      ? {
          name: record.name,
          code: record.code,
          status: record.status,
          commissionPct: record.commissionPct,
          promoCode: record.promoCode,
          paidOut: Boolean(record.stripeAccountId),
          link: new URL(`/r/${record.code}`, origin).toString(),
        }
      : null,
    links: record && active ? await linksOf(record.id, origin) : [],
    stats: record && active ? await stats(record.id, 30) : null,
  };
});
export type Props = InferProps<typeof loader>;
