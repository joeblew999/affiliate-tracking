import type { AffiliateEnv, AffiliatesRow, DbEnv, JsonObject, LinksRow } from './types.ts';
export declare const DEFAULT_LINK_PREFIX = "/r/";
export declare const MAX_LINKS_PER_AFFILIATE = 100;
export declare function linkPrefix(env: AffiliateEnv | undefined): string;
export declare function linkUrl(env: AffiliateEnv | undefined, request: Request, slug: string): string;
export declare function validSlug(slug: unknown): slug is string;
export declare function validDestination(destination: unknown): destination is string;
export declare function handleAffiliateLink(request: Request, env: AffiliateEnv): Promise<Response | null>;
export declare function affiliateLink(env: DbEnv, affiliateId: number, slugOrId: unknown): Promise<Pick<LinksRow, 'id' | 'slug'> | null>;
export type LinkStats = Pick<LinksRow, 'id' | 'slug' | 'destination' | 'campaign' | 'status' | 'created_at'> & {
    clicks: number;
    conversions: number;
    commission_cents: number;
};
export declare function listLinks(env: DbEnv, request: Request, affiliateId: number): Promise<(LinkStats & {
    url: string;
})[]>;
export type CreateLinkResult = {
    error: string;
    status: number;
    link?: undefined;
} | {
    link: Pick<LinksRow, 'id' | 'slug' | 'destination' | 'campaign' | 'status'> & {
        url: string;
    };
    error?: undefined;
};
export declare function createLink(env: DbEnv, request: Request, affiliate: Pick<AffiliatesRow, 'id' | 'code'>, { slug, destination, campaign }?: JsonObject): Promise<CreateLinkResult>;
export declare function archiveLink(env: DbEnv, affiliateId: number, id: unknown): Promise<boolean>;
