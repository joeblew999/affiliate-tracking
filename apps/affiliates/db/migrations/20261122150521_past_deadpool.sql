-- void:allow-destructive
-- Only indexes are dropped, and made again at once.
DROP INDEX `links_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `links_slug` ON `links` (`slug`);--> statement-breakpoint
DROP INDEX `partners_promo_code`;--> statement-breakpoint
CREATE UNIQUE INDEX `partners_promo_code` ON `partners` (`promo_code`);--> statement-breakpoint
DROP INDEX `sales_one_clawback_per_refund`;--> statement-breakpoint
CREATE UNIQUE INDEX `sales_one_clawback_per_refund` ON `sales` (`refund_of`,`refund_version`) WHERE "sales"."refund_of" is not null;
