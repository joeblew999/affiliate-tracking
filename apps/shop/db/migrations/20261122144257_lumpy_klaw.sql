-- void:allow-destructive
-- The OAuth sign-in tried on 2026-11-22 is removed (README, "How it fits together"): its tables go.
DROP TABLE `jwks`;--> statement-breakpoint
DROP TABLE `oauthAccessToken`;--> statement-breakpoint
DROP TABLE `oauthClientAssertion`;--> statement-breakpoint
DROP TABLE `oauthClientResource`;--> statement-breakpoint
DROP TABLE `oauthClient`;--> statement-breakpoint
DROP TABLE `oauthConsent`;--> statement-breakpoint
DROP TABLE `oauthRefreshToken`;--> statement-breakpoint
DROP TABLE `oauthResource`;