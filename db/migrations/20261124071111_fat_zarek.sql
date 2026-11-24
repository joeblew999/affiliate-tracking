CREATE TABLE `ds_fork_edges` (
	`source_path` text NOT NULL,
	`edge_id` text NOT NULL,
	`fork_offset` text NOT NULL,
	PRIMARY KEY(`source_path`, `edge_id`)
);
--> statement-breakpoint
CREATE TABLE `ds_messages` (
	`path` text NOT NULL,
	`offset` text NOT NULL,
	`data` blob NOT NULL,
	`ts` integer NOT NULL,
	PRIMARY KEY(`path`, `offset`)
);
--> statement-breakpoint
CREATE TABLE `ds_producers` (
	`path` text NOT NULL,
	`producer_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`last_seq` integer NOT NULL,
	`last_updated` integer NOT NULL,
	PRIMARY KEY(`path`, `producer_id`)
);
--> statement-breakpoint
CREATE TABLE `ds_streams` (
	`path` text PRIMARY KEY NOT NULL,
	`gen` text NOT NULL,
	`version` text NOT NULL,
	`content_type` text,
	`ttl_seconds` integer,
	`expires_at` text,
	`closed` integer DEFAULT 0 NOT NULL,
	`closed_by` text,
	`current_offset` text NOT NULL,
	`last_seq` text,
	`created_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL,
	`forked_from` text,
	`fork_offset` text,
	`fork_sub_offset` integer,
	`fork_source_gen` text,
	`soft_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ds_streams_expiry` ON `ds_streams` (`expires_at`,`ttl_seconds`);