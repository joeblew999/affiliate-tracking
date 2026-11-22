// The numbers behind the Performance pages: per partner, the funnel (clicks → signups → customers →
// sales) and money by status in each currency; clicks per day; top countries, devices and referring
// sites. For one partner (their dashboard) or all of them (admins), over the last N days (UTC).
import { clicks, partners, referrals, sales } from "@schema";
import { and, count, db, desc, eq, gte, inArray, isNotNull, lte, ne, type SQL } from "void/db";

const DAY_MS = 24 * 60 * 60 * 1000;

function range(days: number, now = Date.now()) {
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
  const countedSales = and(
    saleScope,
    ne(sales.status, "refunded"),
    inArray(sales.kind, ["checkout", "renewal"]),
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
    customerPairs,
    saleRows,
    clickTimes,
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
      .select({ partnerId: sales.partnerId, n: count() })
      .from(sales)
      .where(countedSales)
      .groupBy(sales.partnerId),
    // Each partner's customers, once each: emails are stored lowercase (src/sales.ts), so one
    // customer however they typed it.
    db
      .selectDistinct({ partnerId: sales.partnerId, email: sales.customerEmail })
      .from(sales)
      .where(and(countedSales, isNotNull(sales.customerEmail))),
    db
      .select({
        partnerId: sales.partnerId,
        currency: sales.currency,
        status: sales.status,
        amountCents: sales.amountCents,
        refundedCents: sales.refundedCents,
        commissionCents: sales.commissionCents,
      })
      .from(sales)
      .where(saleScope),
    db.select({ createdAt: clicks.createdAt }).from(clicks).where(clickScope),
    top(clicks.country, clickScope),
    top(clicks.device, clickScope),
    top(clicks.referrerHost, clickScope),
  ]);

  const by = <R extends { partnerId: string }>(rows: R[]) =>
    new Map(rows.map((row) => [row.partnerId, row]));
  const clickMap = by(clickCounts);
  const signupMap = by(signupCounts);
  const saleMap = by(saleCounts);
  // Money per partner and currency: revenue after refunds; commission by status, net of
  // clawbacks, which are approved lines below zero.
  const money = new Map<string, MoneyRow>();
  for (const row of saleRows) {
    const key = `${row.partnerId} ${row.currency}`;
    const m = money.get(key) ?? {
      partnerId: row.partnerId,
      currency: row.currency,
      revenueCents: 0,
      ...zeroTotals(),
    };
    m.revenueCents += row.amountCents - Math.min(row.refundedCents, row.amountCents);
    addByStatus(m, row);
    money.set(key, m);
  }
  const perDay = new Map<number, number>();
  for (const { createdAt } of clickTimes) {
    const day = Math.floor((createdAt - start) / DAY_MS);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return {
    range: { days, start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    funnel: people.map((p) => ({
      partnerId: p.id,
      code: p.code,
      name: p.name,
      clicks: clickMap.get(p.id)?.n ?? 0,
      signups: signupMap.get(p.id)?.n ?? 0,
      customers: customerPairs.filter((c) => c.partnerId === p.id).length,
      sales: saleMap.get(p.id)?.n ?? 0,
      money: [...money.values()]
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
  const rows = await db
    .select({
      currency: sales.currency,
      status: sales.status,
      commissionCents: sales.commissionCents,
    })
    .from(sales)
    .where(eq(sales.partnerId, partnerId))
    .orderBy(sales.currency);
  const byCurrency = new Map<string, { currency: string } & Totals>();
  for (const row of rows) {
    const e = byCurrency.get(row.currency) ?? { currency: row.currency, ...zeroTotals() };
    addByStatus(e, row);
    byCurrency.set(row.currency, e);
  }
  return [...byCurrency.values()].map(({ currency, pendingCents, approvedCents, paidCents }) => ({
    currency,
    onHoldCents: pendingCents,
    readyCents: approvedCents,
    paidCents,
  }));
}

/** Commission by where it is: pending, approved (ready to pay), paying or paid. */
interface Totals {
  pendingCents: number;
  approvedCents: number;
  paidCents: number;
}
interface MoneyRow extends Totals {
  partnerId: string;
  currency: string;
  revenueCents: number;
}
function zeroTotals(): Totals {
  return { pendingCents: 0, approvedCents: 0, paidCents: 0 };
}
function addByStatus(
  totals: Totals,
  row: { status: (typeof sales.$inferSelect)["status"]; commissionCents: number },
) {
  if (row.status === "pending") totals.pendingCents += row.commissionCents;
  else if (row.status === "approved") totals.approvedCents += row.commissionCents;
  else if (row.status === "paying" || row.status === "paid")
    totals.paidCents += row.commissionCents;
}
