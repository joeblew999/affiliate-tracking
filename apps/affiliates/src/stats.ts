// The numbers behind the Performance pages: per partner, the funnel (clicks → signups → customers →
// sales) and money by status in each currency; clicks per day; top countries, devices and referring
// sites. For one partner (their dashboard) or all of them (admins), over the last N days (UTC).
import { clicks, partners, referrals, sales } from "@schema";
import { and, count, db, desc, eq, gte, inArray, isNotNull, lte, ne, sql, type SQL } from "void/db";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;

export const StatsQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

export function range(days: number, now = Date.now()) {
  const today = new Date(now);
  const start =
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (days - 1) * DAY_MS;
  return { days, start, end: now };
}

export async function stats(partnerId: string | null, days: number) {
  const { start, end } = range(days);
  const clickScope = and(
    gte(clicks.createdAt, start),
    lte(clicks.createdAt, end),
    partnerId ? eq(clicks.partnerId, partnerId) : undefined,
  );
  const saleScope = and(
    gte(sales.createdAt, start),
    lte(sales.createdAt, end),
    partnerId ? eq(sales.partnerId, partnerId) : undefined,
  );
  const signupScope = and(
    gte(referrals.createdAt, start),
    lte(referrals.createdAt, end),
    partnerId ? eq(referrals.partnerId, partnerId) : undefined,
  );

  const [
    people,
    clickCounts,
    signupCounts,
    saleCounts,
    money,
    byDay,
    countries,
    devices,
    referrers,
  ] = await Promise.all([
    db
      .select({ id: partners.id, code: partners.code, name: partners.name })
      .from(partners)
      .where(partnerId ? eq(partners.id, partnerId) : ne(partners.status, "pending"))
      .orderBy(partners.createdAt),
    db
      .select({ partnerId: clicks.partnerId, n: count() })
      .from(clicks)
      .where(clickScope)
      .groupBy(clicks.partnerId),
    db
      .select({ partnerId: referrals.partnerId, n: count() })
      .from(referrals)
      .where(signupScope)
      .groupBy(referrals.partnerId),
    db
      .select({
        partnerId: sales.partnerId,
        n: count(),
        customers: sql<number>`COUNT(DISTINCT lower(${sales.customerEmail}))`,
      })
      .from(sales)
      .where(
        and(saleScope, ne(sales.status, "refunded"), inArray(sales.kind, ["checkout", "renewal"])),
      )
      .groupBy(sales.partnerId),
    db
      .select({
        partnerId: sales.partnerId,
        currency: sales.currency,
        // Revenue after refunds; commission net of clawbacks, which are approved lines below zero.
        revenueCents: sql<number>`SUM(${sales.amountCents} - MIN(${sales.refundedCents}, ${sales.amountCents}))`,
        pendingCents: sql<number>`SUM(CASE WHEN ${sales.status} = 'pending' THEN ${sales.commissionCents} ELSE 0 END)`,
        approvedCents: sql<number>`SUM(CASE WHEN ${sales.status} = 'approved' THEN ${sales.commissionCents} ELSE 0 END)`,
        paidCents: sql<number>`SUM(CASE WHEN ${sales.status} IN ('paying', 'paid') THEN ${sales.commissionCents} ELSE 0 END)`,
      })
      .from(sales)
      .where(saleScope)
      .groupBy(sales.partnerId, sales.currency),
    db
      .select({
        day: sql<number>`CAST((${clicks.createdAt} - ${start}) / ${DAY_MS} AS INTEGER)`,
        n: count(),
      })
      .from(clicks)
      .where(clickScope)
      .groupBy(sql`1`),
    top(clicks.country, clickScope),
    top(clicks.device, clickScope),
    top(clicks.referrerHost, clickScope),
  ]);

  const by = <R extends { partnerId: string }>(rows: R[]) =>
    new Map(rows.map((row) => [row.partnerId, row]));
  const clickMap = by(clickCounts);
  const signupMap = by(signupCounts);
  const saleMap = by(saleCounts);
  const perDay = new Map(byDay.map((row) => [row.day, row.n]));
  return {
    range: { days, start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    funnel: people.map((p) => ({
      partnerId: p.id,
      code: p.code,
      name: p.name,
      clicks: clickMap.get(p.id)?.n ?? 0,
      signups: signupMap.get(p.id)?.n ?? 0,
      customers: saleMap.get(p.id)?.customers ?? 0,
      sales: saleMap.get(p.id)?.n ?? 0,
      money: money
        .filter((m) => m.partnerId === p.id)
        .map((m) => ({
          currency: m.currency,
          revenueCents: m.revenueCents,
          pendingCents: m.pendingCents,
          approvedCents: m.approvedCents,
          paidCents: m.paidCents,
        })),
    })),
    clicksByDay: Array.from({ length: days }, (_, i) => ({
      date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
      clicks: perDay.get(i) ?? 0,
    })),
    topCountries: countries,
    topDevices: devices,
    topReferrers: referrers,
  };
}

async function top(
  column: typeof clicks.country | typeof clicks.device | typeof clicks.referrerHost,
  scope: SQL | undefined,
) {
  const rows = await db
    .select({ value: column, clicks: count() })
    .from(clicks)
    .where(and(scope, isNotNull(column)))
    .groupBy(column)
    .orderBy(desc(count()), column)
    .limit(10);
  return rows.map((row) => ({ value: row.value ?? "", clicks: row.clicks }));
}

/**
 * A partner's money over all time, in each currency, by where it is: on hold (pending: waiting out
 * the hold period or an admin), ready to pay (approved, less clawbacks: the next payout), and paid
 * (sent, or being sent). Rejected and fully refunded sales earn nothing and aren't counted.
 */
export async function earnings(partnerId: string) {
  return db
    .select({
      currency: sales.currency,
      onHoldCents: sql<number>`SUM(CASE WHEN ${sales.status} = 'pending' THEN ${sales.commissionCents} ELSE 0 END)`,
      readyCents: sql<number>`SUM(CASE WHEN ${sales.status} = 'approved' THEN ${sales.commissionCents} ELSE 0 END)`,
      paidCents: sql<number>`SUM(CASE WHEN ${sales.status} IN ('paying', 'paid') THEN ${sales.commissionCents} ELSE 0 END)`,
    })
    .from(sales)
    .where(eq(sales.partnerId, partnerId))
    .groupBy(sales.currency)
    .orderBy(sales.currency);
}
