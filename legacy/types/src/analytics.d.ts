import type { AffiliateEnv, DbEnv } from './types.ts';
type MoneyRow = {
    affiliate_id: number;
    currency: string;
    revenue_cents: number;
    pending_cents: number;
    approved_cents: number;
    paid_cents: number;
    refunded_cents: number;
};
export declare const MAX_DAYS = 366;
export type DeviceClass = 'tablet' | 'mobile' | 'desktop';
export declare function deviceClass(userAgent: string | null | undefined): DeviceClass | null;
export declare function referrerHost(request: Request): string | null;
export interface ClickDetails {
    country: string | null;
    device: DeviceClass | null;
    referrer_host: string | null;
}
export declare function clickDetails(request: Request): ClickDetails;
export declare function writeClickEvent(env: AffiliateEnv, { affiliateId, code, linkId, details }: {
    affiliateId: number;
    code: string;
    linkId?: string | null;
    details: ClickDetails;
}): void;
export interface StatsRange {
    days: number;
    start: number;
    end: number;
}
export declare function statsRange(params: URLSearchParams, now?: number): StatsRange | null;
export declare function affiliateStats(env: DbEnv, { affiliateId, range }: {
    affiliateId?: number | null;
    range: StatsRange;
}): Promise<{
    range: {
        days: number;
        start: string;
        end: string;
    };
    funnel: {
        affiliate_id: number;
        code: string;
        name: string | null;
        clicks: number;
        signups: number | null;
        customers: number;
        sales: number;
        money: (Omit<MoneyRow, "affiliate_id" | "currency"> & {
            currency: string | null;
        })[];
    }[];
    clicks_by_day: {
        date: string;
        clicks: number;
    }[];
    top_countries: {
        value: string;
        clicks: number;
    }[];
    top_devices: {
        value: string;
        clicks: number;
    }[];
    top_referrers: {
        value: string;
        clicks: number;
    }[];
    links?: {
        slug: string;
        campaign: string | null;
        clicks: number;
        sales: number;
    }[] | undefined;
}>;
export {};
