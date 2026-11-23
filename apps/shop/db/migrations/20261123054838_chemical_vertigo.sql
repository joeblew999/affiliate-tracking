-- void:allow-destructive
-- The shop no longer sells subscriptions (tickets only), so Better Auth's Stripe plugin has no subscription
-- table. It was never used: the live shop has taken no payments.
DROP TABLE `subscription`;
