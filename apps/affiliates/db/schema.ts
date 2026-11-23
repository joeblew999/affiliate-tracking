// The affiliate service's tables, one file each under db/schema/ (the layout `void gen model` makes),
// each with the request validators derived from it (Void's "Schema-Derived Validators"). Every key
// is a random UUID; times are milliseconds since 1970 (Date.now()); money is in a currency's minor
// units (cents); column names are snake_case (database.casing in void.config.ts). People are the host
// app's users: this service stores their user id, never a password or session.
export * from "./schema/partners.ts";
export * from "./schema/links.ts";
export * from "./schema/clicks.ts";
export * from "./schema/referrals.ts";
export * from "./schema/partner_ip_hashes.ts";
export * from "./schema/payouts.ts";
export * from "./schema/sales.ts";
export * from "./schema/refunded_payments.ts";
export * from "./schema/commission_rules.ts";
export * from "./schema/venues.ts";
export * from "./schema/events.ts";
