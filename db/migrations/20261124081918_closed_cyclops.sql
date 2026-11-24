CREATE TABLE `hub_pushes` (
	`organization` text NOT NULL,
	`id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`organization`, `id`)
);
