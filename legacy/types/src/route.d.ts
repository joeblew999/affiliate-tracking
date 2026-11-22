import type { AffiliateEnv, AffiliateExecutionContext, AffiliateRoute } from './types.ts';
export declare const affiliateRoutes: AffiliateRoute[];
export declare function handleAffiliateApi(request: Request, env: AffiliateEnv, ctx?: AffiliateExecutionContext, { auth }?: {
    auth?: unknown;
}): Promise<Response | null>;
