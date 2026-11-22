-- void:allow-destructive
-- Custom SQL migration file, put your code below! --
-- Short names lowercase, promo codes uppercase, customer emails lowercase: stored in one case, so
-- plain equality finds them (src/links.ts, routes/api/host/checkout.ts, src/stats.ts).
UPDATE `links` SET `slug` = lower(`slug`);--> statement-breakpoint
UPDATE `partners` SET `promo_code` = upper(`promo_code`) WHERE `promo_code` IS NOT NULL;--> statement-breakpoint
UPDATE `sales` SET `customer_email` = lower(`customer_email`) WHERE `customer_email` IS NOT NULL;
