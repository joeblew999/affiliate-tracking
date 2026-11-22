//   POST /api/admin/bonus { affiliate_id, amount_cents, currency, note }
//     A one-off bonus line. It is approved straight away and paid with the
//     affiliate's next payout. It must be in the payout currency
//     (AFFILIATE_PAYOUT_CURRENCY): a bonus has no Stripe payment to convert from.

import { requireAdmin } from './_gate.ts';
import { readJsonObject } from '../_public.ts';
import { currencyCode } from '../../../src/money.ts';
import { payoutCurrency } from '../../../src/settlement.ts';
import type { AffiliateRouteContext } from '../../../src/types.ts';
import { errorMessage } from '../../../src/errors.ts';
import { hasDb } from '../../../src/env.ts';

export async function onRequestPost({ request, env }: AffiliateRouteContext) {
    const gate = await requireAdmin(env, request);
    if (gate) return gate;
    if (!hasDb(env)) return Response.json({ ok: false, error: 'DB not bound' }, { status: 500 });
    const { affiliate_id: affiliateId, amount_cents: amount, currency, note } = await readJsonObject(request);
    if (!Number.isSafeInteger(affiliateId) || affiliateId <= 0 || !Number.isSafeInteger(amount) || amount <= 0 ||
        !currencyCode(currency) || typeof note !== 'string' || !note.trim() || note.length > 200) {
        return Response.json({ ok: false, error: 'affiliate_id, a positive amount_cents, a currency and a note of up to 200 characters are required' }, { status: 400 });
    }
    let target;
    try {
        target = payoutCurrency(env);
    } catch (err: unknown) {
        return Response.json({ ok: false, error: errorMessage(err) }, { status: 500 });
    }
    if (currencyCode(currency) !== target) {
        return Response.json({ ok: false, error: `Bonuses are paid in your payout currency, ${target.toUpperCase()}` }, { status: 400 });
    }
    const now = Date.now();
    const id = 'bonus_' + crypto.randomUUID();
    const result = await env.DB.prepare(`INSERT INTO conversions
        (affiliate_id, stripe_session_id, amount_cents, commission_cents, status, created_at, approved_at, currency, bonus_note)
        SELECT id, ?2, 0, ?3, 'approved', ?4, ?4, ?5, ?6 FROM affiliates WHERE id=?1 AND status='active'`)
        .bind(affiliateId, id, amount, now, currencyCode(currency), note.trim()).run();
    if (!result.meta?.changes) return Response.json({ ok: false, error: 'Active affiliate not found' }, { status: 404 });
    return Response.json({ ok: true, reference: id }, { status: 201 });
}
