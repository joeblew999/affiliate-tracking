// What a sale earns its partner. For now the partner's own percent of what was paid; commission
// rules (per product, tiers, caps) come in step 3 of plans/2026-11-22-01-void-service.md.
import type { CommissionLine } from "@schema";
import type { Partner } from "./partners";

export interface Commission {
  commissionCents: number;
  commissionPct: number | null;
  detail: CommissionLine[] | null;
}

export function computeCommission(
  partner: Pick<Partner, "commissionPct">,
  amountCents: number,
): Commission {
  return {
    commissionCents: Math.round((amountCents * partner.commissionPct) / 100),
    commissionPct: partner.commissionPct,
    detail: null,
  };
}
