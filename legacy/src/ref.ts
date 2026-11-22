// The affiliate ref middleware.
//
// Worker entry point passes the asset fallthrough as `respond` so the cookie
// can be appended to whatever the site would have served anyway (page, 404,
// etc.). Every failure mode — no DB binding, unknown/inactive code, asset
// fetch error — returns null so the caller's normal flow is untouched.
//
//   const refRes = await applyAffiliateRef(request, env, () => env.ASSETS.fetch(request));
//   if (refRes) return refRes;

// Attribution cookie name. Neutral default; consumers brand it per site by
// setting AFFILIATE_REF_COOKIE in their Worker env. Use a __Host- name on
// HTTPS and AFFILIATE_REF_LEGACY_COOKIE for a read-only migration fallback.
// Resolved per-call since env differs per environment.
import { hostCookieName } from './cookie.ts';
import { requestIpHash } from './ip.ts';
import { isAutomatedRequest, CLICK_WINDOW_MS } from './fraud.ts';
import { affiliateLink } from './links.ts';
import { clickDetails, writeClickEvent } from './analytics.ts';
import type { AffiliateEnv, AffiliateExecutionContext, AffiliatesRow } from './types.ts';
import { errorMessage } from './errors.ts';

export const DEFAULT_REF_COOKIE = 'affiliate_ref' as const;
const REF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function refCookieName(env?: AffiliateEnv | null, request?: Request): string {
    const name = (env && env.AFFILIATE_REF_COOKIE) || DEFAULT_REF_COOKIE;
    return request ? hostCookieName(name, request.url) : name;
}

// Which of the affiliate's links the visitor came through (src/links.ts).
export function linkCookieName(env: AffiliateEnv | undefined, request?: Request): string {
    const name = ((env && env.AFFILIATE_REF_COOKIE) || DEFAULT_REF_COOKIE) + '_link';
    return request ? hostCookieName(name, request.url) : name;
}

export function readAffiliateLink(request: Request, env: AffiliateEnv | undefined): string | null {
    const cookie = referralCookie(request.headers.get('Cookie'), linkCookieName(env, request));
    return cookie.present && !cookie.invalid && cookie.values.size === 1 ? [...cookie.values][0] || null : null;
}

// Cookie headers contain no path/domain/creation-time information. Never use
// their ordering to select between conflicting referrals. A present current
// cookie takes precedence over legacy cookies, even if invalid or ambiguous.
export function readAffiliateRef(request: Request, env: AffiliateEnv): string | null {
    const names = new Set([refCookieName(env, request), env?.AFFILIATE_REF_LEGACY_COOKIE]);
    const header = request.headers.get('Cookie');
    for (const name of names) {
        if (!name) continue;
        const cookie = referralCookie(header, name);
        if (!cookie.present) continue;
        if (cookie.values.size > 1) {
            console.warn(JSON.stringify({ event: 'affiliate_ref_cookie_conflict', cookie_name: name }));
        }
        if (cookie.invalid || cookie.values.size !== 1) return null;
        return [...cookie.values][0] || null;
    }
    return null;
}

function referralCookie(header: string | null, name: string) {
    const cookie = { present: false, invalid: false, values: new Set<string>() };
    for (const part of (header || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1 || part.slice(0, idx).trim() !== name) continue;
        cookie.present = true;
        try {
            cookie.values.add(decodeURIComponent(part.slice(idx + 1).trim()));
        } catch {
            cookie.invalid = true;
        }
    }
    return cookie;
}

