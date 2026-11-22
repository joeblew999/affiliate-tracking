CREATE TABLE `clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`link_id` text,
	`ip_hash` text,
	`country` text,
	`device` text,
	`referrer_host` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clicks_partner_ip` ON `clicks` (`partner_id`,`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `clicks_link` ON `clicks` (`link_id`);--> statement-breakpoint
CREATE INDEX `clicks_created` ON `clicks` (`created_at`);--> statement-breakpoint
CREATE TABLE `commission_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text,
	`product_id` text,
	`kind` text NOT NULL,
	`percent` real,
	`fixed_cents` integer,
	`currency` text,
	`min_monthly_sales` integer DEFAULT 0 NOT NULL,
	`cap_per_customer_cents` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `commission_rules_partner` ON `commission_rules` (`partner_id`,`active`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`slug` text NOT NULL,
	`destination` text NOT NULL,
	`campaign` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `links_slug` ON `links` ("slug" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `links_partner` ON `links` (`partner_id`,`status`);--> statement-breakpoint
CREATE TABLE `partner_ip_hashes` (
	`partner_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`partner_id`, `ip_hash`),
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`commission_pct` real DEFAULT 20 NOT NULL,
	`recurring_months` integer,
	`review_required` integer DEFAULT false NOT NULL,
	`promo_code` text,
	`promo_code_id` text,
	`stripe_account_id` text,
	`terms_version` text,
	`terms_accepted_at` integer,
	`application` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partners_userId_unique` ON `partners` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `partners_code_unique` ON `partners` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `partners_promo_code` ON `partners` ("promo_code" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`batch_key` text NOT NULL,
	`stripe_transfer_id` text,
	`stripe_account_id` text,
	`transfer_started_at` integer,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_batchKey_unique` ON `payouts` (`batch_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payouts_one_pending` ON `payouts` (`partner_id`) WHERE "payouts"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`source` text NOT NULL,
	`stripe_customer_id` text,
	`created_at` integer NOT NULL,
	`converted_at` integer,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_userId_unique` ON `referrals` (`user_id`);--> statement-breakpoint
CREATE INDEX `referrals_partner` ON `referrals` (`partner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `referrals_customer` ON `referrals` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `refunded_payments` (
	`payment_intent` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stripe_session_id` text,
	`stripe_invoice_id` text,
	`stripe_event_id` text,
	`payment_intent` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`user_id` text,
	`link_id` text,
	`customer_email` text,
	`customer_country` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`commission_cents` integer NOT NULL,
	`commission_pct` real,
	`commission_detail` text,
	`items` text DEFAULT '[]' NOT NULL,
	`fraud_reason` text,
	`bonus_note` text,
	`payout_currency` text,
	`payout_cents` integer,
	`fx_source` text,
	`created_at` integer NOT NULL,
	`approved_at` integer,
	`paid_at` integer,
	`payout_id` text,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payout_id`) REFERENCES `payouts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_stripeSessionId_unique` ON `sales` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_stripeInvoiceId_unique` ON `sales` (`stripe_invoice_id`);--> statement-breakpoint
CREATE INDEX `sales_partner` ON `sales` (`partner_id`,`status`);--> statement-breakpoint
CREATE INDEX `sales_partner_created` ON `sales` (`partner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_status_created` ON `sales` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_payment_intent` ON `sales` (`payment_intent`);--> statement-breakpoint
CREATE INDEX `sales_payout` ON `sales` (`payout_id`);--> statement-breakpoint
CREATE INDEX `sales_customer` ON `sales` (`stripe_customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_subscription` ON `sales` (`stripe_subscription_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_link` ON `sales` (`link_id`);--> statement-breakpoint
CREATE INDEX `sales_user` ON `sales` (`user_id`);