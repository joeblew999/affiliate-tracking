// What a sale earns its partner. For each item sold the most specific active rule wins:
//   1. this partner + this product    2. this product (any partner)
//   3. this partner (any product)     4. every partner and product
// and with no rule at all, the partner's own percent. Among equally specific rules, the tier with the
// highest min_monthly_sales the partner has reached this calendar month (UTC) applies. A percent rule
// pays a share of what the item sold for after discounts; a fixed rule pays fixedCents per unit, only
// for sales in its currency. A cap limits what one customer (by email) can earn the partner under
// that rule, across all their purchases. What was applied is stored with the sale (commissionDetail),
// so changing a rule later never changes what was already earned.
import { commissionRules, sales, type CommissionLine } from "@schema";
import { and, count, db, eq, gte, isNull, lte, ne, or, sql } from "void/db";
import type { Partner } from "./partners";

type Rule = typeof commissionRules.$inferSelect;

export interface Commission {
  commissionCents: number;
  commissionPct: number | null;
  detail: CommissionLine[] | null;
}

export interface CommissionItem {
  productId: string | null;
  priceId: string | null;
  quantity: number;
  /** What the item sold for after discounts; null when Stripe didn't say. */
  amountCents: number | null;
}

const specificity = (rule: Rule) =>
  (rule.partnerId !== null ? 1 : 0) + (rule.productId !== null ? 2 : 0);

function monthStart(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function pickRule(
  rules: readonly Rule[],
  partnerId: string,
  productIds: readonly string[],
  salesThisMonth: number,
): Rule | null {
  const matching = rules.filter(
    (rule) =>
      (rule.partnerId === null || rule.partnerId === partnerId) &&
      (rule.productId === null || productIds.includes(rule.productId)) &&
      rule.minMonthlySales <= salesThisMonth,
  );
  matching.sort(
    (a, b) =>
      specificity(b) - specificity(a) ||
      b.minMonthlySales - a.minMonthlySales ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
  return matching[0] ?? null;
}

function ruleCommission(rule: Rule, baseCents: number, quantity: number, currency: string): number {
  if (rule.kind === "percent") return Math.round((baseCents * (rule.percent ?? 0)) / 100);
  return rule.currency === currency ? (rule.fixedCents ?? 0) * quantity : 0;
}

export async function computeCommission(
  partner: Pick<Partner, "id" | "commissionPct">,
  sale: {
    amountCents: number;
    currency: string;
    customerEmail: string | null;
    at: number;
    items: readonly CommissionItem[];
  },
): Promise<Commission> {
  const rules = await db
    .select()
    .from(commissionRules)
    .where(
      and(
        eq(commissionRules.active, true),
        or(isNull(commissionRules.partnerId), eq(commissionRules.partnerId, partner.id)),
      ),
    );
  if (rules.length === 0) {
    return {
      commissionCents: Math.round((sale.amountCents * partner.commissionPct) / 100),
      commissionPct: partner.commissionPct,
      detail: null,
    };
  }
  const [month] = await db
    .select({ n: count() })
    .from(sales)
    .where(
      and(
        eq(sales.partnerId, partner.id),
        ne(sales.status, "refunded"),
        ne(sales.kind, "bonus"),
        gte(sales.createdAt, monthStart(sale.at)),
        lte(sales.createdAt, sale.at),
      ),
    );
  const salesThisMonth = month?.n ?? 0;
  // Per item when Stripe sent amounts that add up to what was paid; otherwise as one line, where
  // only rules without a product can apply.
  const amounts = sale.items.map((item) => item.amountCents);
  const priced =
    sale.items.length > 0 &&
    amounts.every((cents) => cents !== null && Number.isSafeInteger(cents)) &&
    amounts.reduce<number>((sum, cents) => sum + (cents ?? 0), 0) === sale.amountCents;
  const lines = priced
    ? sale.items.map((item) => ({ ...item, amountCents: item.amountCents ?? 0 }))
    : [{ productId: null, priceId: null, quantity: 1, amountCents: sale.amountCents }];

  const detail: CommissionLine[] = [];
  for (const line of lines) {
    const productIds = [line.productId, line.priceId].filter((id): id is string => id !== null);
    const rule = pickRule(rules, partner.id, productIds, salesThisMonth);
    let commissionCents = rule
      ? ruleCommission(rule, line.amountCents, line.quantity, sale.currency)
      : Math.round((line.amountCents * partner.commissionPct) / 100);
    if (rule && rule.capPerCustomerCents !== null && sale.customerEmail) {
      const [earned] = await db
        .select({
          cents: sql<number>`COALESCE(SUM(json_extract(d.value, '$.commissionCents')), 0)`,
        })
        .from(sql`${sales}, json_each(${sales.commissionDetail}) d`)
        .where(
          and(
            eq(sales.partnerId, partner.id),
            ne(sales.status, "refunded"),
            sql`lower(${sales.customerEmail}) = lower(${sale.customerEmail})`,
            sql`json_extract(d.value, '$.ruleId') = ${rule.id}`,
          ),
        );
      const alreadyInSale = detail
        .filter((d) => d.ruleId === rule.id)
        .reduce((sum, d) => sum + d.commissionCents, 0);
      commissionCents = Math.max(
        0,
        Math.min(commissionCents, rule.capPerCustomerCents - (earned?.cents ?? 0) - alreadyInSale),
      );
    }
    detail.push({
      ruleId: rule?.id ?? null,
      productId: line.productId,
      baseCents: line.amountCents,
      commissionCents,
    });
  }
  const used = new Set(detail.map((d) => d.ruleId));
  const onlyRule = used.size === 1 ? rules.find((r) => r.id === [...used][0]) : undefined;
  const commissionPct =
    used.size === 1 && [...used][0] === null
      ? partner.commissionPct
      : onlyRule?.kind === "percent"
        ? onlyRule.percent
        : null;
  return {
    commissionCents: detail.reduce((sum, d) => sum + d.commissionCents, 0),
    commissionPct,
    detail,
  };
}
