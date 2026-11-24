// Partners' short links: /r/<slug> to a page on the host's site (routes/r/[slug].ts), each with its
// own clicks and sales. Up to 100 active per partner. A destination is always a path on the host's
// site, never another site, so a link can't be used as an open redirect.
import { clicks, links, newLink, sales } from "@schema";
import { HTTPException } from "hono/http-exception";
import { and, count, db, desc, eq, isNotNull, ne, sql, sum } from "void/db";
import { z } from "zod";
import { linksWritten } from "./outcomes.ts";

const MAX_ACTIVE_LINKS = 100;

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
        // Its sales: clawbacks aren't sales, but their commission is netted off.
        n: sql<number>`count(case when ${sales.kind} != 'clawback' then 1 end)`.mapWith(Number),
        commissionCents: sum(sales.commissionCents).mapWith(Number),
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
  input: z.output<typeof newLink>,
) {
  const slug = (input.slug ?? `${partner.code}-${crypto.randomUUID().slice(0, 8)}`).toLowerCase();
  const [active] = await db
    .select({ n: count() })
    .from(links)
    .where(and(eq(links.partnerId, partner.id), eq(links.status, "active")));
  if ((active?.n ?? 0) >= MAX_ACTIVE_LINKS)
    throw new HTTPException(409, { message: `Up to ${MAX_ACTIVE_LINKS} active links` });
  const [taken] = await db
    .select({ id: links.id })
    .from(links)
    .where(eq(links.slug, slug))
    .limit(1);
  if (taken) throw new HTTPException(409, { message: "That short name is taken" });
  const [row] = await db
    .insert(links)
    .values({
      partnerId: partner.id,
      slug,
      destination: input.destination ?? "/",
      campaign: input.campaign ?? null,
    })
    .returning();
  if (!row) throw new Error("link not created");
  await linksWritten([row.id]);
  return row;
}

export async function archiveLink(partnerId: string, id: string): Promise<void> {
  const [row] = await db
    .update(links)
    .set({ status: "archived" })
    .where(and(eq(links.id, id), eq(links.partnerId, partnerId), ne(links.status, "archived")))
    .returning({ id: links.id });
  if (!row) throw new HTTPException(404, { message: "No such active link" });
  await linksWritten([row.id]);
}
