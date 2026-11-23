CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text NOT NULL,
	`capacity` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`payee_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payee_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`venue_id` text NOT NULL,
	`organiser_id` text NOT NULL,
	`organiser_pct` real NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`booked_at` integer NOT NULL,
	`on_sale_at` integer,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organiser_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_productId_unique` ON `events` (`product_id`);--> statement-breakpoint
ALTER TABLE `partners` ADD `role` text DEFAULT 'affiliate' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `net_cents` integer;--> statement-breakpoint
ALTER TABLE `sales` ADD `event_id` text;--> statement-breakpoint
CREATE INDEX `sales_event` ON `sales` (`event_id`,`kind`);