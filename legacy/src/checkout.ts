// Checkout attribution.
//
// Call once on the URLSearchParams you are about to POST to
// https://api.stripe.com/v1/checkout/sessions, in every branch that creates
// a session. An optional customer-supplied promoCode takes priority over the
// cookie. Stripe validates redemption; recordConversion checks the paid order.
//
//   await attachAffiliateAttribution(params, request, env);
//
// With no entered code, no-op when there is no cookie, no DB
// binding, conflicting referral cookies, or no active affiliate — checkout
// remains available when cookie tracking is unconfigured or ambiguous. An
// unusable entered code throws PromotionCodeError for the host to display.

import { readAffiliateRef, readAffiliateLink } from './ref.ts';
import { affiliateLink } from './links.ts';
import { referralFor, validUserId } from './referral.ts';
import type { AffiliateEnv, AffiliatesRow } from './types.ts';
import { findPromotionCode, affiliateForPromotion, PromotionCodeError } from './promotion.ts';
import { requestIpHash } from './ip.ts';
import { errorMessage } from './errors.ts';
import { hasDb } from './env.ts';

type CheckoutAffiliate = Pick<AffiliatesRow, 'id' | 'code' | 'promo_code_id'>;

export async function attachAffiliateAttribution(params: URLSearchParams, request: Request, env: AffiliateEnv, { promoCode, userId }: { promoCode?: string; userId?: string } = {}, ): Promise<void> {
    if (!(params instanceof URLSearchParams)) return;
    if (promoCode !== undefined && (typeof promoCode !== 'string' || promoCode.length > 256)) {
        throw new PromotionCodeError('Invalid promo code.');
    }
    const enteredCode = promoCode?.trim();
    const promotion = enteredCode ? await findPromotionCode(enteredCode, env) : null;

    if (userId !== undefined && userId !== null && !validUserId(userId)) {
        throw new TypeError('userId must be a non-empty string of up to 255 characters');
    }
    const refCode = readAffiliateRef(request, env);
    let cookieAffiliate: CheckoutAffiliate | null = null;
    if ((refCode || userId) && env.DB) {
        try {
            // A referral stored at signup comes first; the cookie only without one.
            const referral = userId ? await referralFor(env, userId) : null;
            cookieAffiliate = referral
                ? { id: referral.affiliate_id, code: referral.code, promo_code_id: referral.promo_code_id }
                : refCode ? await env.DB.prepare(
                    "SELECT id, code, promo_code_id FROM affiliates WHERE code=?1 AND status='active'"
                ).bind(refCode).first<CheckoutAffiliate>() : null;
        } catch (err: unknown) {
            console.error('Affiliate lookup failed during checkout:', errorMessage(err));
            if (!promotion) return;
            throw new PromotionCodeError('Promotion codes are temporarily unavailable.', 503, 'promo_code_unavailable');
        }
    }
    let promoAffiliate: CheckoutAffiliate | null = null;
    if (promotion) {
        try {
            promoAffiliate = await affiliateForPromotion(promotion.id, env);
        } catch {
            throw new PromotionCodeError('Promotion codes are temporarily unavailable.', 503, 'promo_code_unavailable');
        }
    }
    const aff = promoAffiliate || cookieAffiliate;
    // The user id lets the webhook store who got this user's first sale.
    if (userId) params.set('metadata[affiliate_user_id]', userId);
    if (!aff && !promotion) return;
    params.set('metadata[affiliate_attribution_version]', 'promo-first-v1');
    if (cookieAffiliate) {
        params.set('metadata[affiliate_cookie_id]', String(cookieAffiliate.id));
        params.set('metadata[affiliate_cookie_code]', cookieAffiliate.code);
    }

    // The site's own referral field also uses client_reference_id; only send
    // ours when the caller hasn't already set it.
    if (aff) {
        if (!params.get('client_reference_id')) params.set('client_reference_id', aff.code);
        params.set('metadata[affiliate_id]', String(aff.id));
        params.set('metadata[affiliate_code]', aff.code);
        params.set('metadata[affiliate_source]', promoAffiliate ? 'promo_code' : 'cookie');
        // For the self-referral check: compared with the affiliate's own
        // sign-in IP hashes when the sale is recorded. Never a raw IP.
        const buyerIpHash = await requestIpHash(request, env);
        if (buyerIpHash) params.set('metadata[affiliate_buyer_ip_hash]', buyerIpHash);
        // Credit the sale to the short link the visitor used, when it belongs
        // to the affiliate who gets the sale.
        const linkId = readAffiliateLink(request, env);
        if (linkId && hasDb(env)) {
            try {
                const link = await affiliateLink(env, aff.id, linkId);
                if (link) params.set('metadata[affiliate_link_id]', link.id);
            } catch (err: unknown) {
                console.error('Affiliate link lookup failed during checkout:', errorMessage(err));
            }
        }
    }
    // Buyer discount. Pre-applied via the promotion code minted at approval
    // time; absent until an admin approves the affiliate.
    const promotionId = promotion?.id || cookieAffiliate?.promo_code_id;
    if (promotionId) {
        // Stripe rejects Checkout Sessions that combine `discounts` with
        // `allow_promotion_codes`, or a single discount item with both coupon
        // and promotion_code.
        params.delete('allow_promotion_codes');
        params.delete('discounts[0][coupon]');
        params.set('discounts[0][promotion_code]', promotionId);
    }
}
