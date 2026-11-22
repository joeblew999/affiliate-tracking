-- void:allow-destructive
-- Only indexes are dropped, and made again at once.
-- Short names lowercase, promo codes uppercase, customer emails lowercase: stored in one case, so
-- plain equality finds them (src/links.ts, routes/api/host/checkout.ts, src/stats.ts).
UPDATE `links` SET `slug` = lower(`slug`);--> statement-breakpoint
UPDATE `partners` SET `promo_code` = upper(`promo_code`) WHERE `promo_code` IS NOT NULL;--> statement-breakpoint
UPDATE `sales` SET `customer_email` = lower(`customer_email`) WHERE `customer_email` IS NOT NULL;--> statement-breakpoint
DROP INDEX `links_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `links_slug` ON `links` (`slug`);--> statement-breakpoint
DROP INDEX `partners_promo_code`;--> statement-breakpoint
CREATE UNIQUE INDEX `partners_promo_code` ON `partners` (`promo_code`);--> statement-breakpoint
DROP INDEX `sales_one_clawback_per_refund`;--> statement-breakpoint
CREATE UNIQUE INDEX `sales_one_clawback_per_refund` ON `sales` (`refund_of`,`refund_version`) WHERE "sales"."refund_of" is not null;
