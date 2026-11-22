export declare const CLICK_WINDOW_MS: number;
export declare function isAutomatedRequest(request: Request): boolean;
export type FraudReason = 'self_email' | 'self_ip';
export declare function selfReferralReason({ affiliateEmail, customerEmail, buyerIpHash, affiliateIpHashes }: {
    affiliateEmail?: string | null;
    customerEmail?: string | null;
    buyerIpHash?: string | null;
    affiliateIpHashes: readonly (string | null)[];
}): FraudReason | null;
