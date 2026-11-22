// Pluggable sign-in.
//
// Pass your own auth to handleAffiliateApi instead of (or as well as) the
// built-in magic links and ADMIN_TOKEN:
//
//   handleAffiliateApi(request, env, ctx, { auth: {
//       // Who is signed in, or null. Return the email only once verified.
//       affiliate: async (request, env) => ({ userId, email }) | null,
//       // Is the signed-in user an admin?
//       admin: async (request, env) => true | false,
//   } });
//
// An affiliate is matched by user id, or on their first sign-in by email
// (case-insensitive), which then links the user id to them. The built-in
// methods keep working alongside: magic-link sessions for affiliates, and the
// x-admin-token header for scripts.

import type { AffiliateAuth, AffiliateIdentity, AffiliatesRow, DbEnv } from './types.ts';

const bound = new WeakMap<Request, AffiliateAuth>();

export function validateAuth(auth: unknown): AffiliateAuth | null {
    if (auth === undefined || auth === null) return null;
    if (typeof auth !== 'object') throw new TypeError('auth must be an object');
    for (const key of ['affiliate', 'admin'] as const) {
        const hook = (auth as Record<string, unknown>)[key];
        if (hook !== undefined && typeof hook !== 'function') throw new TypeError(`auth.${key} must be a function`);
    }
    return auth as AffiliateAuth;
}

export function bindAuth(request: Request, auth: AffiliateAuth | null): void {
    if (auth) bound.set(request, auth);
}

export function authFor(request: Request): AffiliateAuth | null {
    return bound.get(request) || null;
}

// The active affiliate for an identity from auth.affiliate, linking the
// user id on the first email match.
export type IdentityAffiliate = Pick<AffiliatesRow, 'id' | 'code' | 'name' | 'email' | 'commission_pct' | 'status' | 'stripe_account_id' | 'user_id'>;

export async function affiliateForIdentity(env: DbEnv, raw: unknown): Promise<IdentityAffiliate | null> {
    // The host's hook returned this; check it field by field.
    const identity = (raw && typeof raw === 'object' ? raw : null) as Partial<AffiliateIdentity> | null;
    const userId = typeof identity?.userId === 'string' && identity.userId ? identity.userId : null;
    const email = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : '';
    if (!userId) return null;
    const columns = 'id, code, name, email, commission_pct, status, stripe_account_id, user_id';
    const linked = await env.DB.prepare(`SELECT ${columns} FROM affiliates WHERE user_id=?1`).bind(userId).first<IdentityAffiliate>();
    if (linked) return linked.status === 'active' ? linked : null;
    if (!email) return null;
    const byEmail = await env.DB.prepare(`SELECT ${columns} FROM affiliates
        WHERE lower(email)=?1 AND user_id IS NULL AND status='active'`).bind(email).first<IdentityAffiliate>();
    if (!byEmail) return null;
    const result = await env.DB.prepare('UPDATE affiliates SET user_id=?1 WHERE id=?2 AND user_id IS NULL')
        .bind(userId, byEmail.id).run();
    return result.meta?.changes ? { ...byEmail, user_id: userId } : null;
}
