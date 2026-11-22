// The affiliate service's tables, one file each under db/schema/ (the layout `void gen model` makes),
// each with the request validators derived from it (Void's "Schema-Derived Validators"). Every key
// is a random UUID; times are milliseconds since 1970 (Date.now()); money is in a currency's minor
// units (cents); column names are snake_case (database.casing in void.config.ts). People are the host
// app's users: this service stores their user id, never a password or session.
export * from "./schema/partners";
export * from "./schema/links";
export * from "./schema/clicks";
export * from "./schema/referrals";
export * from "./schema/partner_ip_hashes";
export * from "./schema/payouts";
export * from "./schema/sales";
export * from "./schema/refunded_payments";
export * from "./schema/commission_rules";