export async function applyAffiliateRef(request: Request, env: AffiliateEnv, respond: () => Response | Promise<Response>, ctx?: AffiliateExecutionContext,
): Promise<Response | null> {
    if (!env.DB || typeof respond !== 'function' || request.method !== 'GET') return null;
    const searchParams = new URL(request.url).searchParams;
    const code = searchParams.get('ref');
    if (!code) return null;
    const cookieName = refCookieName(env, request);

    let aff: Pick<AffiliatesRow, 'id' | 'code'> | null;
    try {
        aff = await env.DB.prepare(
            "SELECT id, code FROM affiliates WHERE code=?1 AND status='active'"
        ).bind(code).first<Pick<AffiliatesRow, 'id' | 'code'>>();
    } catch (err: unknown) {
        console.error('Affiliate referral lookup failed:', errorMessage(err));
        return null;
    }
    if (!aff) return null;
    // Link previews and crawlers neither count as a click nor get a cookie.
    if (isAutomatedRequest(request)) return null;

    // A short link adds aff_link=<slug>; only the affiliate's own active links count.
    let link: { id: string; slug: string } | null = null;
    const linkSlug = searchParams.get('aff_link');
    if (linkSlug) {
        try {
            link = await affiliateLink({ ...env, DB: env.DB }, aff.id, linkSlug.toLowerCase());
        } catch (err: unknown) {
            console.error('Affiliate link lookup failed:', errorMessage(err));
        }
    }

    // One click per fresh referral: a visitor already carrying this code and
    // link (page reloads, multi-page browsing) is not a second click.
    const existing = readAffiliateRef(request, env);
    if (existing !== aff.code || (link && readAffiliateLink(request, env) !== link.id)) {
        const click = recordClick(request, { ...env, DB: env.DB }, aff, link?.id || null);
        if (ctx?.waitUntil) ctx.waitUntil(click);
        else await click;
    }

    let assetRes;
    try {
        assetRes = await respond();
    } catch (err: unknown) {
        console.error('Affiliate asset fetch failed:', errorMessage(err));
        return null;
    }
    if (!(assetRes instanceof Response)) return null;
    const headers = new Headers(assetRes.headers);
    headers.set('Cache-Control', 'private, no-cache');
    const secure = new URL(request.url).protocol === 'https:' || cookieName.startsWith('__Host-');
    const attributes = `HttpOnly; SameSite=Lax; Path=/${secure ? '; Secure' : ''}`;
    headers.append('Set-Cookie',
        `${cookieName}=${encodeURIComponent(aff.code)}; Max-Age=${REF_COOKIE_MAX_AGE}; ${attributes}`
    );
    // Retire the known host-only, root-path legacy cookie on a fresh referral.
    // Other legacy scopes are unknown; the current cookie always outranks them.
    // Remember the link, or forget an earlier one when this visit used none.
    if (link) {
        headers.append('Set-Cookie', `${linkCookieName(env, request)}=${encodeURIComponent(link.id)}; Max-Age=${REF_COOKIE_MAX_AGE}; ${attributes}`);
    } else if (readAffiliateLink(request, env)) {
        headers.append('Set-Cookie', `${linkCookieName(env, request)}=; Max-Age=0; ${attributes}`);
    }
    const legacyName = env.AFFILIATE_REF_LEGACY_COOKIE;
    if (legacyName && legacyName !== cookieName) {
        headers.append('Set-Cookie', `${legacyName}=; Max-Age=0; ${attributes}`);
    }
    return new Response(assetRes.body, { status: assetRes.status, headers });
}

async function recordClick(request: Request, env: AffiliateEnv & { DB: D1Database }, aff: Pick<AffiliatesRow, 'id' | 'code'>, linkId: string | null) {
    try {
        const ipHash = await requestIpHash(request, env);
        const details = clickDetails(request);
        const now = Date.now();
        // One click per IP per affiliate per window; a request without an IP
        // can't be deduplicated and is counted.
        const result = await env.DB.prepare(`INSERT INTO clicks
            (affiliate_id, ip_hash, created_at, link_id, country, device, referrer_host)
            SELECT ?1, ?2, ?3, ?5, ?6, ?7, ?8
            WHERE ?2 IS NULL OR NOT EXISTS (
                SELECT 1 FROM clicks WHERE affiliate_id=?1 AND ip_hash=?2 AND created_at > ?4)
        `).bind(aff.id, ipHash, now, now - CLICK_WINDOW_MS, linkId,
            details.country, details.device, details.referrer_host).run();
        // Analytics Engine gets the same clicks the table counts.
        if (result?.meta?.changes !== 0) writeClickEvent(env, { affiliateId: aff.id, code: aff.code, linkId, details });
    } catch (err: unknown) {
        console.error('Affiliate click insert failed:', errorMessage(err));
    }
}
