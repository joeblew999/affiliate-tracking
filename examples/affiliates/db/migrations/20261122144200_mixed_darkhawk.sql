-- void:allow-destructive
-- The OAuth sign-in tried on 2026-11-22 is removed (README, "How it fits together"): its tables go.
DROP TABLE `account`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
DROP TABLE `verification`;