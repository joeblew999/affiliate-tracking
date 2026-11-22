// Partners' short links: /r/<slug> to a page on the host's site (routes/r/[slug].ts), each with its
// own clicks and sales. Up to 100 active per partner. A destination is always a path on the host's
// site, never another site, so a link can't be used as an open redirect.
import { clicks, links, sales } from "@schema";
import { HTTPException } from "hono/http-exception";
import { and, count, db, desc, eq, isNotNull, ne, sql } from "void/db";
import { z } from "zod";

export const MAX_ACTIVE_LINKS = 100;

export const NewLink = z.object({
  destination: z
    .string()
    .max(512)
    .regex(/^\/(?!\/)[^\s\\]*$/, "a path on the site, like /pricing")
    .default("/"),
  campaign: z.string().trim().max(100).nullable().default(null),
  /** Made from the partner's code when empty. */
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "2–64 lowercase letters, digits or dashes")
    .nullable()
    .default(null),
});

/**
 * A partner's links, each with its clicks and sales (not refunded) and its commission net of
 * clawbacks. Counted in grouped queries by link: a correlated subquery here once compared the
 * click's own id instead of the link's, since Drizzle writes the outer column unqualified.
 */
export async function linksOf(partnerId: string, origin: string) {
  const [rows, clickCounts, saleCounts] = await Promise.all([
    db
      .select({
        id: links.id,
        slug: links.slug,
        destination: links.destination,
        campaign: links.campaign,
        status: links.status,
        createdAt: links.createdAt,
      })
      .from(links)
      .where(eq(links.partnerId, partnerId))
      .orderBy(desc(links.createdAt)),
    db
      .select({ linkId: clicks.linkId, n: count() })
      .from(clicks)
      .where(and(eq(clicks.partnerId, partnerId), isNotNull(clicks.linkId)))
      .groupBy(clicks.linkId),
    db
      .select({
        linkId: sales.linkId,
        n: sql<number>`COUNT(CASE WHEN ${sales.kind} != 'clawback' THEN 1 END)`,
        commissionCents: sql<number>`COALESCE(SUM(${sales.commissionCents}), 0)`,
      })
      .from(sales)
      .where(
        and(eq(sales.partnerId, partnerId), isNotNull(sales.linkId), ne(sales.status, "refunded")),
      )
      .groupBy(sales.linkId),
  ]);
  const clicksOf = new Map(clickCounts.map((row) => [row.linkId, row.n]));
  const salesOf = new Map(saleCounts.map((row) => [row.linkId, row]));
  return rows.map((row) => ({
    ...row,
    clicks: clicksOf.get(row.id) ?? 0,
    sales: salesOf.get(row.id)?.n ?? 0,
    commissionCents: salesOf.get(row.id)?.commissionCents ?? 0,
    url: new URL(`/r/${row.slug}`, origin).toString(),
  }));
}

export async function createLink(
  partner: { id: string; code: string },
  input: z.output<typeof NewLink>,
) {
  const slug = input.slug ?? `${partner.code}-${crypto.randomUUID().slice(0, 4)}`;
  const [active] = await db
    .select({ n: count() })
    .from(links)
    .where(and(eq(links.partnerId, partner.id), eq(links.status, "active")));
  if ((active?.n ?? 0) >= MAX_ACTIVE_LINKS)
    throw new HTTPException(409, { message: `Up to ${MAX_ACTIVE_LINKS} active links` });
  const [taken] = await db
    .select({ id: links.id })
    .from(links)
    .where(sql`${links.slug} = ${slug} COLLATE NOCASE`)
    .limit(1);
  if (taken) throw new HTTPException(409, { message: "That short name is taken" });
  const [row] = await db
    .insert(links)
    .values({
      partnerId: partner.id,
      slug,
      destination: input.destination,
      campaign: input.campaign,
    })
    .returning();
  if (!row) throw new Error("link not created");
  return row;
}

export async function archiveLink(partnerId: string, id: string): Promise<void> {
  const [row] = await db
    .update(links)
    .set({ status: "archived" })
    .where(and(eq(links.id, id), eq(links.partnerId, partnerId), ne(links.status, "archived")))
    .returning({ id: links.id });
  if (!row) throw new HTTPException(404, { message: "No such active link" });
}
